// src/services/GeminiService.ts - ENHANCED with rate limiting and error handling
import { GoogleGenerativeAI } from "@google/generative-ai";

export class GeminiService {
  private genAI: GoogleGenerativeAI;
  private lastRequestTime: number = 0;
  private requestCount: number = 0;
  private dailyRequestLimit: number = 45; // Leave some buffer from 50 limit
  private requestInterval: number = 2000; // 2 seconds between requests

  constructor() {
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  }

  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    
    // Reset daily counter if it's a new day
    const today = new Date().toDateString();
    const lastRequestDate = new Date(this.lastRequestTime).toDateString();
    
    if (today !== lastRequestDate) {
      this.requestCount = 0;
    }

    // Check daily limit
    if (this.requestCount >= this.dailyRequestLimit) {
      const resetTime = new Date();
      resetTime.setHours(24, 0, 0, 0); // Reset at midnight
      const hoursUntilReset = Math.ceil((resetTime.getTime() - now) / (1000 * 60 * 60));
      
      throw new Error(`Daily API limit reached (${this.dailyRequestLimit} requests). Reset in ${hoursUntilReset} hours.`);
    }

    // Enforce time interval between requests
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < this.requestInterval) {
      const waitTime = this.requestInterval - timeSinceLastRequest;
      console.log(`Rate limiting: waiting ${waitTime}ms before next request`);
      await this.sleep(waitTime);
    }

    this.lastRequestTime = Date.now();
    this.requestCount++;
    
    console.log(`Gemini API request ${this.requestCount}/${this.dailyRequestLimit} today`);
  }

  async customizeResume(
    originalResume: string,
    jobDescription: string,
    jobTitle: string,
    company: string
  ): Promise<string> {
    try {
      console.log("DEBUG: Starting resume customization for:", jobTitle, "at", company);

      // Check rate limits before making request
      await this.enforceRateLimit();

      const model = this.genAI.getGenerativeModel({
        model: "gemini-1.5-flash",
      });

      const prompt = `You are a professional resume writer. Customize this resume for a specific job application.

ORIGINAL RESUME:
${originalResume}

JOB TITLE: ${jobTitle}
COMPANY: ${company}
JOB DESCRIPTION:
${jobDescription}

CUSTOMIZATION INSTRUCTIONS:
1. Highlight the most relevant skills, experience, and achievements for this specific role
2. Reorder bullet points to prioritize job-relevant experience
3. Add keywords from the job description naturally throughout the resume
4. Adjust the professional summary/objective to align with this role
5. Emphasize technologies, frameworks, and methodologies mentioned in the job posting
6. Keep the same overall format and structure
7. Maintain truthfulness - do not add fake experience or skills
8. Keep the resume length similar to the original

IMPORTANT: Return ONLY the customized resume content. Do not include any explanations, comments, or additional text.

CUSTOMIZED RESUME:`;

      const result = await model.generateContent(prompt);
      const response = await result.response;
      const customizedResume = response.text().trim();

      console.log("DEBUG: Resume customization completed successfully");
      return customizedResume;
      
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("Error customizing resume with Gemini:", errorMessage);

      // Handle specific error types
      if (errorMessage.includes("quota") || errorMessage.includes("429")) {
        console.log("DEBUG: Quota exceeded, returning original resume");
        return originalResume; // Fallback to original resume when quota exceeded
      } else if (errorMessage.includes("Daily API limit reached")) {
        console.log("DEBUG: Daily limit reached, returning original resume");
        return originalResume;
      }

      throw new Error("Failed to customize resume");
    }
  }

  async analyzeJobMatch(
    resume: string,
    jobDescription: string
  ): Promise<{
    matchScore: number;
    missingSkills: string[];
    recommendations: string[];
  }> {
    try {
      // Check rate limits before making request
      await this.enforceRateLimit();

      const model = this.genAI.getGenerativeModel({
        model: "gemini-1.5-flash",
      });

      const prompt = `Analyze how well this resume matches the job description and provide actionable insights.

RESUME:
${resume}

JOB DESCRIPTION:
${jobDescription}

Please analyze and respond with a JSON object containing:
- matchScore: A percentage (0-100) of how well the resume matches
- missingSkills: Array of key skills mentioned in job but missing from resume
- recommendations: Array of specific suggestions to improve the application

Return only valid JSON, no other text or markdown formatting.`;

      const result = await model.generateContent(prompt);
      const response = await result.response;
      let responseText = response.text();

      // Remove markdown code blocks if present
      responseText = responseText
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim();

      console.log("DEBUG: Raw Gemini response:", responseText);

      const parsed = JSON.parse(responseText);
      console.log("DEBUG: Parsed analysis result:", parsed);

      return parsed;
      
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("Error analyzing job match:", errorMessage);
      
      // Return default values for various error types
      if (errorMessage.includes("quota") || errorMessage.includes("429")) {
        console.log("DEBUG: Quota exceeded for job analysis, using fallback score");
        return {
          matchScore: 60, // Conservative fallback score
          missingSkills: ["Unable to analyze due to API limits"],
          recommendations: ["Resume analysis temporarily unavailable - manual review recommended"],
        };
      } else if (errorMessage.includes("Daily API limit reached")) {
        console.log("DEBUG: Daily limit reached for job analysis");
        return {
          matchScore: 65,
          missingSkills: ["Daily API limit reached"],
          recommendations: ["Job analysis unavailable today - check back tomorrow"],
        };
      }
      
      return {
        matchScore: 50,
        missingSkills: [],
        recommendations: ["Unable to analyze - please review manually"],
      };
    }
  }

  async generateFollowUpEmail(
    jobTitle: string,
    company: string,
    applicantName: string,
    hrContacts: any[]
  ): Promise<{
    subject: string;
    body: string;
  }> {
    try {
      // Check rate limits before making request
      await this.enforceRateLimit();

      const model = this.genAI.getGenerativeModel({
        model: "gemini-1.5-flash",
      });

      const prompt = `Generate a professional follow-up email for a job application.

JOB TITLE: ${jobTitle}
COMPANY: ${company}
APPLICANT NAME: ${applicantName}
HR CONTACTS: ${hrContacts
        .map((contact) => `${contact.name} (${contact.title})`)
        .join(", ")}

Create a professional, concise follow-up email that:
1. Expresses continued interest in the position
2. Briefly reiterates key qualifications
3. Is polite and professional
4. Includes a clear call to action

Return a JSON object with:
- subject: Email subject line
- body: Email body content

Return only valid JSON, no other text or markdown formatting.`;

      const result = await model.generateContent(prompt);
      const response = await result.response;
      let responseText = response.text();

      // Remove markdown code blocks if present
      responseText = responseText
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim();

      return JSON.parse(responseText);
      
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("Error generating follow-up email:", errorMessage);
      
      // Fallback email template
      return {
        subject: `Follow-up on ${jobTitle} Application`,
        body: `Dear Hiring Manager,\n\nI hope this email finds you well. I recently applied for the ${jobTitle} position at ${company} and wanted to follow up on my application.\n\nI am very excited about the opportunity to contribute to your team and believe my skills align well with the role requirements.\n\nThank you for your time and consideration. I look forward to hearing from you.\n\nBest regards,\n${applicantName}`,
      };
    }
  }

  // Helper method for delays
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Get current usage stats
  getCurrentUsage(): {
    requestCount: number;
    dailyLimit: number;
    remainingRequests: number;
    resetTime: string;
  } {
    const resetTime = new Date();
    resetTime.setHours(24, 0, 0, 0);
    
    return {
      requestCount: this.requestCount,
      dailyLimit: this.dailyRequestLimit,
      remainingRequests: Math.max(0, this.dailyRequestLimit - this.requestCount),
      resetTime: resetTime.toISOString()
    };
  }
}