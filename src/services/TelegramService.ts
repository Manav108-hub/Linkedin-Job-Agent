// src/services/TelegramService.ts - Telegram notifications
import { UserModel } from '../database/db';

export class TelegramService {
  private botToken: string;
  
  constructor() {
    this.botToken = process.env.TELEGRAM_BOT_TOKEN!;
    
    if (!this.botToken) {
      console.warn('⚠️ TELEGRAM_BOT_TOKEN not configured - notifications will be disabled');
    }
  }

  async sendMessage(chatId: string, message: string): Promise<boolean> {
    if (!this.botToken) {
      console.log('📱 Telegram not configured, skipping notification');
      return false;
    }

    if (!chatId) {
      console.log('📱 No chat ID provided, skipping notification');
      return false;
    }

    try {
      const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: 'HTML',
          disable_web_page_preview: true
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Telegram API error: ${response.status} - ${errorText}`);
      }
      
      console.log('📱 Telegram message sent successfully');
      return true;
      
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('❌ Failed to send Telegram message:', errorMessage);
      return false;
    }
  }

  async sendJobApplicationNotification(userEmail: string, job: any, driveLink?: string): Promise<void> {
    const chatId = await this.getChatIdForUser(userEmail);
    if (!chatId) {
      console.log(`📱 No Telegram chat ID found for user: ${userEmail}`);
      return;
    }

    const message = `
🎯 <b>New Job Application!</b>

<b>📋 Position:</b> ${job.title}
<b>🏢 Company:</b> ${job.company}
<b>📍 Location:</b> ${job.location || 'Not specified'}
<b>🎯 Match Score:</b> ${job.matchScore || 'N/A'}%
<b>🕒 Applied:</b> ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
<b>🤖 AI Resume:</b> ${job.resumeCustomized ? 'Yes ✅' : 'Original used'}
${driveLink ? `<b>📄 Resume:</b> <a href="${driveLink}">View in Drive</a>` : ''}

✅ Application submitted successfully!

<i>Good luck! 🍀</i>
    `;

    await this.sendMessage(chatId, message);
  }

  async sendDailySummary(userEmail: string, results: any): Promise<void> {
    const chatId = await this.getChatIdForUser(userEmail);
    if (!chatId) return;

    const istTime = new Date().toLocaleDateString('en-IN', { 
      timeZone: 'Asia/Kolkata',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    const successEmoji = results.applied > 0 ? '🎉' : '😴';
    const message = `
📊 <b>Daily Job Search Summary</b>

<b>📅 Date:</b> ${istTime}
<b>🔍 Jobs Found:</b> ${results.found}
<b>✅ New Applications:</b> ${results.applied}
<b>⏭️ Duplicates Skipped:</b> ${results.skipped}
<b>❌ Errors:</b> ${results.errors}

${results.applied > 0 
  ? `${successEmoji} Awesome! Applied to ${results.applied} new opportunities today!` 
  : `${successEmoji} No new unique jobs found today. Will search again tomorrow!`}

${results.errors > 0 ? '⚠️ Some errors occurred - check logs for details.' : ''}

<i>Keep grinding! 💪</i>
    `;

    await this.sendMessage(chatId, message);
  }

  async sendErrorNotification(userEmail: string, error: string): Promise<void> {
    const chatId = await this.getChatIdForUser(userEmail);
    if (!chatId) return;

    const message = `
⚠️ <b>Job Automation Error</b>

<b>👤 User:</b> ${userEmail}
<b>🕒 Time:</b> ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
<b>❌ Error:</b> ${error.substring(0, 200)}${error.length > 200 ? '...' : ''}

🔄 The system will retry tomorrow. Please check your account if this persists.

<i>Contact support if needed 📧</i>
    `;

    await this.sendMessage(chatId, message);
  }

  async sendTestNotification(userEmail: string): Promise<boolean> {
    const chatId = await this.getChatIdForUser(userEmail);
    if (!chatId) {
      console.log(`No Telegram chat ID configured for ${userEmail}`);
      return false;
    }

    const message = `
🧪 <b>Test Notification</b>

Hello ${userEmail}! 👋

Your Telegram notifications are working correctly! ✅

<b>🕒 Time:</b> ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}

<i>You're all set for job automation! 🚀</i>
    `;

    return await this.sendMessage(chatId, message);
  }

 async getChatIdForUser(userEmail: string): Promise<string | null> {
    try {
      // First try to get from user's profile in database
      const user = await UserModel.findByEmail(userEmail);
      if (user && user.telegramChatId) {
        return user.telegramChatId;
      }

      // Fallback to environment variables for main user
      const envChatMappings: { [key: string]: string } = {
        'manavadwani86@gmail.com': process.env.TELEGRAM_CHAT_ID || '',
        // Add more users as needed
      };
      
      return envChatMappings[userEmail] || process.env.TELEGRAM_CHAT_ID || null;
      
    } catch (error) {
      console.error('Error getting chat ID for user:', error);
      return process.env.TELEGRAM_CHAT_ID || null;
    }
  }

  // Method to set user's Telegram chat ID
  async setUserChatId(userEmail: string, chatId: string): Promise<boolean> {
    try {
      await UserModel.updateTelegramChatId(userEmail, chatId);
      console.log(`✅ Telegram chat ID set for user: ${userEmail}`);
      return true;
    } catch (error) {
      console.error('Error setting user chat ID:', error);
      return false;
    }
  }

  // Get bot info for verification
  async getBotInfo(): Promise<any> {
    if (!this.botToken) {
      throw new Error('Telegram bot token not configured');
    }

    try {
      const url = `https://api.telegram.org/bot${this.botToken}/getMe`;
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Failed to get bot info: ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error('Error getting bot info:', error);
      throw error;
    }
  }
}