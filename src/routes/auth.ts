// src/routes/auth.ts - Complete Fixed Authentication Routes
import { Express } from "express";
import passport from "passport";
import jwt from "jsonwebtoken";
import axios from "axios";
import { UserSession } from "../types/index";
import {
  verifyToken,
  activeSessions,
  emailToSessionMap,
  nameToSessionMap,
  getSessionStats,
  createUserSession,
} from "../middleware/auth";
import { UserModel, JobApplicationModel } from "../database/db";
import { LinkedInService } from "../services/LinkedInService";

// Helper function to get actual database user (FIXED - moved to top)
async function getActualDatabaseUser(sessionUser: any): Promise<any> {
  // First try to find by session ID
  let dbUser = await UserModel.findById(sessionUser.id);

  if (!dbUser) {
    console.log("User not found by session ID, trying email...");
    // Fallback to email lookup
    dbUser = await UserModel.findByEmail(sessionUser.email);

    if (dbUser) {
      console.log("Found user by email - ID mismatch detected!");
      console.log("Session ID:", sessionUser.id);
      console.log("Database ID:", dbUser.id);
    }
  }

  return dbUser;
}

// Helper method to get available jobs
async function getAvailableJobs(user: any): Promise<any[]> {
  try {
    // Use the LinkedIn service to search for jobs
    const linkedinService = new LinkedInService();
    await linkedinService.initialize();

    const jobs = await linkedinService.searchJobs(
      ["typescript", "react", "node.js"],
      "UK",
      50
    );

    return jobs;
  } catch (error) {
    console.error("Error fetching available jobs:", error);
    return [];
  }
}

// Helper method to determine application method
function determineApplicationMethod(job: any): string {
  if (
    job.source === "JSearch" ||
    job.source === "Reed" ||
    job.source === "Remotive"
  ) {
    return "External Application Required - Visit Job URL";
  } else if (job.url && job.url.includes("linkedin.com")) {
    return "LinkedIn Application (May be Automated)";
  } else {
    return "Visit Company Website";
  }
}

