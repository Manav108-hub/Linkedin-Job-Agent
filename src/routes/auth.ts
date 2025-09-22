// src/routes/auth.ts - FIXED LinkedIn OAuth Implementation
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
  // FIXED LINKEDIN OAUTH WITH PROPER USER DATA EXTRACTION
  // ========================================

  // LinkedIn OAuth initiation
  app.get("/api/auth/linkedin", (req, res) => {
    console.log("=== LINKEDIN AUTH INITIATION ===");
    console.log("Environment check:");
    console.log("- LINKEDIN_CLIENT_ID exists:", !!process.env.LINKEDIN_CLIENT_ID);
    console.log("- LINKEDIN_CLIENT_SECRET exists:", !!process.env.LINKEDIN_CLIENT_SECRET);
    console.log("- FRONTEND_URL:", process.env.FRONTEND_URL);

    const authParams = new URLSearchParams({
      response_type: "code",
      client_id: process.env.LINKEDIN_CLIENT_ID!,
      redirect_uri: "http://localhost:3001/api/auth/linkedin/callback",
      scope: "openid profile email", // Updated scope for proper user info
      state: "linkedin-connect",
    });

    const authUrl = `https://www.linkedin.com/oauth/v2/authorization?${authParams.toString()}`;
    console.log("Redirecting to LinkedIn:", authUrl);

    res.redirect(authUrl);
  });

  // FIXED LinkedIn OAuth callback with proper user data extraction
  app.get("/api/auth/linkedin/callback", async (req, res) => {
    console.log("=== LINKEDIN CALLBACK ===");
    console.log("Full URL:", req.url);
    console.log("Query params:", req.query);
    console.log("Time:", new Date().toISOString());

    const { code, error, error_description, state } = req.query;

    if (error) {
      console.log("❌ LinkedIn OAuth error:", error, error_description);
      return res.redirect(
        `${process.env.FRONTEND_URL}?error=linkedin_oauth_error&details=${encodeURIComponent(
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
      console.log("✅ Authorization code received:", code.toString().substring(0, 20) + "...");
      console.log("🔄 Exchanging code for access token...");

      // Step 1: Exchange authorization code for access token
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
          timeout: 15000,
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

      // Step 2: Get user info using OpenID userinfo endpoint (FIXED)
      console.log("🔄 Fetching user profile from userinfo endpoint...");
      
      let userData = null;
      
      try {
        // Use the OpenID userinfo endpoint for reliable user data
        const userinfoResponse = await axios.get(
          "https://api.linkedin.com/v2/userinfo",
          {
            headers: {
              Authorization: `Bearer ${access_token}`,
              Accept: "application/json",
            },
            timeout: 15000,
          }
        );

        console.log("✅ Userinfo response received");
        console.log("Userinfo data:", JSON.stringify(userinfoResponse.data, null, 2));

        const userinfo = userinfoResponse.data;
        
        // Extract user data from OpenID userinfo response
        userData = {
          id: userinfo.sub, // OpenID subject identifier
          name: userinfo.name || `${userinfo.given_name || ''} ${userinfo.family_name || ''}`.trim(),
          email: userinfo.email,
          linkedin_id: userinfo.sub,
          picture: userinfo.picture,
          given_name: userinfo.given_name,
          family_name: userinfo.family_name,
          email_verified: userinfo.email_verified,
          locale: userinfo.locale,
        };

        console.log("✅ User data extracted:", {
          id: userData.id,
          name: userData.name,
          email: userData.email,
          email_verified: userData.email_verified,
        });

      } catch (userinfoError) {
        console.log("❌ Userinfo endpoint failed, trying legacy profile endpoint...");
        console.log("Userinfo error:", userinfoError.response?.data || userinfoError.message);

        // Fallback to legacy profile endpoint
        try {
          const profileResponse = await axios.get(
            "https://api.linkedin.com/v2/people/~?projection=(id,localizedFirstName,localizedLastName,profilePicture(displayImage~:playableStreams))",
            {
              headers: {
                Authorization: `Bearer ${access_token}`,
                "X-Restli-Protocol-Version": "2.0.0",
                Accept: "application/json",
              },
              timeout: 15000,
            }
          );

          console.log("✅ Legacy profile data received");
          console.log("Profile data:", JSON.stringify(profileResponse.data, null, 2));

          const profileData = profileResponse.data;
          
          // Get email separately for legacy endpoint
          let email = null;
          try {
            const emailResponse = await axios.get(
              "https://api.linkedin.com/v2/emailAddresses?q=members&projection=(elements*(handle~))",
              {
                headers: {
                  Authorization: `Bearer ${access_token}`,
                  "X-Restli-Protocol-Version": "2.0.0",
                  Accept: "application/json",
                },
                timeout: 15000,
              }
            );

            if (emailResponse.data?.elements?.[0]?.["handle~"]?.emailAddress) {
              email = emailResponse.data.elements[0]["handle~"].emailAddress;
              console.log("✅ Email retrieved from legacy endpoint");
            }
          } catch (emailError) {
            console.log("⚠️ Email fetch failed for legacy endpoint");
          }

          // Extract profile picture URL
          let pictureUrl = null;
          try {
            const displayImage = profileData.profilePicture?.["displayImage~"];
            if (displayImage?.elements && displayImage.elements.length > 0) {
              // Get the largest available image
              const largestImage = displayImage.elements.reduce((largest, current) => {
                const currentSize = current.data?.["com.linkedin.digitalmedia.mediaartifact.StillImage"]?.storageSize?.width || 0;
                const largestSize = largest.data?.["com.linkedin.digitalmedia.mediaartifact.StillImage"]?.storageSize?.width || 0;
                return currentSize > largestSize ? current : largest;
              });
              
              pictureUrl = largestImage.identifiers?.[0]?.identifier;
            }
          } catch (pictureError) {
            console.log("⚠️ Profile picture extraction failed");
          }

          userData = {
            id: profileData.id,
            name: `${profileData.localizedFirstName || ''} ${profileData.localizedLastName || ''}`.trim(),
            email: email || `linkedin.${profileData.id}@temp.linkedin.com`,
            linkedin_id: profileData.id,
            picture: pictureUrl,
            given_name: profileData.localizedFirstName,
            family_name: profileData.localizedLastName,
            email_verified: false, // Unknown for legacy endpoint
            locale: null,
          };

          console.log("✅ Legacy user data extracted:", {
            id: userData.id,
            name: userData.name,
            email: userData.email,
          });

        } catch (legacyError) {
          console.log("❌ Both userinfo and legacy profile endpoints failed");
          throw new Error("Failed to fetch user profile from LinkedIn");
        }
      }

      // Validate that we have essential user data
      if (!userData || !userData.id || !userData.email) {
        throw new Error("Incomplete user data received from LinkedIn");
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
            access_token_expires: expires_in ? Date.now() + expires_in * 1000 : undefined,
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
            // Update existing user with LinkedIn token
            await UserModel.create({
              id: existingUser.id,
              name: userData.name,
              email: userData.email,
              linkedinToken: access_token,
              profileData: {
                ...(existingUser.profileData as any),
                linkedin_profile: userData,
                access_token_expires: expires_in ? Date.now() + expires_in * 1000 : undefined,
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
        return res.redirect(`${process.env.FRONTEND_URL}?error=jwt_secret_missing`);
      }

      console.log("🔐 Creating JWT token...");
      const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET!, {
        expiresIn: "4h",
      });

      console.log("✅ JWT token created successfully");

      const redirectUrl = `${process.env.FRONTEND_URL}/?token=${token}&connected=linkedin&user=${encodeURIComponent(userData.name)}`;
      console.log("🔀 Redirecting to:", redirectUrl);

      res.redirect(redirectUrl);
      console.log("🎉 LinkedIn OAuth completed successfully for user:", userData.name);

    } catch (error: any) {
      console.error("❌ LinkedIn OAuth error:", {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        stack: error.stack?.split('\n').slice(0, 3).join('\n'), // First 3 lines of stack
      });

      let errorMessage = "linkedin_token_exchange_failed";
      if (error.response?.status === 400) {
        errorMessage = "linkedin_invalid_request";
      } else if (error.response?.status === 401) {
        errorMessage = "linkedin_unauthorized";
      } else if (error.response?.status === 403) {
        errorMessage = "linkedin_forbidden";
      } else if (error.code === "ECONNABORTED") {
        errorMessage = "linkedin_timeout";
      } else if (error.message.includes("Incomplete user data")) {
        errorMessage = "linkedin_incomplete_data";
      }

      res.redirect(
        `${process.env.FRONTEND_URL}?error=${errorMessage}&details=${encodeURIComponent(
          error.message
        )}`
      );
    }
  });

  // ========================================
  // GOOGLE OAUTH (Unchanged - Already Working)
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

        res.redirect(`${process.env.FRONTEND_URL}/?token=${token}&connected=google`);
        console.log("✅ Google OAuth completed successfully");
      } catch (error) {
        console.error("Google callback error:", error);
        res.redirect(`${process.env.FRONTEND_URL}?error=callback_failed`);
      }
    }
  );

  // ========================================
  // COMMON AUTH ROUTES (Unchanged)
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
      const applications = await JobApplicationModel.findByUserId(correctUserId, 5);
      const totalApplications = applications.length;

      let hasResume = false;

      if (dbUser) {
        if (dbUser.resumeText) {
          hasResume = true;
        } else if (dbUser.profileData) {
          const profileData = dbUser.profileData as any;
          if (profileData?.resume_content && profileData.resume_content.length > 50) {
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
        linkedinUserinfoEndpoint: "https://api.linkedin.com/v2/userinfo",
        linkedinProfileEndpoint: "https://api.linkedin.com/v2/people/~",
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
          linkedinProfile: (userByEmail?.profileData as any)?.linkedin_profile || null,
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
        const testEmails = ["manavadwani21@gmail.com", "manavadwani86@gmail.com"];

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
              linkedinProfile: (user?.profileData as any)?.linkedin_profile || null,
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