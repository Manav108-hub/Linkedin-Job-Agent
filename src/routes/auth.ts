import { Express } from "express";
import passport from "passport";
import jwt from "jsonwebtoken";
import { UserSession } from "../types/index";
import { verifyToken, activeSessions, emailToSessionMap, nameToSessionMap, getSessionStats } from "../middleware/auth";
import { UserModel, JobApplicationModel } from "../database/db";
import { TelegramService } from "../services/TelegramService";

export default function authRoutes(app: Express) {
  // Initialize TelegramService
  const telegramService = new TelegramService();

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

  // === TELEGRAM SETUP ROUTES (MULTI-USER) ===

  // Setup Telegram for user
  app.post('/api/telegram/setup', verifyToken, async (req, res) => {
    try {
      const user = req.user!;
      const { chatId } = req.body;

      console.log(`🤖 Setting up Telegram for user: ${user.email}, Chat ID: ${chatId}`);

      // Validate chat ID format
      if (!chatId || !/^\d+$/.test(chatId)) {
        return res.status(400).json({ 
          success: false, 
          error: 'Invalid chat ID format. Must be numbers only.' 
        });
      }

      // Test sending a message to verify the chat ID works
      const testMessage = `🎉 Welcome to Job Agent Notifications!

Your Telegram is now connected successfully! ✅

You'll receive updates when:
✅ Jobs are automatically applied to
📄 Custom resumes are created  
💾 Files are saved to Google Drive
📊 Daily automation summaries

🤖 Daily automation runs at 9:00 AM IST
🔔 You can disable notifications anytime

Happy job hunting! 🚀

User: ${user.name}
Email: ${user.email}`;

      const messageSent = await telegramService.sendMessage(chatId, testMessage);
      
      if (!messageSent) {
        return res.status(400).json({ 
          success: false, 
          error: 'Could not send test message. Please check your chat ID and ensure you started the bot.' 
        });
      }

      // Update user's telegram_chat_id in database
      const updateResult = await telegramService.setUserChatId(user.email, chatId);
      
      if (!updateResult) {
        return res.status(500).json({ 
          success: false, 
          error: 'Failed to save Telegram settings to database.' 
        });
      }

      console.log(`✅ Telegram setup completed for ${user.email}`);

      res.json({ 
        success: true, 
        message: 'Telegram setup completed successfully! Check your Telegram for confirmation.',
        chatId: chatId
      });

    } catch (error) {
      console.error('Error setting up Telegram:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to setup Telegram. Please try again.' 
      });
    }
  });

  // Auto-detect chat ID for user
  app.get('/api/telegram/detect-chat/:userEmail', verifyToken, async (req, res) => {
    try {
      const user = req.user!;
      const { userEmail } = req.params;
      
      // Security check - users can only detect their own chat ID
      if (user.email !== userEmail) {
        return res.status(403).json({ 
          success: false, 
          error: 'Access denied' 
        });
      }
      
      console.log(`🔍 Detecting chat ID for user: ${userEmail}`);
      
      // Get recent updates from Telegram bot
      const botToken = process.env.TELEGRAM_BOT_TOKEN!;
      if (!botToken) {
        return res.status(500).json({ 
          success: false, 
          error: 'Telegram bot not configured' 
        });
      }

      const response = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates`);
      const data = await response.json();
      
      if (data.ok && data.result.length > 0) {
        // Get the most recent message's chat ID
        const latestMessage = data.result[data.result.length - 1];
        const chatId = latestMessage.message?.chat?.id;
        
        if (chatId) {
          console.log(`📱 Auto-detected chat ID: ${chatId} for ${userEmail}`);
          res.json({ 
            success: true, 
            chatId: chatId.toString() 
          });
          return;
        }
      }
      
      console.log(`❌ No chat ID detected for ${userEmail}`);
      res.json({ 
        success: false, 
        chatId: null, 
        message: 'No recent messages found. Please send a message to the bot first.' 
      });
      
    } catch (error) {
      console.error('Error detecting chat ID:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to detect chat ID' 
      });
    }
  });

  // Test Telegram for user
  app.post('/api/telegram/test', verifyToken, async (req, res) => {
    try {
      const user = req.user!;
      
      console.log(`🧪 Testing Telegram for user: ${user.email}`);
      
      const success = await telegramService.sendTestNotification(user.email);
      
      if (success) {
        res.json({ 
          success: true, 
          message: 'Test notification sent successfully! Check your Telegram.' 
        });
      } else {
        res.status(400).json({ 
          success: false, 
          error: 'Failed to send test notification. Please check your Telegram setup.' 
        });
      }
      
    } catch (error) {
      console.error('Error testing Telegram:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to test Telegram' 
      });
    }
  });

  // Get Telegram status for user
  app.get('/api/telegram/status', verifyToken, async (req, res) => {
    try {
      const user = req.user!;
      
      // Check if user has telegram_chat_id configured
      const dbUser = await UserModel.findByEmail(user.email);
      const isConfigured = !!(dbUser?.telegramChatId || process.env.TELEGRAM_CHAT_ID);
      
      // Get bot info
      let botInfo = null;
      try {
        botInfo = await telegramService.getBotInfo();
      } catch (error) {
        console.error('Error getting bot info:', error);
      }
      
      res.json({
        success: true,
        configured: isConfigured,
        userChatId: dbUser?.telegramChatId || null,
        botInfo: botInfo ? {
          username: botInfo.result?.username,
          firstName: botInfo.result?.first_name
        } : null,
        instructions: {
          step1: `Search for @${botInfo?.result?.username || 'your_bot'} on Telegram`,
          step2: 'Send /start to the bot',
          step3: 'Send any message like "Hello"',
          step4: 'Use auto-detect or manual setup below'
        }
      });
      
    } catch (error) {
      console.error('Error getting Telegram status:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to get Telegram status' 
      });
    }
  });

  // Remove Telegram setup for user
  app.delete('/api/telegram/setup', verifyToken, async (req, res) => {
    try {
      const user = req.user!;
      
      console.log(`🗑️ Removing Telegram setup for user: ${user.email}`);
      
      // Remove telegram_chat_id from database
      const success = await telegramService.setUserChatId(user.email, '');
      
      if (success) {
        res.json({ 
          success: true, 
          message: 'Telegram notifications disabled successfully.' 
        });
      } else {
        res.status(500).json({ 
          success: false, 
          error: 'Failed to remove Telegram setup' 
        });
      }
      
    } catch (error) {
      console.error('Error removing Telegram setup:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to remove Telegram setup' 
      });
    }
  });

  // === EXISTING ROUTES CONTINUE ===

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

    // Debug Telegram for all users
    app.get('/api/debug/telegram-users', async (req, res) => {
      try {
        const users = await UserModel.findAutomationUsers();
        const telegramStatus = await Promise.all(
          users.map(async (user) => {
            const chatId = await telegramService.getChatIdForUser(user.email);
            return {
              email: user.email,
              name: user.name,
              hasChatId: !!chatId,
              chatId: chatId,
              automationEnabled: user.automationEnabled
            };
          })
        );
        
        res.json({
          totalUsers: users.length,
          telegramUsers: telegramStatus.filter(u => u.hasChatId).length,
          usersWithTelegram: telegramStatus
        });
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });
  }
}