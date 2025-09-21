// src/services/TelegramService.ts - User-specific Telegram setup
import { UserModel } from '../database/db';

export class TelegramService {
  private botToken: string;
  
  constructor() {
    this.botToken = process.env.TELEGRAM_BOT_TOKEN || '';
    if (!this.botToken) {
      console.warn('TELEGRAM_BOT_TOKEN not configured - Telegram features disabled');
    }
  }

  async getBotInfo() {
    if (!this.botToken) {
      throw new Error('Telegram bot token not configured');
    }

    const response = await fetch(`https://api.telegram.org/bot${this.botToken}/getMe`);
    return await response.json();
  }

  async sendErrorNotification(userEmail: string, errorMessage: string): Promise<boolean> {
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

⏰ Time: ${new Date().toLocaleString('en-IN', {timeZone: 'Asia/Kolkata'})}`;

    const result = await this.sendMessage(user.telegramChatId, message);
    return result.success;
  } catch (error) {
    console.error('Error sending error notification:', error);
    return false;
  }
}

// Add automation status notification
async sendAutomationStartNotification(userEmail: string): Promise<boolean> {
  try {
    const user = await UserModel.findByEmail(userEmail);
    if (!user || !user.telegramChatId) {
      return false;
    }

    const message = `🤖 <b>Daily Automation Started</b>

🌅 Good morning! Your job automation is now running...

🔍 Searching for new job opportunities
📝 Will customize resumes using AI
💾 Saving to Google Drive automatically
📲 You'll get notifications for each application

⏰ Started: ${new Date().toLocaleString('en-IN', {timeZone: 'Asia/Kolkata'})}`;

    const result = await this.sendMessage(user.telegramChatId, message);
    return result.success;
  } catch (error) {
    console.error('Error sending automation start notification:', error);
    return false;
  }
}

  // Get recent chat updates to find user's chat ID
  async detectUserChatId(userEmail: string): Promise<{success: boolean, chatId?: string, message: string}> {
    if (!this.botToken) {
      return {success: false, message: 'Telegram bot not configured'};
    }

    try {
      const response = await fetch(`https://api.telegram.org/bot${this.botToken}/getUpdates`);
      const data = await response.json();

      if (!data.ok || !data.result || data.result.length === 0) {
        return {success: false, message: 'No recent messages found. Please send /start to the bot first.'};
      }

      // Look for recent messages (last 10)
      const recentMessages = data.result.slice(-10);
      
      // Find unique chat IDs from recent messages
      const chatIds = [...new Set(recentMessages.map((update: any) => update.message?.chat?.id).filter(Boolean))];
      
      if (chatIds.length === 1) {
        const chatId = chatIds[0].toString();
        return {success: true, chatId, message: `Auto-detected chat ID: ${chatId}`};
      } else if (chatIds.length > 1) {
        return {success: false, message: `Multiple users detected. Please use manual setup.`};
      } else {
        return {success: false, message: 'No valid chat found. Please send /start to the bot.'};
      }
    } catch (error) {
      console.error('Error detecting chat ID:', error);
      return {success: false, message: 'Failed to detect chat ID. Please use manual setup.'};
    }
  }

  // Setup user-specific Telegram configuration
  async setupUserTelegram(userEmail: string, chatId: string): Promise<{success: boolean, message: string}> {
    try {
      // Validate chat ID format
      if (!/^\d+$/.test(chatId)) {
        return {success: false, message: 'Invalid chat ID format. Must be numbers only.'};
      }

      // Test sending a message to verify the chat ID works
      const testResult = await this.sendMessage(chatId, '🎉 Telegram setup successful! You will now receive job application notifications here.');
      
      if (!testResult.success) {
        return {success: false, message: 'Failed to send test message. Please check your chat ID.'};
      }

      // Save chat ID to user profile
      const user = await UserModel.findByEmail(userEmail);
      if (!user) {
        return {success: false, message: 'User not found'};
      }

      await UserModel.updateAutomationSettings(user.id, {
        telegramChatId: chatId,
        automationEnabled: user.automationEnabled,
        preferredKeywords: user.preferredKeywords,
        preferredLocation: user.preferredLocation,
        experienceLevel: user.experienceLevel
      });

      return {success: true, message: 'Telegram configured successfully! Check your messages.'};
    } catch (error) {
      console.error('Error setting up Telegram:', error);
      return {success: false, message: 'Setup failed. Please try again.'};
    }
  }

  // Test user's Telegram configuration
  async testUserTelegram(userEmail: string): Promise<{success: boolean, message: string}> {
    try {
      const user = await UserModel.findByEmail(userEmail);
      if (!user || !user.telegramChatId) {
        return {success: false, message: 'Telegram not configured for this user'};
      }

      const result = await this.sendMessage(
        user.telegramChatId, 
        `🧪 Test successful! Your Job Agent AI is connected.\n\nTime: ${new Date().toLocaleString('en-IN', {timeZone: 'Asia/Kolkata'})}`
      );

      return result;
    } catch (error) {
      console.error('Error testing Telegram:', error);
      return {success: false, message: 'Test failed'};
    }
  }

  // Send job application notification to user
  async sendJobApplicationNotification(userEmail: string, jobData: any, driveLink?: string | null): Promise<boolean> {
    try {
      const user = await UserModel.findByEmail(userEmail);
      if (!user || !user.telegramChatId) {
        console.log(`No Telegram chat ID for user: ${userEmail}`);
        return false;
      }

      const message = this.formatJobNotification(jobData, driveLink);
      const result = await this.sendMessage(user.telegramChatId, message);
      
      return result.success;
    } catch (error) {
      console.error('Error sending job notification:', error);
      return false;
    }
  }

  // Send daily summary to user
  async sendDailySummary(userEmail: string, summary: {applied: number, found: number, skipped: number, errors: number}): Promise<boolean> {
    try {
      const user = await UserModel.findByEmail(userEmail);
      if (!user || !user.telegramChatId) {
        return false;
      }

      const message = `📊 Daily Job Automation Summary (${new Date().toLocaleDateString('en-IN')})

🎯 Jobs Found: ${summary.found}
✅ Applied: ${summary.applied}
⏭️ Skipped (duplicates): ${summary.skipped}
❌ Errors: ${summary.errors}

${summary.applied > 0 ? '🎉 Great progress today!' : '💡 Check your search criteria if no applications were made.'}

Your resumes are automatically saved to Google Drive!`;

      const result = await this.sendMessage(user.telegramChatId, message);
      return result.success;
    } catch (error) {
      console.error('Error sending daily summary:', error);
      return false;
    }
  }

  // Generic send message method
  private async sendMessage(chatId: string, message: string): Promise<{success: boolean, message: string}> {
    if (!this.botToken) {
      return {success: false, message: 'Bot token not configured'};
    }

    try {
      const response = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: 'HTML'
        })
      });

      const data = await response.json();
      
      if (data.ok) {
        return {success: true, message: 'Message sent successfully'};
      } else {
        console.error('Telegram API error:', data);
        return {success: false, message: data.description || 'Failed to send message'};
      }
    } catch (error) {
      console.error('Network error sending Telegram message:', error);
      return {success: false, message: 'Network error occurred'};
    }
  }

  private formatJobNotification(jobData: any, driveLink?: string | null): string {
    const matchEmoji = jobData.matchScore >= 80 ? '🎯' : jobData.matchScore >= 60 ? '✅' : '📝';
    
    let message = `${matchEmoji} <b>Job Applied Successfully!</b>

🏢 <b>${jobData.company}</b>
💼 ${jobData.title}
📍 ${jobData.location || 'Location not specified'}
📊 Match Score: ${jobData.matchScore || 'N/A'}%

🤖 Resume: ${jobData.resumeCustomized ? 'AI-Customized' : 'Original'}`;

    if (driveLink) {
      message += `\n💾 <a href="${driveLink}">View Resume in Drive</a>`;
    }

    message += `\n\n⏰ Applied: ${new Date().toLocaleString('en-IN', {timeZone: 'Asia/Kolkata'})}`;

    return message;
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
        preferredKeywords: user.preferredKeywords || undefined,
        preferredLocation: user.preferredLocation,
        experienceLevel: user.experienceLevel
      });

      return true;
    } catch (error) {
      console.error('Error setting chat ID:', error);
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