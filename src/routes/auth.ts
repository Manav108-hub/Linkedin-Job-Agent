import { Express } from "express";
import passport from "passport";
import jwt from "jsonwebtoken";
import { UserSession } from "../types/index";
import { verifyToken, activeSessions, emailToSessionMap, nameToSessionMap, getSessionStats } from "../middleware/auth";
import { UserModel, JobApplicationModel } from "../database/db";

export default function authRoutes(app: Express) {
  // LinkedIn OAuth routes
  app.get(
    "/api/auth/linkedin",
    passport.authenticate("linkedin", { 
      scope: ['openid', 'profile', 'email'],
      state: "linkedin-connect" 
    })
  );

  app.get(
    "/api/auth/linkedin/callback",
    passport.authenticate("linkedin", {
      failureRedirect: `${process.env.FRONTEND_URL}?error=linkedin_failed`,
    }),
    (req, res) => {
      try {
        const user = req.user as UserSession;
        
        if (!user) {
          return res.redirect(`${process.env.FRONTEND_URL}?error=no_user_data`);
        }
        
        const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET!, {
          expiresIn: "4h",
        });

        res.redirect(
          `${process.env.FRONTEND_URL}/?token=${token}&connected=linkedin`
        );
      } catch (error) {
        console.error('LinkedIn callback error:', error);
        res.redirect(`${process.env.FRONTEND_URL}?error=callback_failed`);
      }
    }
  );

  // Google OAuth routes
  app.get(
    "/api/auth/google",
    passport.authenticate("google", {
      scope: [
        "profile",
        "email",
        "https://www.googleapis.com/auth/documents.readonly",
        "https://www.googleapis.com/auth/drive.file"
      ],
      state: "google-connect",
    })
  );

  app.get(
    "/api/auth/google/callback",
    passport.authenticate("google", {
      failureRedirect: `${process.env.FRONTEND_URL}?error=google_failed`,
    }),
    (req, res) => {
      try {
        const user = req.user as UserSession;
        
        if (!user) {
          return res.redirect(`${process.env.FRONTEND_URL}?error=no_user_data`);
        }
        
        const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET!, {
          expiresIn: "4h",
        });

        res.redirect(
          `${process.env.FRONTEND_URL}/?token=${token}&connected=google`
        );
      } catch (error) {
        console.error('Google callback error:', error);
        res.redirect(`${process.env.FRONTEND_URL}?error=callback_failed`);
      }
    }
  );

  // Logout route
  app.post("/api/auth/logout", verifyToken, (req, res) => {
    try {
      const user = req.user!;
      activeSessions.delete(user.id);
      res.json({ message: "Logged out successfully" });
    } catch (error) {
      console.error('Logout error:', error);
      res.status(500).json({ error: 'Logout failed' });
    }
  });

  // Current user details
  app.get('/api/auth/me', verifyToken, (req, res) => {
    const user = req.user!;
    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      hasLinkedIn: !!user.linkedinToken,
      hasGoogle: !!user.googleToken,
      createdAt: user.createdAt,
      expiresAt: user.expiresAt
    });
  });

  // CONSOLIDATED User status endpoint - handles both auth and api status checks
  app.get('/api/user/status', verifyToken, async (req, res) => {
    console.log('=== AUTH.TS STATUS ENDPOINT HIT (CONSOLIDATED) ===');
    try {
      const user = req.user!;
      console.log('Session User ID:', user.id);
      console.log('Session User Email:', user.email);
      
      // First try to find by ID, then fallback to email if not found
      let dbUser = await UserModel.findById(user.id);
      
      if (!dbUser) {
        console.log('User not found by ID, trying email...');
        dbUser = await UserModel.findByEmail(user.email);
        
        if (dbUser) {
          console.log('Found user by email, ID mismatch detected!');
          console.log('Session ID:', user.id);
          console.log('Database ID:', dbUser.id);
        }
      }
      
      // Use the correct user ID for applications lookup
      const correctUserId = dbUser?.id || user.id;
      
      // Get applications for stats using the correct user ID
      const applications = await JobApplicationModel.findByUserId(correctUserId, 5);
      const totalApplications = applications.length;
      
      console.log('DEBUG - User found in DB:', !!dbUser);
      console.log('DEBUG - Using user ID:', correctUserId);
      console.log('DEBUG - User profileData exists:', !!dbUser?.profileData);
      console.log('DEBUG - User resumeText exists:', !!dbUser?.resumeText);
      console.log('DEBUG - User telegramChatId exists:', !!dbUser?.telegramChatId);
      
      let hasResume = false;
      
      if (dbUser) {
        // Check multiple possible locations for resume data
        if (dbUser.resumeText) {
          hasResume = true;
          console.log('DEBUG - Resume found in resumeText field');
        } else if (dbUser.profileData) {
          const profileData = dbUser.profileData as any;
          console.log('DEBUG - ProfileData keys:', Object.keys(profileData || {}));
          
          if (profileData?.resume_content && profileData.resume_content.length > 50) {
            hasResume = true;
            console.log('DEBUG - Resume found in profileData.resume_content, length:', profileData.resume_content.length);
          } else if (profileData?.resume_filename) {
            hasResume = true;
            console.log('DEBUG - Resume found via filename:', profileData.resume_filename);
          }
        }
      }
      
      console.log('DEBUG - Final hasResume value:', hasResume);
      console.log('DEBUG - Final telegramConfigured value:', !!dbUser?.telegramChatId);
      
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
        }
      };
      
      console.log('DEBUG - Sending consolidated response with telegramConfigured:', !!dbUser?.telegramChatId);
      res.json(response);
    } catch (error) {
      console.error('Error getting user status:', error);
      res.status(500).json({ error: 'Failed to get user status' });
    }
  });

  // Debug endpoints (development only)
  if (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV) {
    // Debug endpoint to identify user ID mismatch issues
    app.get('/api/debug/user-session', verifyToken, async (req, res) => {
      try {
        const sessionUser = req.user!;
        console.log('=== SESSION DEBUG ===');
        console.log('Session User ID:', sessionUser.id);
        console.log('Session User Email:', sessionUser.email);
        console.log('Session User Name:', sessionUser.name);
        
        // Try to find user by ID
        const userById = await UserModel.findById(sessionUser.id);
        console.log('Found by ID:', !!userById);
        
        // Try to find user by email
        const userByEmail = await UserModel.findByEmail(sessionUser.email);
        console.log('Found by Email:', !!userByEmail);
        
        if (userByEmail) {
          console.log('User by Email ID:', userByEmail.id);
          console.log('IDs match:', sessionUser.id === userByEmail.id);
          
          // Check resume content
          if (userByEmail.profileData) {
            const profileData = userByEmail.profileData as any;
            console.log('Has resume_content:', !!profileData?.resume_content);
            console.log('Resume content length:', profileData?.resume_content?.length || 0);
          }
        }
        
        res.json({
          sessionUserId: sessionUser.id,
          sessionUserEmail: sessionUser.email,
          foundById: !!userById,
          foundByEmail: !!userByEmail,
          actualUserId: userByEmail?.id,
          idsMatch: sessionUser.id === userByEmail?.id,
          hasResumeContent: !!(userByEmail?.profileData as any)?.resume_content,
          telegramConfigured: !!(userByEmail?.telegramChatId)
        });
      } catch (error) {
        console.error('Debug error:', error);
        res.status(500).json({ error: (error as Error).message });
      }
    });

    app.get('/api/debug/sessions', (req, res) => {
      res.json(getSessionStats());
    });

    app.post('/api/debug/clear-sessions', (req, res) => {
      activeSessions.clear();
      emailToSessionMap.clear();
      nameToSessionMap.clear();
      res.json({ message: 'All sessions cleared' });
    });

    // Additional debug endpoint for Prisma database inspection
    app.get('/api/debug/database-users', async (req, res) => {
      try {
        const users = await UserModel.findAutomationUsers();
        const allUsersByEmail = await Promise.all(
          ['manavadwani86@gmail.com'].map(async (email) => {
            const user = await UserModel.findByEmail(email);
            return { 
              email, 
              found: !!user, 
              id: user?.id, 
              hasProfileData: !!user?.profileData,
              telegramChatId: user?.telegramChatId || null
            };
          })
        );
        
        res.json({
          automationUsers: users.length,
          userLookups: allUsersByEmail,
          totalInDatabase: users.length
        });
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });
  }
}