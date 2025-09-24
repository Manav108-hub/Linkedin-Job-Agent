import { Express } from "express";
import { Server as SocketServer } from "socket.io";
import { verifyToken } from "../middleware/auth";
import { JobService } from "../services/JobService";
import { HRExtractorService } from "../services/HrExtractorService";
import { TelegramService } from "../services/TelegramService";
import { GoogleDriveService } from "../services/GoogleDriveService";
import { AutomationService } from "../services/AutomationService";
import { JobSearchCriteria } from "../types/index";
import {
  UserModel,
  JobApplicationModel,
  HRContactModel,
  ResumeModel,
  EmailDraftModel,
  AutomationLogModel,
  NotificationLogModel,
} from "../database/db";
import multer, { FileFilterCallback } from "multer";
import fs from "fs";
import path from "path";
import cron from "node-cron";
import pdf from "pdf-parse";
import mammoth from "mammoth";
import { GeminiService } from "../services/GeminiService";
import { LinkedInService } from "../services/LinkedInService";

const jobService = new JobService();
const hrExtractor = new HRExtractorService();
const telegramService = new TelegramService();

// Initialize automation service
const automationService = new AutomationService();

// Configure multer for file uploads
const upload = multer({
  dest: "uploads/",
  fileFilter: (req, file, callback: FileFilterCallback) => {
    const allowedTypes = [".pdf", ".doc", ".docx", ".txt"];
    const ext = path.extname(file.originalname).toLowerCase();

    if (allowedTypes.includes(ext)) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

// Helper function to get actual database user (FIXED FOR ALL ENDPOINTS)
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

export default function apiRoutes(app: Express, io: SocketServer) {
  // ========================================
  // AUTOMATION ENDPOINTS
  // ========================================

  // Start automation service
  if (process.env.ENABLE_AUTOMATION === "true") {
    console.log("🤖 Starting Job Automation Service...");
    automationService.startAutomation();
  }

  // Test Telegram notifications
  app.post("/api/automation/test-telegram", async (req, res) => {
    try {
      const { userEmail } = req.body;

      if (!userEmail) {
        return res.status(400).json({ error: "userEmail is required" });
      }

      console.log(`🧪 Testing Telegram for user: ${userEmail}`);

      const success = await telegramService.sendTestNotification(userEmail);

      if (success) {
        res.json({
          success: true,
          message: "Test notification sent successfully!",
          timestamp: new Date().toISOString(),
        });
      } else {
        res.status(400).json({
          success: false,
          message:
            "Failed to send test notification. Check your Telegram chat ID configuration.",
        });
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error("❌ Test Telegram error:", errorMessage);
      res.status(500).json({ error: errorMessage });
    }
  });

  // Test Google Drive connection - UPDATED VERSION
  app.post("/api/automation/test-drive", async (req, res) => {
    try {
      const { userEmail } = req.body;

      if (!userEmail) {
        return res.status(400).json({
          success: false,
          error: "userEmail is required",
        });
      }

      console.log(`🧪 Testing Google Drive for user: ${userEmail}`);

      const user = await UserModel.findByEmail(userEmail);
      if (!user) {
        console.log(`❌ User not found: ${userEmail}`);
        return res.status(404).json({
          success: false,
          error: "User not found",
        });
      }

      console.log("User found:", user.email);
      console.log("Google token exists:", !!user.googleToken);
      console.log("Google refresh token exists:", !!user.googleRefreshToken);
      console.log(
        "Google token preview:",
        user.googleToken ? user.googleToken.substring(0, 20) + "..." : "null"
      );

      // Check if user has Google token
      if (!user.googleToken) {
        console.log(`❌ No Google token for user: ${userEmail}`);
        return res.status(400).json({
          success: false,
          error:
            "Google account not connected. Please connect your Google account first.",
          debug: {
            userExists: true,
            hasGoogleToken: false,
            hasRefreshToken: !!user.googleRefreshToken,
          },
        });
      }

      // Validate environment variables
      if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
        console.log("❌ Google OAuth environment variables missing");
        return res.status(500).json({
          success: false,
          error: "Google OAuth not configured on server",
        });
      }

      // Create GoogleDriveService instance
      let driveService;
      try {
        driveService = new GoogleDriveService(
          user.googleToken,
          user.googleRefreshToken || undefined
        );
        console.log("✅ GoogleDriveService created successfully");
      } catch (serviceError: unknown) {
        const errorMessage =
          serviceError instanceof Error
            ? serviceError.message
            : String(serviceError);
        console.log("❌ Failed to create GoogleDriveService:", errorMessage);
        return res.status(500).json({
          success: false,
          error: `Failed to initialize Google Drive service: ${errorMessage}`,
        });
      }

      // Test connection first
      console.log("Testing Google Drive connection...");
      const testResult = await driveService.testConnection();
      console.log("Connection test result:", testResult);

      if (!testResult.success) {
        return res.status(400).json({
          success: false,
          error: testResult.message,
          details: testResult.details,
        });
      }

      // Test creating a sample file
      const testFileName = `Test_File_${
        new Date().toISOString().split("T")[0]
      }.txt`;
      const testContent = `This is a test file created on ${new Date().toLocaleString(
        "en-IN",
        { timeZone: "Asia/Kolkata" }
      )}

User: ${user.name}
Email: ${user.email}

This file verifies that your Google Drive integration is working correctly.
You can safely delete this file.

Test completed successfully! ✅`;

      console.log("Creating test file:", testFileName);

      const driveLink = await driveService.saveResume(
        testContent,
        testFileName,
        "Test Position",
        "Test Company"
      );

      if (driveLink) {
        console.log("✅ Test file created successfully:", driveLink);
        res.json({
          success: true,
          message: testResult.message,
          testFileLink: driveLink,
          testFileName: testFileName,
          timestamp: new Date().toISOString(),
          details: testResult.details,
        });
      } else {
        console.log("❌ Failed to create test file");
        res.status(500).json({
          success: false,
          error: "Failed to create test file in Google Drive",
        });
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error("❌ Test Drive error:", errorMessage);
      console.error(
        "Error stack:",
        error instanceof Error ? error.stack : "No stack trace"
      );

      res.status(500).json({
        success: false,
        error: errorMessage,
        details: "Check server logs for more information",
      });
    }
  });

  // Get Telegram bot info
  app.get("/api/automation/telegram-info", async (req, res) => {
    try {
      const botInfo = await telegramService.getBotInfo();
      res.json({
        success: true,
        botInfo: botInfo.result,
        configured: !!process.env.TELEGRAM_BOT_TOKEN,
      });
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      res.status(400).json({
        success: false,
        error: errorMessage,
        configured: !!process.env.TELEGRAM_BOT_TOKEN,
      });
    }
  });

  // Manual trigger automation for testing
  app.post("/api/automation/trigger-automation", async (req, res) => {
    try {
      const { userEmail } = req.body;

      if (!userEmail) {
        return res.status(400).json({ error: "userEmail is required" });
      }

      console.log(`🎯 Manual automation trigger for: ${userEmail}`);

      const result = await automationService.triggerManualAutomation(userEmail);

      res.json({
        success: true,
        message: result.message,
        timestamp: new Date().toISOString(),
      });
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error("❌ Manual automation error:", errorMessage);
      res.status(500).json({ error: errorMessage });
    }
  });

  // FIXED: Get user's automation status with proper user lookup
  app.get("/api/automation/status/:userEmail", async (req, res) => {
    try {
      const { userEmail } = req.params;

      const user = await UserModel.findByEmail(userEmail);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // ✅ Use database user ID for stats
      const stats = await jobService.getUserApplicationStats(user.id);

      const status = {
        user: {
          email: user.email,
          name: user.name,
          automationEnabled: user.automationEnabled !== false,
          hasLinkedInToken: !!user.linkedinToken,
          hasGoogleToken: !!user.googleToken,
          hasTelegramChatId: !!user.telegramChatId,
          preferredKeywords: user.preferredKeywords
            ? JSON.parse(user.preferredKeywords as string)
            : [],
          preferredLocation: user.preferredLocation || "India",
        },
        applicationStats: stats,
        integrations: {
          telegram: {
            configured: !!process.env.TELEGRAM_BOT_TOKEN,
            userConfigured: !!user.telegramChatId,
          },
          googleDrive: {
            configured: !!user.googleToken,
            canSave: !!user.googleToken,
          },
          linkedin: {
            configured: !!user.linkedinToken,
          },
        },
      };

      res.json(status);
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error("❌ Status check error:", errorMessage);
      res.status(500).json({ error: errorMessage });
    }
  });

  // Update user automation settings
  app.post("/api/automation/settings", async (req, res) => {
    try {
      const {
        userEmail,
        automationEnabled,
        telegramChatId,
        preferredKeywords,
        preferredLocation,
        experienceLevel,
      } = req.body;

      if (!userEmail) {
        return res.status(400).json({ error: "userEmail is required" });
      }

      const user = await UserModel.findByEmail(userEmail);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Update user settings
      await UserModel.updateAutomationSettings(user.id, {
        automationEnabled:
          automationEnabled !== undefined
            ? automationEnabled
            : user.automationEnabled,
        telegramChatId: telegramChatId || user.telegramChatId,
        preferredKeywords: preferredKeywords
          ? JSON.stringify(preferredKeywords)
          : (user.preferredKeywords as string),
        preferredLocation: preferredLocation || user.preferredLocation,
        experienceLevel: experienceLevel || user.experienceLevel,
      });

      res.json({
        success: true,
        message: "Automation settings updated successfully",
        timestamp: new Date().toISOString(),
      });
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error("❌ Settings update error:", errorMessage);
      res.status(500).json({ error: errorMessage });
    }
  });

  // FIXED: Get recent automation logs with proper user lookup
  app.get("/api/automation/logs/:userEmail", async (req, res) => {
    try {
      const { userEmail } = req.params;
      const limit = parseInt(req.query.limit as string) || 10;

      const user = await UserModel.findByEmail(userEmail);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // ✅ Use database user ID
      const logs = await AutomationLogModel.findByUserId(user.id, limit);

      res.json({
        success: true,
        logs,
        timestamp: new Date().toISOString(),
      });
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error("❌ Logs retrieval error:", errorMessage);
      res.status(500).json({ error: errorMessage });
    }
  });

  // Verify job application status
  app.post("/api/automation/verify-application", async (req, res) => {
    try {
      const { jobUrl } = req.body;

      if (!jobUrl) {
        return res.status(400).json({ error: "jobUrl is required" });
      }

      const verification = await jobService.verifyJobApplication(jobUrl);

      res.json({
        success: true,
        verification,
        timestamp: new Date().toISOString(),
      });
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error("❌ Application verification error:", errorMessage);
      res.status(500).json({ error: errorMessage });
    }
  });

  // Health check endpoint
  app.get("/api/automation/health", (req, res) => {
    res.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || "development",
      features: {
        automation: process.env.ENABLE_AUTOMATION === "true",
        telegram: !!process.env.TELEGRAM_BOT_TOKEN,
        geminiAI: !!process.env.GEMINI_API_KEY,
        googleOAuth: !!process.env.GOOGLE_CLIENT_ID,
      },
    });
  });

  // ========================================
  // FIXED JOB & RESUME ENDPOINTS
  // ========================================

  // Resume upload endpoint
  app.post(
    "/api/user/resume",
    verifyToken,
    upload.single("resume"),
    async (req, res) => {
      console.log("=== RESUME UPLOAD ENDPOINT HIT ===");
      console.log("User:", req.user?.email);
      console.log("File:", req.file?.originalname, "Type:", req.file?.mimetype);

      try {
        const sessionUser = req.user!;
        const file = req.file;

        if (!file) {
          return res.status(400).json({ error: "No resume file provided" });
        }

        // ✅ Get actual database user
        const dbUser = await getActualDatabaseUser(sessionUser);
        if (!dbUser) {
          return res.status(404).json({ error: "User not found in database" });
        }

        // Extract text content based on file type
        let resumeContent = "";
        let textExtractionSuccess = false;
        const fileExtension = path.extname(file.originalname).toLowerCase();

        try {
          switch (fileExtension) {
            case ".pdf":
              resumeContent = await extractPDFText(file.path);
              textExtractionSuccess = true;
              break;

            case ".doc":
            case ".docx":
              resumeContent = await extractDocText(file.path);
              textExtractionSuccess = true;
              break;

            case ".txt":
              const rawContent = fs.readFileSync(file.path, "utf8");
              resumeContent = sanitizeTextContent(rawContent);
              textExtractionSuccess = true;
              break;

            default:
              throw new Error(`Unsupported file type: ${fileExtension}`);
          }
        } catch (extractionError) {
          console.log(
            "Text extraction failed, creating placeholder:",
            extractionError instanceof Error
              ? extractionError.message
              : String(extractionError)
          );
          resumeContent = createPlaceholderContent(file);
          textExtractionSuccess = false;
        }

        console.log("Processed resume content length:", resumeContent.length);
        console.log("Text extraction success:", textExtractionSuccess);

        // Validate content length
        if (resumeContent.length < 50) {
          console.log("Content too short, creating fallback content");
          resumeContent = createPlaceholderContent(file);
          textExtractionSuccess = false;
        }

        // Get existing profile data
        const existingProfileData = (dbUser.profileData as any) || {};

        // Create sanitized profile data
        const sanitizedProfileData = {
          ...existingProfileData,
          resume_content: resumeContent,
          resume_filename: file.originalname,
          resume_uploaded_at: new Date().toISOString(),
          resume_size: file.size,
          resume_type: file.mimetype,
          text_extraction_success: textExtractionSuccess,
        };

        console.log("Saving sanitized profile data...");

        // ✅ Update user profile with resume using database user ID
        await UserModel.create({
          id: dbUser.id, // Use database user ID
          name: dbUser.name,
          email: dbUser.email,
          profileData: sanitizedProfileData,
        });

        console.log("Resume saved successfully");

        // Clean up temporary file
        fs.unlinkSync(file.path);

        res.json({
          message: "Resume uploaded successfully",
          filename: file.originalname,
          size: file.size,
          contentLength: resumeContent.length,
          type: file.mimetype,
          textExtracted: textExtractionSuccess,
          extractionMethod:
            fileExtension === ".pdf"
              ? "PDF parsing"
              : [".doc", ".docx"].includes(fileExtension)
              ? "Word parsing"
              : fileExtension === ".txt"
              ? "Direct text"
              : "Placeholder",
        });
      } catch (error) {
        console.error("Resume upload error:", error);

        if (req.file) {
          try {
            fs.unlinkSync(req.file.path);
          } catch (cleanupError) {
            console.error("File cleanup error:", cleanupError);
          }
        }

        res.status(500).json({
          error: "Failed to upload resume",
          details: error instanceof Error ? error.message : String(error),
        });
      }
    }
  );

  // FIXED: Get user's current resume
  app.get("/api/user/resume", verifyToken, async (req, res) => {
    try {
      const sessionUser = req.user!;

      // ✅ Get actual database user
      const dbUser = await getActualDatabaseUser(sessionUser);
      if (!dbUser || !dbUser.profileData) {
        return res.status(404).json({ error: "No resume found" });
      }

      const profileData = dbUser.profileData as any;

      if (!profileData.resume_content) {
        return res.status(404).json({ error: "No resume content found" });
      }

      res.json({
        content: profileData.resume_content,
        filename: profileData.resume_filename,
        uploadedAt: profileData.resume_uploaded_at,
        size: profileData.resume_size,
      });
    } catch (error) {
      console.error("Error getting resume:", error);
      res.status(500).json({ error: "Failed to get resume" });
    }
  });

  // FIXED: Start job search
  app.post("/api/jobs/start", verifyToken, async (req, res) => {
    console.log("=== JOB START ENDPOINT HIT ===");
    console.log("Request body:", req.body);
    console.log("User:", req.user?.email);

    const sessionUser = req.user!;

    // ✅ Get actual database user
    const dbUser = await getActualDatabaseUser(sessionUser);
    if (!dbUser) {
      return res.status(404).json({ error: "User not found in database" });
    }

    if (!sessionUser.linkedinToken) {
      console.log("ERROR: No LinkedIn token");
      return res.status(400).json({
        error: "LinkedIn account not connected",
        needsConnection: ["linkedin"],
      });
    }

    if (!sessionUser.googleToken) {
      console.log("ERROR: No Google token");
      return res.status(400).json({
        error: "Google account not connected",
        needsConnection: ["google"],
      });
    }

    const criteria: JobSearchCriteria = {
      keywords: req.body.keywords || ["typescript", "react", "node.js"],
      location: req.body.location || "",
      experienceLevel: req.body.experienceLevel || "mid-level",
      jobType: req.body.jobType || "full-time",
    };

    console.log("Job search criteria:", criteria);

    const userSocket = Array.from(io.sockets.sockets.values()).find(
      (socket) => (socket as any).userId === sessionUser.id
    );

    console.log("User socket found:", !!userSocket);

    if (!userSocket) {
      console.log("ERROR: No socket connection found");
      return res.status(400).json({ error: "Real-time connection required" });
    }

    console.log("SUCCESS: Starting job search for user");
    res.json({
      message: "Job search started",
      sessionId: sessionUser.id,
      criteria,
    });

    // ✅ Pass session user (with tokens) to job service
    jobService
      .processJobsForUser(sessionUser, userSocket, criteria)
      .catch((error) => {
        console.error("Job processing failed:", error);
        userSocket.emit("job_search_error", {
          error: "Job search encountered an error",
        });
      });
  });

  // FIXED: Get job application history
  app.get("/api/jobs/history", verifyToken, async (req, res) => {
    try {
      const sessionUser = req.user!;
      const limit = parseInt(req.query.limit as string) || 50;

      console.log(
        `Getting history for session user: ${sessionUser.email} (ID: ${sessionUser.id})`
      );

      // ✅ Get actual database user by email
      const dbUser = await getActualDatabaseUser(sessionUser);
      if (!dbUser) {
        console.log(`Database user not found for email: ${sessionUser.email}`);
        return res.status(404).json({ error: "User not found in database" });
      }

      console.log(
        `Found database user ID: ${dbUser.id} (email: ${dbUser.email})`
      );

      // ✅ Use the correct database user ID
      const applications = await JobApplicationModel.findByUserId(
        dbUser.id, // Use actual database user ID
        limit
      );

      console.log(
        `Found ${applications.length} applications for user ${dbUser.email}`
      );

      res.json({
        applications,
        total: applications.length,
        userId: dbUser.id, // Return database user ID
        sessionUserId: sessionUser.id, // For debugging
        debug: {
          sessionId: sessionUser.id,
          databaseId: dbUser.id,
          idMismatch: sessionUser.id !== dbUser.id,
        },
      });
    } catch (error) {
      console.error("Error getting job history:", error);
      res.status(500).json({ error: "Failed to get job history" });
    }
  });

  // FIXED: Get specific job application details
  app.get("/api/jobs/:jobId", verifyToken, async (req, res) => {
    try {
      const sessionUser = req.user!;
      const { jobId } = req.params;

      // ✅ Get actual database user
      const dbUser = await getActualDatabaseUser(sessionUser);
      if (!dbUser) {
        return res.status(404).json({ error: "User not found in database" });
      }

      const application = await JobApplicationModel.findById(jobId);
      if (!application || application.userId !== dbUser.id) {
        return res.status(404).json({ error: "Job application not found" });
      }

      const hrContacts = await HRContactModel.findByJobId(application.jobId);
      const resume = await ResumeModel.findByUserAndJob(
        dbUser.id, // Use database user ID
        application.jobId
      );
      const emailDrafts = await EmailDraftModel.findByJobId(application.jobId);

      res.json({
        application,
        hrContacts,
        resume,
        emailDrafts,
      });
    } catch (error) {
      console.error("Error getting job details:", error);
      res.status(500).json({ error: "Failed to get job details" });
    }
  });

  // FIXED: Get customized resume for specific job
  app.get("/api/jobs/:jobId/resume", verifyToken, async (req, res) => {
    try {
      const sessionUser = req.user!;
      const { jobId } = req.params;

      // ✅ Get actual database user
      const dbUser = await getActualDatabaseUser(sessionUser);
      if (!dbUser) {
        return res.status(404).json({ error: "User not found in database" });
      }

      const application = await JobApplicationModel.findById(jobId);
      if (!application || application.userId !== dbUser.id) {
        return res.status(404).json({ error: "Job not found" });
      }

      const resume = await ResumeModel.findByUserAndJob(
        dbUser.id, // Use database user ID
        application.jobId
      );
      if (!resume) {
        return res.status(404).json({ error: "Resume not found" });
      }

      res.json({
        id: resume.id,
        jobId: application.jobId,
        originalContent: resume.originalContent,
        customizedContent: resume.customizedContent,
        formatType: resume.formatType,
        createdAt: resume.createdAt,
      });
    } catch (error) {
      console.error("Error getting resume:", error);
      res.status(500).json({ error: "Failed to get resume" });
    }
  });

  // FIXED: Generate email draft for HR contact
  app.post("/api/jobs/:jobId/email-draft", verifyToken, async (req, res) => {
    try {
      const sessionUser = req.user!;
      const { jobId } = req.params;
      const { hrContactId, emailType = "application" } = req.body;

      // ✅ Get actual database user
      const dbUser = await getActualDatabaseUser(sessionUser);
      if (!dbUser) {
        return res.status(404).json({ error: "User not found in database" });
      }

      const application = await JobApplicationModel.findById(jobId);
      if (!application || application.userId !== dbUser.id) {
        return res.status(404).json({ error: "Job not found" });
      }

      let hrContact = null;
      if (hrContactId) {
        hrContact = await HRContactModel.findById(hrContactId);
      } else {
        const contacts = await HRContactModel.findByJobId(application.jobId);
        hrContact = contacts[0] || null;
      }

      if (!hrContact) {
        return res.status(404).json({ error: "HR contact not found" });
      }

      const resume = await ResumeModel.findByUserAndJob(
        dbUser.id, // Use database user ID
        application.jobId
      );
      const userSkills = ["TypeScript", "React", "Node.js"];

      const formattedContact = {
        id: hrContact.id,
        name: hrContact.name || undefined,
        email: hrContact.email || undefined,
        title: hrContact.title || undefined,
        company: hrContact.company || undefined,
        linkedinProfile: hrContact.linkedinProfile || undefined,
        phone: hrContact.phone || undefined,
        jobId: hrContact.jobId,
        extractedAt: hrContact.extractedAt,
      };

      const emailDraft = hrExtractor.generateEmailDraft(
        formattedContact,
        "Position",
        dbUser.name, // Use database user name
        userSkills
      );

      const savedDraft = await EmailDraftModel.create({
        userId: dbUser.id, // Use database user ID
        jobId: application.jobId,
        hrContactId: hrContact.id || "",
        subject: emailDraft.subject,
        body: emailDraft.body,
        emailType: emailType,
      });

      res.json({
        draftId: savedDraft?.id,
        hrContact: {
          name: hrContact.name,
          email: hrContact.email,
          title: hrContact.title,
        },
        emailDraft,
      });
    } catch (error) {
      console.error("Error generating email draft:", error);
      res.status(500).json({ error: "Failed to generate email draft" });
    }
  });

  // FIXED: Get all user's resumes
  app.get("/api/resumes", verifyToken, async (req, res) => {
    try {
      const sessionUser = req.user!;

      // ✅ Get actual database user
      const dbUser = await getActualDatabaseUser(sessionUser);
      if (!dbUser) {
        return res.status(404).json({ error: "User not found in database" });
      }

      const resumes = await ResumeModel.findByUserId(dbUser.id);

      res.json({
        resumes: resumes.map((resume: any) => ({
          id: resume.id,
          jobTitle: resume.jobListing?.title,
          company: resume.jobListing?.company,
          formatType: resume.formatType,
          createdAt: resume.createdAt,
        })),
      });
    } catch (error) {
      console.error("Error getting resumes:", error);
      res.status(500).json({ error: "Failed to get resumes" });
    }
  });

  // FIXED: Update job application status
  app.put("/api/jobs/:jobId/status", verifyToken, async (req, res) => {
    try {
      const sessionUser = req.user!;
      const { jobId } = req.params;
      const { status, notes } = req.body;

      // ✅ Get actual database user
      const dbUser = await getActualDatabaseUser(sessionUser);
      if (!dbUser) {
        return res.status(404).json({ error: "User not found in database" });
      }

      const application = await JobApplicationModel.findById(jobId);
      if (!application || application.userId !== dbUser.id) {
        return res.status(404).json({ error: "Job not found" });
      }

      await JobApplicationModel.updateStatus(jobId, status, notes);

      res.json({
        message: "Status updated successfully",
        jobId,
        newStatus: status,
      });
    } catch (error) {
      console.error("Error updating job status:", error);
      res.status(500).json({ error: "Failed to update job status" });
    }
  });

  // FIXED: Update user profile
  app.put("/api/user/profile", verifyToken, async (req, res) => {
    try {
      const sessionUser = req.user!;
      const { name, email, profile_data, resume_doc_id } = req.body;

      // ✅ Get actual database user
      const dbUser = await getActualDatabaseUser(sessionUser);
      if (!dbUser) {
        return res.status(404).json({ error: "User not found in database" });
      }

      await UserModel.create({
        id: dbUser.id, // Use database user ID
        name: name || dbUser.name,
        email: email || dbUser.email,
        profileData: profile_data,
        resumeDocId: resume_doc_id,
      });

      res.json({
        message: "Profile updated successfully",
        user: { name, email },
      });
    } catch (error) {
      console.error("Error updating user profile:", error);
      res.status(500).json({ error: "Failed to update profile" });
    }
  });

  // FIXED: Get HR contacts for a specific job
  app.get("/api/jobs/:jobId/hr-contacts", verifyToken, async (req, res) => {
    try {
      const sessionUser = req.user!;
      const { jobId } = req.params;

      // ✅ Get actual database user
      const dbUser = await getActualDatabaseUser(sessionUser);
      if (!dbUser) {
        return res.status(404).json({ error: "User not found in database" });
      }

      const application = await JobApplicationModel.findById(jobId);
      if (!application || application.userId !== dbUser.id) {
        return res.status(404).json({ error: "Job not found" });
      }

      const hrContacts = await HRContactModel.findByJobId(application.jobId);

      res.json({
        jobId: application.jobId,
        contacts: hrContacts,
      });
    } catch (error) {
      console.error("Error getting HR contacts:", error);
      res.status(500).json({ error: "Failed to get HR contacts" });
    }
  });

  // ========================================
  // DEBUG ENDPOINT
  // ========================================

  // Debug endpoint to check user session vs database mismatch
  app.get("/api/debug/user-session", verifyToken, async (req, res) => {
    try {
      const sessionUser = req.user!;

      console.log("=== DEBUG USER SESSION ===");
      console.log("Session User ID:", sessionUser.id);
      console.log("Session User Email:", sessionUser.email);

      // Try to find by session ID
      const userById = await UserModel.findById(sessionUser.id);
      console.log("Found by session ID:", !!userById);

      // Try to find by email
      const userByEmail = await UserModel.findByEmail(sessionUser.email);
      console.log("Found by email:", !!userByEmail);

      if (userByEmail) {
        console.log("Database User ID:", userByEmail.id);
        console.log("ID Mismatch:", sessionUser.id !== userByEmail.id);
      }

      // Check applications count for both IDs
      let applicationsBySessionId = 0;
      let applicationsByDatabaseId = 0;

      try {
        const sessionApps = await JobApplicationModel.findByUserId(
          sessionUser.id,
          10
        );
        applicationsBySessionId = sessionApps.length;
      } catch (error) {
        console.log("Error getting applications by session ID:", error);
      }

      if (userByEmail) {
        try {
          const dbApps = await JobApplicationModel.findByUserId(
            userByEmail.id,
            10
          );
          applicationsByDatabaseId = dbApps.length;
        } catch (error) {
          console.log("Error getting applications by database ID:", error);
        }
      }

      res.json({
        debug: {
          sessionUser: {
            id: sessionUser.id,
            email: sessionUser.email,
            name: sessionUser.name,
          },
          lookupResults: {
            foundBySessionId: !!userById,
            foundByEmail: !!userByEmail,
            databaseUserId: userByEmail?.id || null,
            idMismatch: userByEmail ? sessionUser.id !== userByEmail.id : null,
          },
          applicationCounts: {
            bySessionId: applicationsBySessionId,
            byDatabaseId: applicationsByDatabaseId,
          },
          recommendation:
            userByEmail && sessionUser.id !== userByEmail.id
              ? "Use email lookup for database operations"
              : "IDs match, no issues detected",
        },
      });
    } catch (error) {
      console.error("Debug endpoint error:", error);
      res.status(500).json({
        error: "Debug failed",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // ========================================
  // HELPER FUNCTIONS
  // ========================================

  // Helper function to extract text from PDF
  async function extractPDFText(filePath: string): Promise<string> {
    try {
      const dataBuffer = fs.readFileSync(filePath);
      const pdfData = await pdf(dataBuffer);

      let text = pdfData.text;

      // Clean up PDF text
      text = text
        .replace(/\s+/g, " ") // Normalize whitespace
        .replace(/\n\s*\n/g, "\n\n") // Clean up line breaks
        .trim();

      return sanitizeTextContent(text);
    } catch (error) {
      console.error("PDF extraction error:", error);
      throw new Error("Failed to extract text from PDF");
    }
  }

  // Helper function to extract text from DOC/DOCX
  async function extractDocText(filePath: string): Promise<string> {
    try {
      const result = await mammoth.extractRawText({ path: filePath });

      if (result.messages && result.messages.length > 0) {
        console.log("Mammoth messages:", result.messages);
      }

      let text = result.value;

      // Clean up document text
      text = text
        .replace(/\s+/g, " ") // Normalize whitespace
        .replace(/\n\s*\n/g, "\n\n") // Clean up line breaks
        .trim();

      return sanitizeTextContent(text);
    } catch (error) {
      console.error("DOC extraction error:", error);
      throw new Error("Failed to extract text from document");
    }
  }

  // Helper function to sanitize text content
  function sanitizeTextContent(content: string): string {
    if (!content) return "";

    try {
      // Remove null bytes and other problematic characters
      let sanitized = content
        .replace(/\u0000/g, "") // Remove null bytes
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "") // Remove control characters except \n, \r, \t
        .replace(/\uFFFD/g, "") // Remove replacement characters
        .replace(/[^\x20-\x7E\n\r\t\u00A0-\uFFFF]/g, "") // Keep only printable characters
        .trim();

      // Ensure content is valid UTF-8
      sanitized = Buffer.from(sanitized, "utf8").toString("utf8");

      // Limit content length to prevent issues
      if (sanitized.length > 50000) {
        sanitized =
          sanitized.substring(0, 50000) +
          "\n\n[Content truncated due to length]";
      }

      // Ensure minimum content length
      if (sanitized.length < 50) {
        throw new Error("Content too short after sanitization");
      }

      return sanitized;
    } catch (error) {
      console.error("Error sanitizing content:", error);
      throw error;
    }
  }

  // Helper function to create placeholder content when text extraction fails
  function createPlaceholderContent(file: any): string {
    return `Resume Document: ${file.originalname}

File Information:
- Uploaded: ${new Date().toLocaleString()}
- Size: ${(file.size / 1024).toFixed(1)} KB
- Type: ${file.mimetype}

IMPORTANT: Text extraction from this file was not successful. 
For best results with AI resume customization, please:

1. Convert your resume to plain text (.txt) format, or
2. Copy and paste your resume content into a text file and re-upload

This file has been saved and the system will work with the available information,
but AI customization may be limited without the actual resume text content.

You can still use the job search functionality, and the system will use
this document reference for your applications.`;
  }

  app.get(
    "/api/telegram/detect-chat/:userEmail",
    verifyToken,
    async (req, res) => {
      try {
        const { userEmail } = req.params;
        const sessionUser = req.user!;

        // Security check - users can only detect their own chat ID
        if (sessionUser.email !== userEmail) {
          return res
            .status(403)
            .json({ success: false, message: "Access denied" });
        }

        const result = await telegramService.detectUserChatId(userEmail);
        res.json(result);
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.error("Error detecting chat ID:", errorMessage);
        res.status(500).json({ success: false, message: "Detection failed" });
      }
    }
  );

  // ADD these endpoints to your api.ts file:

  // Generate and save job suggestions document to Google Drive
  app.post(
    "/api/jobs/generate-suggestions-doc",
    verifyToken,
    async (req, res) => {
      try {
        const sessionUser = req.user!;
        const dbUser = await getActualDatabaseUser(sessionUser);

        if (!dbUser) {
          return res.status(404).json({ error: "User not found" });
        }

        // FIX: Get recent job applications instead of JobListingModel
        const recentApplications = await JobApplicationModel.findByUserId(
          dbUser.id,
          10
        );

        if (recentApplications.length === 0) {
          return res.status(404).json({
            error: "No recent job applications found. Run job search first.",
          });
        }

        // Convert applications to job suggestions format
        const jobSuggestions = recentApplications.map((app) => ({
          job: {
            id: app.id,
            title: app.jobListing?.title || "Unknown Title",
            company: app.jobListing?.company || "Unknown Company",
            location: app.jobListing?.location || "Location TBD",
            url: app.jobUrl || "#",
          },
          analysis: {
            matchScore: app.matchScore || 70,
            missingSkills: ["Skills analysis not available"],
            recommendations: app.notes
              ? [app.notes]
              : ["Review job requirements"],
          },
          suggestions: [
            `Customize resume for ${app.jobListing?.title || "this position"}`,
            `Research ${app.jobListing?.company || "the company"} thoroughly`,
            `Prepare specific examples for interview questions`,
          ],
        }));

        // Create a simple HTML document (fallback method)
        const htmlDocument = createSimpleSuggestionsDocument(
          { name: dbUser.name, email: dbUser.email },
          jobSuggestions
        );

        // Save to Google Drive if user has access
        let driveLink = null;
        if (sessionUser.googleToken) {
          try {
            const driveService = new GoogleDriveService(
              sessionUser.googleToken,
              sessionUser.googleRefreshToken
            );

            const fileName = `Job_Suggestions_${
              new Date().toISOString().split("T")[0]
            }.html`;

            // Use existing saveResume method to save HTML file
            driveLink = await driveService.saveResume(
              htmlDocument,
              fileName,
              "Job Suggestions",
              "Daily Report"
            );

            console.log("Suggestions document saved to Drive:", fileName);
          } catch (driveError) {
            console.log("Failed to save to Drive:", driveError);
          }
        }

        res.json({
          success: true,
          documentGenerated: true,
          jobsIncluded: jobSuggestions.length,
          driveLink: driveLink,
          message: driveLink
            ? "Suggestions document created and saved to Google Drive!"
            : "Suggestions document created (Google Drive not available)",
        });
      } catch (error) {
        console.error("Error generating suggestions document:", error);
        res
          .status(500)
          .json({ error: "Failed to generate suggestions document" });
      }
    }
  );

  // Export job suggestions to Excel
  // app.get("/api/jobs/export-excel", verifyToken, async (req, res) => {
  //   try {
  //     const sessionUser = req.user!;
  //     const dbUser = await getActualDatabaseUser(sessionUser);

  //     if (!dbUser) {
  //       return res.status(404).json({ error: "User not found" });
  //     }

  //     const days = parseInt(req.query.days as string) || 7;

  //     // Get job data from database
  //     const jobs = await JobListingModel.findRecentByUser(dbUser.id, 50, days);

  //     if (jobs.length === 0) {
  //       return res.status(404).json({
  //         error: `No jobs found in the last ${days} days`
  //       });
  //     }

  //     // Create Excel data structure
  //     const excelData = jobs.map(job => ({
  //       'Job Title': job.title,
  //       'Company': job.company,
  //       'Location': job.location || '',
  //       'Posted Date': job.postedDate ? new Date(job.postedDate).toLocaleDateString() : '',
  //       'Match Score': job.matchScore || 'N/A',
  //       'Status': job.applicationStatus || 'Not Applied',
  //       'Job URL': job.url || '',
  //       'Description Preview': job.description ?
  //         job.description.substring(0, 200) + '...' : '',
  //       'Suggestions Count': job.suggestions ? job.suggestions.length : 0,
  //       'Missing Skills': job.missingSkills ? job.missingSkills.join(', ') : '',
  //       'Date Added': job.createdAt ? new Date(job.createdAt).toLocaleDateString() : ''
  //     }));

  //     // Generate Excel file using a simple approach
  //     const csvContent = convertToCSV(excelData);
  //     const fileName = `Job_Suggestions_${new Date().toISOString().split('T')[0]}.csv`;

  //     // Save to Google Drive if available
  //     let driveLink = null;
  //     if (sessionUser.googleToken) {
  //       try {
  //         const driveService = new GoogleDriveService(
  //           sessionUser.googleToken,
  //           sessionUser.googleRefreshToken
  //         );

  //         driveLink = await driveService.saveSpreadsheet(
  //           csvContent,
  //           fileName,
  //           "Job Suggestions Export"
  //         );
  //       } catch (driveError) {
  //         console.log("Failed to save Excel to Drive:", driveError);
  //       }
  //     }

  //     res.json({
  //       success: true,
  //       fileName: fileName,
  //       jobsExported: jobs.length,
  //       driveLink: driveLink,
  //       csvContent: csvContent,
  //       message: driveLink ?
  //         "Excel export saved to Google Drive!" :
  //         "Excel data generated (download CSV below)"
  //     });

  //   } catch (error) {
  //     console.error("Error exporting to Excel:", error);
  //     res.status(500).json({ error: "Failed to export to Excel" });
  //   }
  // });

  app.get("/api/jobs/export-csv", verifyToken, async (req, res) => {
    try {
      const sessionUser = req.user!;
      const dbUser = await getActualDatabaseUser(sessionUser);

      if (!dbUser) {
        return res.status(404).json({ error: "User not found" });
      }

      // Use existing JobApplicationModel
      const applications = await JobApplicationModel.findByUserId(
        dbUser.id,
        100
      );

      if (applications.length === 0) {
        return res.status(404).json({
          error: "No job applications found. Run job search first.",
        });
      }

      const csvData = applications.map((app) => ({
        "Application Date": app.appliedAt
          ? new Date(app.appliedAt).toLocaleDateString()
          : "",
        "Job Title": app.jobListing?.title || "N/A",
        Company: app.jobListing?.company || "N/A",
        Location: app.jobListing?.location || "N/A",
        "Match Score": app.matchScore || "N/A",
        Status: app.status || "N/A",
        "Resume Customized": app.resumeCustomized ? "Yes" : "No",
        "Job URL": app.jobUrl || app.jobListing?.url || "",
        Notes: app.notes || "",
        "Drive Link": app.driveLink || "",
      }));

      const csv = convertToCSV(csvData);
      const fileName = `job_applications_${
        new Date().toISOString().split("T")[0]
      }.csv`;

      // Save to Google Drive if available
      let driveLink = null;
      if (sessionUser.googleToken) {
        try {
          const driveService = new GoogleDriveService(
            sessionUser.googleToken,
            sessionUser.googleRefreshToken
          );

          driveLink = await driveService.saveResume(
            csv,
            fileName,
            "Job Applications Export",
            "CSV Data"
          );
        } catch (driveError) {
          console.log("Failed to save CSV to Drive:", driveError);
        }
      }

      res.json({
        success: true,
        fileName: fileName,
        applicationsExported: applications.length,
        driveLink: driveLink,
        csvContent: csv,
        message: driveLink
          ? "CSV export saved to Google Drive!"
          : "CSV data generated successfully",
      });
    } catch (error) {
      console.error("Error exporting to CSV:", error);
      res.status(500).json({ error: "Failed to export to CSV" });
    }
  });

  // Download CSV directly
  // Add this endpoint to your auth.ts file, in the COMMON AUTH ROUTES section

// Simple CSV download endpoint (compatible with frontend)
app.get("/api/jobs/download-csv", verifyToken, async (req, res) => {
  console.log("🔍 SIMPLE CSV DOWNLOAD ENDPOINT HIT!");
  try {
    const sessionUser = req.user!;
    const { type = "applied" } = req.query;

    console.log(`=== SIMPLE CSV DOWNLOAD ===`);
    console.log(`User: ${sessionUser.email}`);
    console.log(`Type: ${type}`);

    // Get actual database user
    const dbUser = await getActualDatabaseUser(sessionUser);
    if (!dbUser) {
      return res.status(404).json({ error: "User not found in database" });
    }

    let csvData = "";
    let filename = "";

    if (type === "applied" || type === "all") {
      // Get user's applications
      const applications = await JobApplicationModel.findByUserId(dbUser.id, 100);

      console.log(`Found ${applications.length} applications for CSV`);

      // Simple CSV headers for compatibility
      const headers = ["Date", "Job Title", "Company", "Status", "Match Score", "Job URL"];
      csvData = headers.join(",") + "\n";

      // Add application data
      for (const app of applications) {
        const jobListing = app.jobListing || {
          title: "Unknown Position",
          company: "Unknown Company",
        };

        const row = [
          app.appliedAt ? new Date(app.appliedAt).toLocaleDateString() : "",
          `"${jobListing.title || "Unknown Position"}"`,
          `"${jobListing.company || "Unknown Company"}"`,
          app.status || "unknown",
          app.matchScore || 0,
          app.jobUrl || "",
        ];

        csvData += row.join(",") + "\n";
      }

      filename = `job_applications_${sessionUser.email.split("@")[0]}_${
        new Date().toISOString().split("T")[0]
      }.csv`;
    } else if (type === "available") {
      // Get available jobs
      const jobSearchResults = await getAvailableJobs(dbUser);

      const headers = ["Job Title", "Company", "Location", "Job URL", "Source", "Application Method"];
      csvData = headers.join(",") + "\n";

      for (const job of jobSearchResults) {
        const applicationMethod = determineApplicationMethod(job);

        const row = [
          `"${job.title}"`,
          `"${job.company}"`,
          `"${job.location}"`,
          job.url || "",
          job.source || "Unknown",
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
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");

    console.log(`✅ Simple CSV export completed: ${filename}`);
    res.send(csvData);
  } catch (error) {
    console.error("Error in simple CSV download:", error);
    res.status(500).json({ error: "Failed to download CSV" });
  }
});
  // Helper function to create simple suggestions document
  function createSimpleSuggestionsDocument(
    userInfo: any,
    jobSuggestions: any[]
  ): string {
    const date = new Date().toLocaleDateString();

    const jobsHtml = jobSuggestions
      .slice(0, 10)
      .map((suggestion) => {
        const matchScore = suggestion.analysis.matchScore || 70;
        const matchColor =
          matchScore >= 80
            ? "#4CAF50"
            : matchScore >= 60
            ? "#FF9800"
            : "#F44336";

        return `
      <div class="job-card">
        <div class="job-header">
          <h3>${suggestion.job.title}</h3>
          <div class="company">${suggestion.job.company}</div>
        </div>
        <div class="match-score" style="background-color: ${matchColor}; color: white; padding: 5px 10px; border-radius: 15px; display: inline-block; margin: 10px 0;">
          ${matchScore}% Match
        </div>
        <div class="location">📍 ${suggestion.job.location}</div>
        <div class="suggestions">
          <h4>💡 Recommendations:</h4>
          <ul>
            ${suggestion.suggestions.map((s) => `<li>${s}</li>`).join("")}
          </ul>
        </div>
        <div class="apply-link">
          <a href="${
            suggestion.job.url
          }" style="background: #0066cc; color: white; padding: 8px 15px; text-decoration: none; border-radius: 5px;">Apply Now</a>
        </div>
      </div>
    `;
      })
      .join("");

    return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Job Suggestions Report - ${userInfo.name}</title>
      <style>
        body { 
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
          max-width: 1000px; 
          margin: 0 auto; 
          padding: 20px; 
          background: #f5f5f5; 
        }
        .header { 
          text-align: center; 
          background: white; 
          padding: 30px; 
          border-radius: 10px; 
          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
          margin-bottom: 30px; 
        }
        .job-card { 
          background: white; 
          border-radius: 10px; 
          padding: 25px; 
          margin-bottom: 20px; 
          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
          transition: transform 0.2s;
        }
        .job-card:hover {
          transform: translateY(-2px);
        }
        .job-header h3 { 
          color: #333; 
          margin: 0 0 5px 0; 
          font-size: 1.4em;
        }
        .company { 
          color: #666; 
          font-size: 1.1em; 
          font-weight: 500;
        }
        .location {
          color: #888;
          margin: 10px 0;
        }
        .suggestions ul { 
          padding-left: 20px; 
          color: #555;
        }
        .suggestions li { 
          margin-bottom: 8px; 
          line-height: 1.4;
        }
        .suggestions h4 {
          color: #333;
          margin: 15px 0 10px 0;
        }
        .apply-link {
          margin-top: 15px;
        }
        .stats {
          background: #e3f2fd;
          padding: 15px;
          border-radius: 8px;
          margin: 20px 0;
          text-align: center;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>🎯 Daily Job Suggestions Report</h1>
        <p><strong>${userInfo.name}</strong> | ${userInfo.email}</p>
        <p>Generated on: ${date}</p>
        <div class="stats">
          <strong>${jobSuggestions.length}</strong> opportunities analyzed for you
        </div>
      </div>
      ${jobsHtml}
      <div style="text-align: center; margin-top: 40px; color: #666;">
        <p>💼 Keep applying and stay consistent!</p>
        <p>📊 This report was automatically generated by your Job Agent AI</p>
      </div>
    </body>
    </html>
  `;
  }

  // Helper function to convert JSON to CSV (keep existing)
  function convertToCSV(data: any[]): string {
    if (data.length === 0) return "";

    const headers = Object.keys(data[0]);
    const csvHeaders = headers.join(",");

    const csvRows = data.map((row) =>
      headers
        .map((header) => {
          const value = row[header];
          // Escape commas and quotes in CSV
          if (
            typeof value === "string" &&
            (value.includes(",") || value.includes('"'))
          ) {
            return `"${value.replace(/"/g, '""')}"`;
          }
          return value || "";
        })
        .join(",")
    );

    return [csvHeaders, ...csvRows].join("\n");
  }

  // Helper function to convert JSON to CSV

  app.post("/api/telegram/setup", verifyToken, async (req, res) => {
    try {
      const sessionUser = req.user!;
      const { chatId } = req.body;

      if (!chatId) {
        return res
          .status(400)
          .json({ success: false, error: "Chat ID is required" });
      }

      // Get actual database user
      const dbUser = await getActualDatabaseUser(sessionUser);
      if (!dbUser) {
        return res
          .status(404)
          .json({ success: false, error: "User not found in database" });
      }

      const result = await telegramService.setupUserTelegram(
        dbUser.email,
        chatId
      );

      if (result.success) {
        res.json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error("Error setting up Telegram:", errorMessage);
      res.status(500).json({ success: false, error: "Setup failed" });
    }
  });

  // Test user's Telegram configuration
  app.post("/api/telegram/test", verifyToken, async (req, res) => {
    try {
      const sessionUser = req.user!;

      // Get actual database user
      const dbUser = await getActualDatabaseUser(sessionUser);
      if (!dbUser) {
        return res
          .status(404)
          .json({ success: false, error: "User not found in database" });
      }

      const result = await telegramService.testUserTelegram(dbUser.email);

      if (result.success) {
        res.json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error("Error testing Telegram:", errorMessage);
      res.status(500).json({ success: false, error: "Test failed" });
    }
  });
}
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

    // Ensure we always return an array
    return Array.isArray(jobs) ? jobs : [];
  } catch (error) {
    console.error("Error fetching available jobs:", error);
    return []; // Explicitly return empty array on error
  }
}

function determineApplicationMethod(job: any) {
  throw new Error("Function not implemented.");
}

