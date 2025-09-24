// src/services/TelegramService.ts - Enhanced with rich notifications
import { UserModel } from "../database/db";

export class TelegramService {
  private botToken: string;

  constructor() {
    this.botToken = process.env.TELEGRAM_BOT_TOKEN || "";
    if (!this.botToken) {
      console.warn(
        "TELEGRAM_BOT_TOKEN not configured - Telegram features disabled"
      );
    }
  }

  async getBotInfo() {
    if (!this.botToken) {
      throw new Error("Telegram bot token not configured");
    }

    const response = await fetch(
      `https://api.telegram.org/bot${this.botToken}/getMe`
    );
    return await response.json();
  }

  // NEW: Enhanced job application notification with application status
  async sendJobApplicationNotification(
    userEmail: string,
    jobData: any,
    driveLink?: string | null,
    applicationDetails?: {
      actuallyApplied: boolean;
      applicationMethod: string;
      applicationDetails: string;
    }
  ): Promise<boolean> {
    try {
      const user = await UserModel.findByEmail(userEmail);
      if (!user || !user.telegramChatId) {
        console.log(`No Telegram chat ID for user: ${userEmail}`);
        return false;
      }

      const message = this.formatEnhancedJobNotification(
        jobData,
        driveLink,
        applicationDetails
      );
      const result = await this.sendMessage(user.telegramChatId, message);

      if (result.success) {
        console.log(`✅ Telegram notification sent to ${userEmail}`);
      } else {
        console.log(
          `❌ Failed to send Telegram notification to ${userEmail}: ${result.message}`
        );
      }

      return result.success;
    } catch (error) {
      console.error("Error sending job notification:", error);
      return false;
    }
  }

  // Enhanced notification formatting
  private formatEnhancedJobNotification(
    jobData: any,
    driveLink?: string | null,
    applicationDetails?: {
      actuallyApplied: boolean;
      applicationMethod: string;
      applicationDetails: string;
    }
  ): string {
    const matchEmoji =
      jobData.matchScore >= 80 ? "🎯" : jobData.matchScore >= 60 ? "✅" : "📝";
    const applicationEmoji = applicationDetails?.actuallyApplied ? "🚀" : "⚠️";

    let message = `${applicationEmoji} <b>Job Application Update</b>

🏢 <b>${jobData.company}</b>
💼 ${jobData.title}
📍 ${jobData.location || "Location not specified"}
📊 Match Score: ${jobData.matchScore || "N/A"}%

${matchEmoji} Resume: ${
      jobData.resumeCustomized ? "AI-Customized ✨" : "Original"
    }`;

    // Application status
    if (applicationDetails) {
      if (applicationDetails.actuallyApplied) {
        message += `\n\n🚀 <b>STATUS: SUCCESSFULLY APPLIED!</b>`;
        message += `\n📤 Method: ${this.formatApplicationMethod(
          applicationDetails.applicationMethod
        )}`;
      } else {
        message += `\n\n⚠️ <b>STATUS: Application Attempted</b>`;
        message += `\n🔧 Method: ${this.formatApplicationMethod(
          applicationDetails.applicationMethod
        )}`;
        message += `\n💡 <i>May require manual completion</i>`;
      }
    }

    // Drive link
    if (driveLink) {
      message += `\n💾 <a href="${driveLink}">📄 View Resume in Drive</a>`;
    }

    // Timestamp
    message += `\n\n⏰ Processed: ${new Date().toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
    })}`;

    return message;
  }

  private formatApplicationMethod(method: string): string {
    switch (method) {
      case "easy_apply":
        return "LinkedIn Easy Apply 🔵";
      case "external_redirect":
        return "External Company Portal 🌐";
      case "workday_redirect":
        return "Workday ATS 🏢";
      case "ats_redirect":
        return "Applicant Tracking System 📊";
      case "generic_apply":
        return "Direct Application 📝";
      case "no_apply_button":
        return "No Apply Button Found ❌";
      default:
        return method.replace(/_/g, " ").toUpperCase();
    }
  }

  async sendErrorNotification(
    userEmail: string,
    errorMessage: string
  ): Promise<boolean> {
    try {
      const user = await UserModel.findByEmail(userEmail);
      if (!user || !user.telegramChatId) {
        console.log(`No Telegram chat ID for user: ${userEmail}`);
        return false;
      }

      const message = `🚨 <b>Automation Error</b>

❌ Your daily job automation encountered an error:

<code>${errorMessage}</code>

🔧 <b>What to do:</b>
• Check your LinkedIn/Google authentication
• Verify your automation settings  
• Contact support if the issue persists

⏰ Time: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`;

      const result = await this.sendMessage(user.telegramChatId, message);
      return result.success;
    } catch (error) {
      console.error("Error sending error notification:", error);
      return false;
    }
  }