export default function authRoutes(app: Express) {
  // ========================================
  // FIXED LINKEDIN OAUTH WITH OPENID CONNECT
  // ========================================

  // LinkedIn OAuth initiation
  app.get("/api/auth/linkedin", (req, res) => {
    console.log("=== LINKEDIN AUTH INITIATION ===");
    console.log("Environment check:");
    console.log(
      "- LINKEDIN_CLIENT_ID exists:",
      !!process.env.LINKEDIN_CLIENT_ID
    );
    console.log(
      "- LINKEDIN_CLIENT_SECRET exists:",
      !!process.env.LINKEDIN_CLIENT_SECRET
    );
    console.log("- FRONTEND_URL:", process.env.FRONTEND_URL);

    const authParams = new URLSearchParams({
      response_type: "code",
      client_id: process.env.LINKEDIN_CLIENT_ID!,
      redirect_uri: "http://linkedin-job-agent-production-9672.up.railway.app/api/auth/linkedin/callback",
      scope: "openid profile email", // Fixed scope - LinkedIn v2 API
      state: "linkedin-connect",
    });

    const authUrl = `https://www.linkedin.com/oauth/v2/authorization?${authParams.toString()}`;
    console.log("Redirecting to LinkedIn:", authUrl);

    res.redirect(authUrl);
  });

  // FIXED LinkedIn OAuth callback with OpenID Connect userinfo endpoint
  app.get("/api/auth/linkedin/callback", async (req, res) => {
    console.log("=== LINKEDIN CALLBACK ===");
    console.log("Full URL:", req.url);
    console.log("Query params:", req.query);
    console.log("Time:", new Date().toISOString());

    const { code, error, error_description, state } = req.query;

    if (error) {
      console.log("❌ LinkedIn OAuth error:", error, error_description);
      return res.redirect(
        `${
          process.env.FRONTEND_URL
        }?error=linkedin_oauth_error&details=${encodeURIComponent(
          String(error_description || error)
        )}`
      );
    }

    if (!code) {
      console.log("❌ No authorization code received");
      return res.redirect(`${process.env.FRONTEND_URL}?error=no_auth_code`);
    }

    if (state !== "linkedin-connect") {
      console.log("❌ Invalid state parameter");
      return res.redirect(`${process.env.FRONTEND_URL}?error=invalid_state`);
    }

    try {
      console.log(
        "✅ Authorization code received:",
        code.toString().substring(0, 20) + "..."
      );
      console.log("🔄 Exchanging code for access token...");

      // Step 1: Exchange authorization code for access token
      const tokenData = new URLSearchParams({
        grant_type: "authorization_code",
        code: code.toString(),
        client_id: process.env.LINKEDIN_CLIENT_ID!,
        client_secret: process.env.LINKEDIN_CLIENT_SECRET!,
        redirect_uri: "http://linkedin-job-agent-production-9672.up.railway.app/api/auth/linkedin/callback",
      });

      const tokenResponse = await axios.post(
        "https://www.linkedin.com/oauth/v2/accessToken",
        tokenData,
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          timeout: parseInt(process.env.LINKEDIN_TIMEOUT || "30000"),
        }
      );

      console.log("✅ Token exchange successful!");
      const { access_token, token_type, expires_in } = tokenResponse.data;

      if (!access_token) {
        throw new Error("No access token received from LinkedIn");
      }

      console.log("✅ Access token received");
      console.log("Token type:", token_type);
      console.log("Expires in:", expires_in, "seconds");

      // Step 2: Get user info with OpenID Connect userinfo endpoint
      console.log("🔄 Fetching user profile with OpenID Connect...");

      let userData = null;
      const maxRetries = parseInt(process.env.LINKEDIN_RETRY_ATTEMPTS || "3");

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          console.log(
            `Attempt ${attempt}/${maxRetries}: Fetching LinkedIn userinfo...`
          );

          // Use OpenID Connect userinfo endpoint with fixed header formatting
          console.log("Making request to LinkedIn userinfo endpoint...");
          console.log("Access token preview:", access_token.substring(0, 20) + "...");
          
          try {
            // Test with curl equivalent request
            const profileResponse = await axios({
              method: 'GET',
              url: 'https://api.linkedin.com/v2/userinfo',
              headers: {
                'Authorization': `Bearer ${access_token}`,
                'Accept': 'application/json',
                'User-Agent': 'JobAgentAI/1.0',
                'Content-Type': 'application/json'
              },
              timeout: 30000,
              maxRedirects: 0,
              validateStatus: function (status) {
                return status < 500;
              }
            });

            console.log("LinkedIn API Response Status:", profileResponse.status);
            console.log("LinkedIn API Response Data:", JSON.stringify(profileResponse.data, null, 2));
            
            if (profileResponse.status === 401) {
              throw new Error(`LinkedIn API 401 - Token may be invalid or expired: ${JSON.stringify(profileResponse.data)}`);
            }
            
            if (profileResponse.status !== 200) {
              throw new Error(`LinkedIn API returned ${profileResponse.status}: ${JSON.stringify(profileResponse.data)}`);
            }

            const profileData = profileResponse.data;
            
            if (!profileData || !profileData.sub) {
              throw new Error(`Invalid userinfo response: ${JSON.stringify(profileData)}`);
            }

            console.log("LinkedIn OpenID profile data:", {
              sub: profileData.sub,
              name: profileData.name,
              email: profileData.email,
              email_verified: profileData.email_verified,
            });

            userData = {
              id: profileData.sub,
              name: profileData.name || 'LinkedIn User',
              email: profileData.email || `linkedin.user.${Date.now()}@temp.linkedin.com`,
              linkedin_id: profileData.sub,
              picture: profileData.picture || null,
              given_name: profileData.given_name || null,
              family_name: profileData.family_name || null,
              email_verified: profileData.email_verified || false,
              locale: profileData.locale || null,
            };

            console.log("✅ User data extracted from OpenID Connect:", {
              id: userData.id,
              name: userData.name,
              email: userData.email,
              has_real_email: userData.email_verified,
            });

            break; // Success - exit retry loop

          } catch (axiosError: any) {
            console.log("Axios error details:", {
              message: axiosError.message,
              status: axiosError.response?.status,
              data: axiosError.response?.data,
              config: {
                url: axiosError.config?.url,
                headers: axiosError.config?.headers
              }
            });

            throw axiosError;
          }

        } catch (profileError: any) {
          console.log(`❌ Attempt ${attempt} failed:`, profileError.message);
          
          // Log more details about the error
          if (profileError.response) {
            console.log("Error response status:", profileError.response.status);
            console.log("Error response data:", profileError.response.data);
          }

          if (attempt === maxRetries) {
            console.log(
              "🔄 All attempts failed, creating fallback user data..."
            );

            userData = {
              id: `linkedin_${Date.now()}`,
              name: "LinkedIn User",
              email: `linkedin.user.${Date.now()}@temp.linkedin.com`,
              linkedin_id: `linkedin_${Date.now()}`,
              picture: null,
              given_name: "LinkedIn",
              family_name: "User",
              email_verified: false,
              locale: null,
            };

            console.log("⚠️ Using fallback user data:", userData);
          } else {
            // Wait before retry
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
        }
      }

      // Validate that we have essential user data
      if (!userData || !userData.id || !userData.email) {
        throw new Error(
          `Incomplete user data received: ${JSON.stringify(userData)}`
        );
      }

      // Step 3: Create session profile
      console.log("👤 Creating user session with LinkedIn data:", {
        id: userData.id,
        name: userData.name,
        email: userData.email,
      });

      const sessionProfile = {
        id: userData.linkedin_id,
        displayName: userData.name,
        emails: [{ value: userData.email }],
        photos: userData.picture ? [{ value: userData.picture }] : [],
        provider: "linkedin",
        _json: {
          sub: userData.id,
          name: userData.name,
          email: userData.email,
          given_name: userData.given_name,
          family_name: userData.family_name,
          picture: userData.picture,
          email_verified: userData.email_verified,
          locale: userData.locale,
        },
      };

      const user = createUserSession(sessionProfile, access_token, "linkedin");
      console.log("✅ User session created:", user.id);

      // Step 4: Save to database
      try {
        await UserModel.create({
          id: user.id,
          linkedinId: userData.linkedin_id,
          name: userData.name,
          email: userData.email,
          profileData: {
            linkedin_profile: userData,
            access_token_expires: expires_in
              ? Date.now() + expires_in * 1000
              : undefined,
            raw_userinfo: sessionProfile._json,
          },
          linkedinToken: access_token,
        });
        console.log("✅ LinkedIn user saved to database");
      } catch (dbError) {
        console.log("⚠️ Database save failed, trying update...");
        try {
          const existingUser = await UserModel.findByEmail(userData.email);
          if (existingUser) {
            await UserModel.create({
              id: existingUser.id,
              name: userData.name,
              email: userData.email,
              linkedinToken: access_token,
              profileData: {
                ...(existingUser.profileData as any),
                linkedin_profile: userData,
                access_token_expires: expires_in
                  ? Date.now() + expires_in * 1000
                  : undefined,
              },
            });
            console.log("✅ Existing user updated with LinkedIn token");
          }
        } catch (updateError) {
          console.log("⚠️ User update also failed:", updateError);
        }
      }

      // Step 5: Create JWT token
      if (!process.env.JWT_SECRET) {
        console.log("❌ JWT_SECRET not configured");
        return res.redirect(
          `${process.env.FRONTEND_URL}?error=jwt_secret_missing`
        );
      }

      console.log("🔐 Creating JWT token...");
      const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET!, {
        expiresIn: "4h",
      });

      console.log("✅ JWT token created successfully");

      const redirectUrl = `${
        process.env.FRONTEND_URL
      }/?token=${token}&connected=linkedin&user=${encodeURIComponent(
        userData.name
      )}`;
      console.log("🔀 Redirecting to:", redirectUrl);

      res.redirect(redirectUrl);
      console.log(
        "🎉 LinkedIn OAuth completed successfully for user:",
        userData.name
      );

    } catch (error: any) {
      // Enhanced error logging
      console.error("❌ LinkedIn OAuth error with full details:", {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        headers: error.response?.headers,
        code: error.code,
        stack: error.stack?.split("\n").slice(0, 5).join("\n"),
      });

      // Provide more specific error messages
      let errorMessage = "linkedin_profile_fetch_failed";
      if (error.response?.status === 401) {
        errorMessage = "linkedin_token_invalid";
      } else if (error.response?.status === 403) {
        errorMessage = "linkedin_insufficient_permissions";
      } else if (error.response?.status === 429) {
        errorMessage = "linkedin_rate_limited";
      } else if (error.code === "ECONNABORTED") {
        errorMessage = "linkedin_timeout";
      } else if (error.message.includes("Incomplete user data")) {
        errorMessage = "linkedin_incomplete_data";
      }

      res.redirect(
        `${
          process.env.FRONTEND_URL
        }?error=${errorMessage}&details=${encodeURIComponent(error.message)}`
      );
    }
  });

  // ========================================
  // GOOGLE OAUTH (Working - No Changes)
  // ========================================

  app.get(
    "/api/auth/google",
    (req, res, next) => {
      console.log("=== GOOGLE AUTH INITIATION ===");
      next();
    },
    passport.authenticate("google", {
      scope: [
        "profile",
        "email",
        "https://www.googleapis.com/auth/documents.readonly",
        "https://www.googleapis.com/auth/drive.file",
      ],
      state: "google-connect",
    })
  );

  app.get(
    "/api/auth/google/callback",
    (req, res, next) => {
      console.log("=== GOOGLE CALLBACK RECEIVED ===");
      console.log("Query params:", req.query);
      next();
    },
    passport.authenticate("google", {
      failureRedirect: `${process.env.FRONTEND_URL}?error=google_failed`,
    }),
    (req, res) => {
      console.log("=== GOOGLE SUCCESS CALLBACK ===");
      try {
        const user = req.user as UserSession;
        console.log("Google user authenticated:", user?.name, user?.email);

        if (!user) {
          return res.redirect(`${process.env.FRONTEND_URL}?error=no_user_data`);
        }

        const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET!, {
          expiresIn: "4h",
        });

        res.redirect(
          `${process.env.FRONTEND_URL}/?token=${token}&connected=google`
        );
        console.log("✅ Google OAuth completed successfully");
      } catch (error) {
        console.error("Google callback error:", error);
        res.redirect(`${process.env.FRONTEND_URL}?error=callback_failed`);
      }
    }
  );

  // ========================================
  // COMMON AUTH ROUTES
  // ========================================

  app.post("/api/auth/logout", verifyToken, (req, res) => {
    try {
      const user = req.user!;
      activeSessions.delete(user.id);
      res.json({ message: "Logged out successfully" });
    } catch (error) {
      console.error("Logout error:", error);
      res.status(500).json({ error: "Logout failed" });
    }
  });

  app.get("/api/auth/me", verifyToken, (req, res) => {
    const user = req.user!;
    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      hasLinkedIn: !!user.linkedinToken,
      hasGoogle: !!user.googleToken,
      createdAt: user.createdAt,
      expiresAt: user.expiresAt,
    });
  });

  app.get("/api/user/status", verifyToken, async (req, res) => {
    console.log("=== USER STATUS ENDPOINT ===");
    try {
      const user = req.user!;
      console.log("Session User ID:", user.id);
      console.log("Session User Email:", user.email);

      let dbUser = await UserModel.findById(user.id);

      if (!dbUser) {
        console.log("User not found by ID, trying email...");
        dbUser = await UserModel.findByEmail(user.email);

        if (dbUser) {
          console.log("Found user by email - ID mismatch detected!");
          console.log("Session ID:", user.id);
          console.log("Database ID:", dbUser.id);
        }
      }

      const correctUserId = dbUser?.id || user.id;
      const applications = await JobApplicationModel.findByUserId(
        correctUserId,
        5
      );
      const totalApplications = applications.length;

      let hasResume = false;

      if (dbUser) {
        if (dbUser.resumeText) {
          hasResume = true;
        } else if (dbUser.profileData) {
          const profileData = dbUser.profileData as any;
          if (
            profileData?.resume_content &&
            profileData.resume_content.length > 50
          ) {
            hasResume = true;
          } else if (profileData?.resume_filename) {
            hasResume = true;
          }
        }
      }

      const response = {
        id: user.id,
        name: user.name,
        email: user.email,
        linkedinConnected: !!user.linkedinToken,
        googleConnected: !!user.googleToken,
        resumeUploaded: hasResume,
        sessionExpires: user.expiresAt,
        automationEnabled: dbUser?.automationEnabled || false,
        telegramConfigured: !!dbUser?.telegramChatId,
        telegramChatId: dbUser?.telegramChatId || null,
        stats: {
          totalApplications,
          recentApplications: applications,
        },
      };

      res.json(response);
    } catch (error) {
      console.error("Error getting user status:", error);
      res.status(500).json({ error: "Failed to get user status" });
    }
  });

  // ========================================
  // CSV EXPORT AND SUMMARY ENDPOINTS
  // ========================================

  // CSV Export endpoint for job applications
  app.get("/api/jobs/export/csv", verifyToken, async (req, res) => {
    try {
      const sessionUser = req.user!;
      const { type = "applied" } = req.query; // 'applied', 'available', 'all'

      console.log(`=== CSV EXPORT REQUEST ===`);
      console.log(`User: ${sessionUser.email}`);
      console.log(`Export type: ${type}`);

      // Get actual database user
      const dbUser = await getActualDatabaseUser(sessionUser);
      if (!dbUser) {
        return res.status(404).json({ error: "User not found in database" });
      }

      let csvData = "";
      let filename = "";

      if (type === "applied" || type === "all") {
        // Get user's applications
        const applications = await JobApplicationModel.findByUserId(
          dbUser.id,
          1000
        );

        console.log(`Found ${applications.length} applications for CSV export`);

        // CSV headers
        const headers = [
          "Application ID",
          "Company",
          "Job Title",
          "Location",
          "Job URL",
          "Application Status",
          "Match Score",
          "Applied Date",
          "Resume Customized",
          "Drive Link",
          "Notes",
          "Action Required",
        ];

        csvData = headers.join(",") + "\n";

        // Add application data
        for (const app of applications) {
          const jobListing = app.jobListing || {
            title: "Unknown Position",
            company: "Unknown Company",
            location: "Unknown Location",
          };

          // Determine action required based on status
          let actionRequired = "None";
          if (
            app.status === "MANUAL_ACTION_REQUIRED" ||
            app.status === "pending"
          ) {
            actionRequired = "Visit job URL to apply manually";
          } else if (app.status === "FORM_READY_FOR_SUBMIT") {
            actionRequired = "LinkedIn form filled - click submit";
          } else if (app.status === "VISIT_SITE_TO_APPLY") {
            actionRequired = "Visit company website to apply";
          } else if (app.status === "applied") {
            actionRequired = "Application submitted successfully";
          }

          const row = [
            app.id,
            `"${jobListing.company || "Unknown"}"`,
            `"${jobListing.title || "Unknown Position"}"`,
            `"${jobListing.location || ""}"`,
            app.jobUrl || "",
            app.status || "unknown",
            app.matchScore || 0,
            new Date(app.appliedAt).toLocaleDateString(),
            app.resumeCustomized ? "Yes" : "No",
            app.driveLink || "",
            `"${app.notes || ""}"`,
            `"${actionRequired}"`,
          ];

          csvData += row.join(",") + "\n";
        }

        filename = `job_applications_${sessionUser.email.split("@")[0]}_${
          new Date().toISOString().split("T")[0]
        }.csv`;
      }

      if (type === "available") {
        console.log("Generating available jobs CSV...");

        // Get recent job search results
        const jobSearchResults = await getAvailableJobs(dbUser);

        const headers = [
          "Job ID",
          "Company",
          "Job Title",
          "Location",
          "Job URL",
          "Source",
          "Salary",
          "Job Type",
          "Posted Date",
          "Description Preview",
          "Application Method",
        ];

        csvData = headers.join(",") + "\n";

        for (const job of jobSearchResults) {
          const applicationMethod = determineApplicationMethod(job);

          const row = [
            job.id,
            `"${job.company}"`,
            `"${job.title}"`,
            `"${job.location}"`,
            job.url || "",
            job.source || "Unknown",
            `"${job.salary || "Not specified"}"`,
            job.jobType || "Full-time",
            new Date(job.postedDate || new Date()).toLocaleDateString(),
            `"${(job.description || "").substring(0, 100)}..."`,
            `"${applicationMethod}"`,
          ];

          csvData += row.join(",") + "\n";
        }

        filename = `available_jobs_${sessionUser.email.split("@")[0]}_${
          new Date().toISOString().split("T")[0]
        }.csv`;
      }

      // Set CSV headers
      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`
      );
      res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");

      console.log(`✅ CSV export completed: ${filename}`);
      console.log(`📊 Rows exported: ${csvData.split("\n").length - 1}`);

      res.send(csvData);
    } catch (error) {
      console.error("Error exporting CSV:", error);
      res.status(500).json({ error: "Failed to export CSV" });
    }
  });

  // Get job application summary endpoint
  app.get("/api/jobs/summary", verifyToken, async (req, res) => {
    try {
      const sessionUser = req.user!;
      const dbUser = await getActualDatabaseUser(sessionUser);

      if (!dbUser) {
        return res.status(404).json({ error: "User not found" });
      }

      const applications = await JobApplicationModel.findByUserId(
        dbUser.id,
        1000
      );

      // Group by status
      const statusCounts = applications.reduce((acc: any, app: any) => {
        acc[app.status] = (acc[app.status] || 0) + 1;
        return acc;
      }, {});

      // Calculate success metrics
      const totalApplications = applications.length;
      const appliedCount = applications.filter(
        (app: any) => app.status === "APPLIED" || app.status === "applied"
      ).length;
      const pendingCount = applications.filter(
        (app: any) =>
          app.status &&
          (app.status.includes("MANUAL_ACTION_REQUIRED") ||
            app.status.includes("FORM_READY") ||
            app.status === "pending")
      ).length;

      const summary = {
        totalApplications,
        appliedCount,
        pendingCount,
        statusBreakdown: statusCounts,
        applicationRate:
          totalApplications > 0
            ? ((appliedCount / totalApplications) * 100).toFixed(1)
            : 0,
        lastApplicationDate:
          applications.length > 0 ? applications[0].appliedAt : null,
        avgMatchScore:
          applications.length > 0
            ? (
                applications.reduce(
                  (sum: number, app: any) => sum + (app.matchScore || 0),
                  0
                ) / applications.length
              ).toFixed(1)
            : 0,
      };

      res.json(summary);
    } catch (error) {
      console.error("Error getting job summary:", error);
      res.status(500).json({ error: "Failed to get job summary" });
    }
  });

  // ========================================
  // DEBUG ENDPOINTS (Development Only)
  // ========================================

  if (process.env.NODE_ENV === "development" || !process.env.NODE_ENV) {
    app.get("/api/debug/linkedin-config", (req, res) => {
      res.json({
        hasClientId: !!process.env.LINKEDIN_CLIENT_ID,
        clientIdPreview: process.env.LINKEDIN_CLIENT_ID
          ? process.env.LINKEDIN_CLIENT_ID.substring(0, 8) + "..."
          : "missing",
        hasClientSecret: !!process.env.LINKEDIN_CLIENT_SECRET,
        frontendUrl: process.env.FRONTEND_URL,
        callbackUrl: "http://linkedin-job-agent-production-9672.up.railway.app/api/auth/linkedin/callback",
        nodeEnv: process.env.NODE_ENV,
        timeout: process.env.LINKEDIN_TIMEOUT,
        retryAttempts: process.env.LINKEDIN_RETRY_ATTEMPTS,
        timestamp: new Date().toISOString(),
      });
    });

    app.get("/api/debug/user-session", verifyToken, async (req, res) => {
      try {
        const sessionUser = req.user!;

        const userById = await UserModel.findById(sessionUser.id);
        const userByEmail = await UserModel.findByEmail(sessionUser.email);

        res.json({
          sessionUserId: sessionUser.id,
          sessionUserEmail: sessionUser.email,
          sessionUserName: sessionUser.name,
          foundById: !!userById,
          foundByEmail: !!userByEmail,
          actualUserId: userByEmail?.id,
          idsMatch: sessionUser.id === userByEmail?.id,
          hasResumeContent: !!(userByEmail?.profileData as any)?.resume_content,
          telegramConfigured: !!userByEmail?.telegramChatId,
          linkedinProfile:
            (userByEmail?.profileData as any)?.linkedin_profile || null,
        });
      } catch (error) {
        console.error("Debug error:", error);
        res.status(500).json({ error: (error as Error).message });
      }
    });

    app.get("/api/debug/sessions", (req, res) => {
      res.json(getSessionStats());
    });

    app.post("/api/debug/clear-sessions", (req, res) => {
      activeSessions.clear();
      emailToSessionMap.clear();
      nameToSessionMap.clear();
      res.json({ message: "All sessions cleared" });
    });

    app.get("/api/debug/database-users", async (req, res) => {
      try {
        const users = await UserModel.findAutomationUsers();
        const testEmails = [
          "manavadwani21@gmail.com",
          "manavadwani86@gmail.com",
        ];

        const allUsersByEmail = await Promise.all(
          testEmails.map(async (email) => {
            const user = await UserModel.findByEmail(email);
            return {
              email,
              found: !!user,
              id: user?.id,
              name: user?.name,
              hasProfileData: !!user?.profileData,
              telegramChatId: user?.telegramChatId || null,
              hasLinkedInToken: !!user?.linkedinToken,
              hasGoogleToken: !!user?.googleToken,
              linkedinProfile:
                (user?.profileData as any)?.linkedin_profile || null,
            };
          })
        );

        res.json({
          automationUsers: users.length,
          userLookups: allUsersByEmail,
          totalInDatabase: users.length,
        });
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });
  }
}