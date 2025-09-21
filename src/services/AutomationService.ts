// src/services/AutomationService.ts - Main automation orchestrator
import cron from "node-cron";
import { JobService } from "./JobService";
import { TelegramService } from "./TelegramService";
import { GoogleDriveService } from "./GoogleDriveService";
import { UserModel, JobApplicationModel } from "../database/db";
import { UserSession, JobSearchCriteria } from "../types";

export class AutomationService {
  private jobService: JobService;
  private telegramService: TelegramService;

  constructor() {
    this.jobService = new JobService();
    this.telegramService = new TelegramService();
  }

  startAutomation() {
    console.log("🤖 Starting Job Automation Service...");

    // Schedule daily job search at 9 AM IST
    cron.schedule(
      "0 9 * * *",
      async () => {
        console.log(
          "🌅 Daily job automation triggered at",
          new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
        );
        await this.runDailyJobSearch();
      },
      {
        timezone: "Asia/Kolkata",
      }
    );

    // For testing - run every 5 minutes (enable for testing, disable in production)
    if (process.env.NODE_ENV === "development") {
      cron.schedule("*/30 * * * *", async () => {
        console.log("🔄 Test automation triggered");
        await this.runDailyJobSearch();
      });
    }

    console.log("⏰ Automation scheduled for 9:00 AM IST daily");
  }

  private async runDailyJobSearch() {
    try {
      console.log("🚀 Starting daily job automation...");

      // Get users who have automation enabled
      const automationUsers = await this.getAutomationUsers();

      if (automationUsers.length === 0) {
        console.log("📭 No users found with automation enabled");
        return;
      }

      console.log(
        `👥 Found ${automationUsers.length} users with automation enabled`
      );

      for (const user of automationUsers) {
        try {
          console.log(`🎯 Processing automation for user: ${user.email}`);
          await this.processUserAutomation(user);

          // Add delay between users to avoid rate limits
          await this.sleep(10000); // 10 seconds between users
        } catch (error: unknown) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          console.error(
            `❌ Automation failed for user ${user.email}:`,
            errorMessage
          );
          await this.telegramService.sendErrorNotification(
            user.email,
            errorMessage
          );
        }
      }

      console.log("✅ Daily automation completed for all users");
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error("❌ Daily automation failed:", errorMessage);
    }
  }

  private async processUserAutomation(user: UserSession) {
    // Get user's job preferences from database or use defaults
    const criteria: JobSearchCriteria = {
      keywords: user.preferredKeywords || [
        "typescript",
        "react",
        "node.js",
        "frontend",
        "fullstack",
      ],
      location: user.preferredLocation || "India",
      experienceLevel:
        (user.experienceLevel as
          | "mid-level"
          | "entry-level"
          | "senior-level"
          | "executive") || "mid-level",
      jobType: "full-time",
    };

    console.log(
      `📋 Search criteria for ${user.email}:`,
      JSON.stringify(criteria, null, 2)
    );

    // Get jobs already applied to (for duplicate prevention)
    const existingApplications = await JobApplicationModel.findByUserId(
      user.id,
      200
    );
    const appliedJobUrls = new Set(
      existingApplications
        .map((app) => app.jobListing.url)
        .filter((url): url is string => url !== null)
    );

    console.log(
      `📊 User has ${appliedJobUrls.size} previous applications to skip`
    );

    // Run automated job search
    const results = await this.jobService.processJobsAutomated(
      user,
      criteria,
      appliedJobUrls
    );

    // Send summary notification
    await this.telegramService.sendDailySummary(user.email, results);

    console.log(`✅ Automation completed for ${user.email}:`, results);
  }

  private async getAutomationUsers(): Promise<UserSession[]> {
    try {
      // Get users who have both LinkedIn and Google tokens (automation ready)
      const users = await UserModel.findAutomationUsers();
      const validUsers = users.filter((user) => {
        const hasLinkedIn =
          user.linkedinToken && typeof user.linkedinToken === "string";
        const hasGoogle =
          user.googleToken && typeof user.googleToken === "string";
        const automationEnabled = user.automationEnabled !== false; // default to true

        console.log(
          `User ${
            user.email
          }: LinkedIn=${!!hasLinkedIn}, Google=${!!hasGoogle}, Automation=${automationEnabled}`
        );

        return hasLinkedIn && hasGoogle && automationEnabled;
      });

      console.log(
        `Found ${validUsers.length} valid automation users out of ${users.length} total users`
      );
      return validUsers.map((user) => ({
        ...user,
        linkedinToken: user.linkedinToken || undefined,
        googleToken: user.googleToken || undefined,
        googleRefreshToken: user.googleRefreshToken || undefined,
        linkedinId: user.linkedinId || undefined,
        googleId: user.googleId || undefined,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      }));
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error("Error getting automation users:", errorMessage);
      return [];
    }
  }

  // Manual trigger for testing
  async triggerManualAutomation(userEmail: string): Promise<any> {
    try {
      const users = await UserModel.findAutomationUsers();
      const user = users.find((u: { email: string }) => u.email === userEmail);

      if (!user) {
        throw new Error(
          `User ${userEmail} not found or not automation-enabled`
        );
      }

      const userSession = {
        ...user,
        linkedinToken: user.linkedinToken || undefined,
        googleToken: user.googleToken || undefined,
        googleRefreshToken: user.googleRefreshToken || undefined,
        linkedinId: user.linkedinId || undefined,
        googleId: user.googleId || undefined,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        profileData: user.profileData || {
          skills: [],
          experience: undefined,
          education: undefined,
          location: undefined,
          phone: undefined,
          website: undefined,
          resume_content: undefined,
          resume_filename: undefined,
          resume_uploaded_at: undefined,
          resume_size: undefined
        }
      };

      console.log(`🎯 Manual automation triggered for: ${userEmail}`);
      await this.processUserAutomation(userSession);

      return { success: true, message: "Manual automation completed" };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error("Manual automation error:", errorMessage);
      throw error;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