  // Enhanced daily summary with more details
  async sendDailySummary(
    userEmail: string,
    summary: { applied: number; found: number; skipped: number; errors: number }
  ): Promise<boolean> {
    try {
      const user = await UserModel.findByEmail(userEmail);
      if (!user || !user.telegramChatId) {
        return false;
      }

      const successRate =
        summary.found > 0
          ? Math.round((summary.applied / summary.found) * 100)
          : 0;
      const statusEmoji =
        summary.applied > 0 ? "🎉" : summary.errors > 0 ? "⚠️" : "💤";

      const message = `${statusEmoji} <b>Daily Job Automation Summary</b>
📅 ${new Date().toLocaleDateString("en-IN")}

📊 <b>Results:</b>
🎯 Jobs Found: ${summary.found}
✅ Successfully Applied: ${summary.applied}
⏭️ Skipped (duplicates): ${summary.skipped}
❌ Errors: ${summary.errors}
📈 Success Rate: ${successRate}%

${this.getDailySummaryMessage(summary)}

💾 All resumes are automatically saved to Google Drive!
🔔 Individual notifications sent for each application.`;

      const result = await this.sendMessage(user.telegramChatId, message);
      return result.success;
    } catch (error) {
      console.error("Error sending daily summary:", error);
      return false;
    }
  }

  private getDailySummaryMessage(summary: {
    applied: number;
    found: number;
    skipped: number;
    errors: number;
  }): string {
    if (summary.applied > 0) {
      return `Great progress today! ${summary.applied} applications submitted.`;
    } else if (summary.errors > 0) {
      return `Some issues occurred. Check your authentication settings.`;
    } else if (summary.found === 0) {
      return `No new jobs found. Consider expanding your search criteria.`;
    } else if (summary.skipped === summary.found) {
      return `All jobs were duplicates. Your automation is working - no new opportunities today.`;
    } else {
      return `Jobs found but no applications made. Check application requirements.`;
    }
  }

  async sendAutomationStartNotification(userEmail: string): Promise<boolean> {
    try {
      const user = await UserModel.findByEmail(userEmail);
      if (!user || !user.telegramChatId) {
        return false;
      }

      const message = `<b>Daily Automation Started</b>

Good morning! Your job automation is now running...

Searching for new job opportunities
Will customize resumes using AI
Saving to Google Drive automatically
You'll get notifications for each application

Started: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`;

      const result = await this.sendMessage(user.telegramChatId, message);
      return result.success;
    } catch (error) {
      console.error("Error sending automation start notification:", error);
      return false;
    }
  }

  // ADD this method to your TelegramService.ts class:

async sendDailyJobSuggestions(
  userEmail: string,
  jobSuggestions: any[]
): Promise<boolean> {
  try {
    const user = await UserModel.findByEmail(userEmail);
    if (!user || !user.telegramChatId) {
      console.log(`No Telegram chat ID for user: ${userEmail}`);
      return false;
    }

    // Format the suggestions message
    const message = this.formatJobSuggestionsMessage(jobSuggestions);
    
    const result = await this.sendMessage(user.telegramChatId, message);

    if (result.success) {
      console.log(`✅ Daily suggestions sent to ${userEmail}`);
    } else {
      console.log(`❌ Failed to send daily suggestions: ${result.message}`);
    }

    return result.success;
  } catch (error) {
    console.error("Error sending daily job suggestions:", error);
    return false;
  }
}

private formatJobSuggestionsMessage(jobSuggestions: any[]): string {
  const date = new Date().toLocaleDateString("en-IN");
  const topJobs = jobSuggestions
    .sort((a, b) => b.analysis.matchScore - a.analysis.matchScore)
    .slice(0, 5);

  let message = `🌅 <b>Daily Job Recommendations</b> - ${date}

Found <b>${jobSuggestions.length}</b> new opportunities for you!

<b>🎯 TOP MATCHES:</b>
`;

  topJobs.forEach((suggestion, index) => {
    const job = suggestion.job;
    const analysis = suggestion.analysis;
    const matchEmoji = analysis.matchScore >= 80 ? "🎯" : 
                      analysis.matchScore >= 60 ? "✅" : "📝";
    
    message += `
${matchEmoji} <b>${job.title}</b> - ${job.company}
📍 ${job.location || "Location TBD"}
📊 Match: <b>${analysis.matchScore}%</b>
💡 Key suggestion: ${suggestion.suggestions[0] || "Review job details"}
🔗 <a href="${job.url}">Apply Here</a>

`;
  });

  if (jobSuggestions.length > 5) {
    message += `📋 <b>+${jobSuggestions.length - 5} more jobs</b> analyzed for you!
`;
  }

  message += `
📄 <b>Detailed suggestions saved to Google Drive</b>
📊 <b>Excel report with all jobs available for download</b>

💾 All recommendations are saved for your review.
🎯 Apply to jobs that match your interests!

⏰ Next update: Tomorrow at 9 AM IST`;

  return message;
}

