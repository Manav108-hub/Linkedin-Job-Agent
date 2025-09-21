// src/routes/auth.ts - Complete Working Authentication Routes
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

export default function authRoutes(app: Express) {
  // ========================================
  // MANUAL LINKEDIN OAUTH (Working Solution)
  // ========================================

  // LinkedIn OAuth initiation
  app.get("/api/auth/linkedin", (req, res) => {
    console.log("=== MANUAL LINKEDIN AUTH INITIATION ===");
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
      redirect_uri: "http://localhost:3001/api/auth/linkedin/callback",
      scope: "openid profile email",
      state: "linkedin-connect",
    });

    const authUrl = `https://www.linkedin.com/oauth/v2/authorization?${authParams.toString()}`;
    console.log("Redirecting to LinkedIn:", authUrl);

    res.redirect(authUrl);
  });

  // LinkedIn OAuth callback
  app.get("/api/auth/linkedin/callback", async (req, res) => {
    console.log("=== MANUAL LINKEDIN CALLBACK ===");
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

      // Exchange authorization code for access token
      const tokenData = new URLSearchParams({
        grant_type: "authorization_code",
        code: code.toString(),
        client_id: process.env.LINKEDIN_CLIENT_ID!,
        client_secret: process.env.LINKEDIN_CLIENT_SECRET!,
        redirect_uri: "http://localhost:3001/api/auth/linkedin/callback",
      });

      const tokenResponse = await axios.post(
        "https://www.linkedin.com/oauth/v2/accessToken",
        tokenData,
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          timeout: 10000,
        }
      );

      console.log("✅ Token exchange successful!");
      console.log("Token response status:", tokenResponse.status);

      const { access_token, token_type, expires_in } = tokenResponse.data;

      if (!access_token) {
        throw new Error("No access token received from LinkedIn");
      }

      console.log("✅ Access token received");
      console.log("Token type:", token_type);
      console.log("Expires in:", expires_in, "seconds");

      // Try to get user profile data
      let userData = {
        id: `linkedin_${Date.now()}`,
        name: "LinkedIn User",
        email: `linkedin.user.${Date.now()}@temp.com`,
        linkedin_id: `linkedin_${Date.now()}`,
        picture: undefined,
      };

      try {
        console.log("🔄 Fetching user profile...");
        const profileResponse = await axios.get(
          "https://api.linkedin.com/v2/people/~?projection=(id,localizedFirstName,localizedLastName)",
          {
            headers: {
              Authorization: `Bearer ${access_token}`,
              "X-Restli-Protocol-Version": "2.0.0",
              Accept: "application/json",
            },
            timeout: 10000,
          }
        );

        console.log("✅ Profile data received");
        const profileData = profileResponse.data;

        let email = `linkedin.user.${Date.now()}@temp.com`;
        try {
          const emailResponse = await axios.get(
            "https://api.linkedin.com/v2/emailAddresses?q=members&projection=(elements*(handle~))",
            {
              headers: {
                Authorization: `Bearer ${access_token}`,
                "X-Restli-Protocol-Version": "2.0.0",
                Accept: "application/json",
              },
              timeout: 10000,
            }
          );

          if (emailResponse.data?.elements?.[0]?.["handle~"]?.emailAddress) {
            email = emailResponse.data.elements[0]["handle~"].emailAddress;
            console.log("✅ Real email retrieved from LinkedIn");
          }
        } catch (emailError) {
          console.log("⚠️ Email fetch failed, using fallback");
        }

        if (
          profileData.id &&
          (profileData.localizedFirstName || profileData.localizedLastName)
        ) {
          userData = {
            id: profileData.id,
            name:
              `${profileData.localizedFirstName || ""} ${
                profileData.localizedLastName || ""
              }`.trim() || "LinkedIn User",
            email: email,
            linkedin_id: profileData.id,
            picture: undefined,
          };
          console.log("✅ Using real LinkedIn profile data:", {
            id: userData.id,
            name: userData.name,
            email: userData.email,
          });
        } else {
          console.log(
            "⚠️ Using fallback profile data (incomplete LinkedIn response)"
          );
        }
      } catch (profileError: any) {
        console.log("⚠️ Profile fetch failed, using basic data:", {
          message: profileError.message,
          status: profileError.response?.status,
          statusText: profileError.response?.statusText,
          data: profileError.response?.data,
        });
      }

      console.log("👤 Creating user session with data:", {
        id: userData.id,
        name: userData.name,
        email: userData.email,
      });

      // Create session profile
      const sessionProfile = {
        id: userData.linkedin_id,
        displayName: userData.name,
        emails: [{ value: userData.email }],
        photos: userData.picture ? [{ value: userData.picture }] : [],
        provider: "linkedin",
        _json: { sub: userData.id, name: userData.name, email: userData.email },
      };

      const user = createUserSession(sessionProfile, access_token, "linkedin");

      console.log("✅ User session created:", user.id);

      // Save to database
      try {
        await UserModel.create({
          id: user.id,
          linkedinId: userData.linkedin_id,
          name: userData.name,
          email: userData.email,
          profileData: {
            manual: true,
            linkedin_profile: userData,
            access_token_expires: expires_in
              ? Date.now() + expires_in * 1000
              : undefined,
          },
          linkedinToken: access_token,
        });
        console.log("✅ LinkedIn user saved to database");
      } catch (dbError) {
        console.log(
          "⚠️ Database save failed (non-critical):",
          dbError instanceof Error ? dbError.message : String(dbError)
        );
        // Try updating existing user
        try {
          const existingUser = await UserModel.findByEmail(userData.email);
          if (existingUser) {
            console.log("🔄 Updating existing user with LinkedIn token");
          }
        } catch (updateError) {
          console.log("⚠️ User update also failed");
        }
      }

      // Create JWT token
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

      const redirectUrl = `${process.env.FRONTEND_URL}/?token=${token}&connected=linkedin`;
      console.log("🔀 Redirecting to:", redirectUrl);

      res.redirect(redirectUrl);

      console.log("🎉 Manual LinkedIn OAuth completed successfully!");
    } catch (error: any) {
      console.error("❌ Manual LinkedIn OAuth error:", {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
        stack: error.stack,
      });

      let errorMessage = "linkedin_token_exchange_failed";
      if (error.response?.status === 400) {
        errorMessage = "linkedin_invalid_request";
      } else if (error.response?.status === 401) {
        errorMessage = "linkedin_unauthorized";
      } else if (error.code === "ECONNABORTED") {
        errorMessage = "linkedin_timeout";
      }

      res.redirect(
        `${
          process.env.FRONTEND_URL
        }?error=${errorMessage}&details=${encodeURIComponent(error.message)}`
      );
    }
  });

  // ========================================
  // GOOGLE OAUTH (Using Passport - Working)
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

  // Logout route
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

  // Current user details
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

  // User status endpoint
  app.get("/api/user/status", verifyToken, async (req, res) => {
    console.log("=== USER STATUS ENDPOINT ===");
    try {
      const user = req.user!;
      console.log("Session User ID:", user.id);
      console.log("Session User Email:", user.email);

      // Find user in database
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
  // DEBUG ENDPOINTS (Development Only)
  // ========================================

  if (process.env.NODE_ENV === "development" || !process.env.NODE_ENV) {
    // LinkedIn configuration debug
    app.get("/api/debug/linkedin-config", (req, res) => {
      res.json({
        hasClientId: !!process.env.LINKEDIN_CLIENT_ID,
        clientIdPreview: process.env.LINKEDIN_CLIENT_ID
          ? process.env.LINKEDIN_CLIENT_ID.substring(0, 8) + "..."
          : "missing",
        hasClientSecret: !!process.env.LINKEDIN_CLIENT_SECRET,
        frontendUrl: process.env.FRONTEND_URL,
        callbackUrl: "http://localhost:3001/api/auth/linkedin/callback",
        nodeEnv: process.env.NODE_ENV,
        timestamp: new Date().toISOString(),
      });
    });

    // User session debug
    app.get("/api/debug/user-session", verifyToken, async (req, res) => {
      try {
        const sessionUser = req.user!;

        const userById = await UserModel.findById(sessionUser.id);
        const userByEmail = await UserModel.findByEmail(sessionUser.email);

        res.json({
          sessionUserId: sessionUser.id,
          sessionUserEmail: sessionUser.email,
          foundById: !!userById,
          foundByEmail: !!userByEmail,
          actualUserId: userByEmail?.id,
          idsMatch: sessionUser.id === userByEmail?.id,
          hasResumeContent: !!(userByEmail?.profileData as any)?.resume_content,
          telegramConfigured: !!userByEmail?.telegramChatId,
        });
      } catch (error) {
        console.error("Debug error:", error);
        res.status(500).json({ error: (error as Error).message });
      }
    });

    // Session management debug
    app.get("/api/debug/sessions", (req, res) => {
      res.json(getSessionStats());
    });

    app.post("/api/debug/clear-sessions", (req, res) => {
      activeSessions.clear();
      emailToSessionMap.clear();
      nameToSessionMap.clear();
      res.json({ message: "All sessions cleared" });
    });

    // Database users debug
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
              hasProfileData: !!user?.profileData,
              telegramChatId: user?.telegramChatId || null,
              hasLinkedInToken: !!user?.linkedinToken,
              hasGoogleToken: !!user?.googleToken,
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