  // Get recent chat updates to find user's chat ID
  async detectUserChatId(
    userEmail: string
  ): Promise<{ success: boolean; chatId?: string; message: string }> {
    if (!this.botToken) {
      return { success: false, message: "Telegram bot not configured" };
    }

    try {
      const response = await fetch(
        `https://api.telegram.org/bot${this.botToken}/getUpdates`
      );
      const data = await response.json();

      if (!data.ok || !data.result || data.result.length === 0) {
        return {
          success: false,
          message:
            "No recent messages found. Please send /start to the bot first.",
        };
      }

      // Look for recent messages (last 10)
      const recentMessages = data.result.slice(-10);

      // Find unique chat IDs from recent messages
      const chatIds = [
        ...new Set(
          recentMessages
            .map((update: any) => update.message?.chat?.id)
            .filter(Boolean)
        ),
      ];

      if (chatIds.length === 1) {
        const chatId = chatIds[0].toString();
        return {
          success: true,
          chatId,
          message: `Auto-detected chat ID: ${chatId}`,
        };
      } else if (chatIds.length > 1) {
        return {
          success: false,
          message: `Multiple users detected. Please use manual setup.`,
        };
      } else {
        return {
          success: false,
          message: "No valid chat found. Please send /start to the bot.",
        };
      }
    } catch (error) {
      console.error("Error detecting chat ID:", error);
      return {
        success: false,
        message: "Failed to detect chat ID. Please use manual setup.",
      };
    }
  }

  // Setup user-specific Telegram configuration
  async setupUserTelegram(
    userEmail: string,
    chatId: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      // Validate chat ID format
      if (!/^\d+$/.test(chatId)) {
        return {
          success: false,
          message: "Invalid chat ID format. Must be numbers only.",
        };
      }

      // Test sending a message to verify the chat ID works
      const testResult = await this.sendMessage(
        chatId,
        "Telegram setup successful! You will now receive job application notifications here."
      );

      if (!testResult.success) {
        return {
          success: false,
          message: "Failed to send test message. Please check your chat ID.",
        };
      }

      // Save chat ID to user profile
      const user = await UserModel.findByEmail(userEmail);
      if (!user) {
        return { success: false, message: "User not found" };
      }

      await UserModel.updateAutomationSettings(user.id, {
        telegramChatId: chatId,
        automationEnabled: user.automationEnabled,
        preferredKeywords: String(user.preferredKeywords),
        preferredLocation: user.preferredLocation,
        experienceLevel: user.experienceLevel,
      });

      return {
        success: true,
        message: "Telegram configured successfully! Check your messages.",
      };
    } catch (error) {
      console.error("Error setting up Telegram:", error);
      return { success: false, message: "Setup failed. Please try again." };
    }
  }

  // Test user's Telegram configuration
  async testUserTelegram(
    userEmail: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      const user = await UserModel.findByEmail(userEmail);
      if (!user || !user.telegramChatId) {
        return {
          success: false,
          message: "Telegram not configured for this user",
        };
      }

      const result = await this.sendMessage(
        user.telegramChatId,
        `Test successful! Your Job Agent AI is connected.\n\nTime: ${new Date().toLocaleString(
          "en-IN",
          { timeZone: "Asia/Kolkata" }
        )}`
      );

      return result;
    } catch (error) {
      console.error("Error testing Telegram:", error);
      return { success: false, message: "Test failed" };
    }
  }

  // Generic send message method
  private async sendMessage(
    chatId: string,
    message: string
  ): Promise<{ success: boolean; message: string }> {
    if (!this.botToken) {
      return { success: false, message: "Bot token not configured" };
    }

    try {
      const response = await fetch(
        `https://api.telegram.org/bot${this.botToken}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: message,
            parse_mode: "HTML",
          }),
        }
      );

      const data = await response.json();

      if (data.ok) {
        return { success: true, message: "Message sent successfully" };
      } else {
        console.error("Telegram API error:", data);
        return {
          success: false,
          message: data.description || "Failed to send message",
        };
      }
    } catch (error) {
      console.error("Network error sending Telegram message:", error);
      return { success: false, message: "Network error occurred" };
    }
  }

  // Legacy method for backward compatibility
  async sendTestNotification(userEmail: string): Promise<boolean> {
    const result = await this.testUserTelegram(userEmail);
    return result.success;
  }

  // Add missing methods needed by auth.ts
  async setUserChatId(userEmail: string, chatId: string): Promise<boolean> {
    try {
      const user = await UserModel.findByEmail(userEmail);
      if (!user) {
        return false;
      }

      await UserModel.updateAutomationSettings(user.id, {
        telegramChatId: chatId || undefined,
        automationEnabled: user.automationEnabled,
        preferredKeywords: String(user.preferredKeywords),
        preferredLocation: user.preferredLocation,
        experienceLevel: user.experienceLevel,
      });

      return true;
    } catch (error) {
      console.error("Error setting chat ID:", error);
      return false;
    }
  }

  async getChatIdForUser(userEmail: string): Promise<string | null> {
    try {
      const user = await UserModel.findByEmail(userEmail);
      return user?.telegramChatId || null;
    } catch (error) {
      return null;
    }
  }
}
