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

  // ADD these methods to your GeminiService.ts class:

async generateJobSuggestions(
  resume: string,
  jobDescription: string,
  jobTitle: string,
  company: string
): Promise<string[]> {
  try {
    await this.enforceRateLimit();

    const model = this.genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
    });

    const prompt = `As a career coach, analyze this resume against the job posting and provide specific improvement suggestions.

RESUME:
${resume}

JOB TITLE: ${jobTitle}
COMPANY: ${company}
JOB DESCRIPTION:
${jobDescription}

Provide 5-10 specific, actionable suggestions to improve this candidate's chances of getting this job. Focus on:
1. Skills to highlight or learn
2. Resume wording improvements
3. Experience to emphasize
4. Technologies to mention
5. Certifications or training to consider

Return only a JSON array of suggestion strings. Each suggestion should be specific and actionable.
Example: ["Add React hooks experience to your projects section", "Mention experience with TypeScript interfaces"]

Return only valid JSON array, no other text.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    let responseText = response.text();

    // Clean response
    responseText = responseText
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();

    const suggestions = JSON.parse(responseText);
    console.log(`Generated ${suggestions.length} suggestions for ${jobTitle}`);
    
    return Array.isArray(suggestions) ? suggestions : [];

  } catch (error) {
    console.error("Error generating job suggestions:", error);
    return [
      "Review the job description carefully and tailor your resume",
      "Highlight relevant technical skills mentioned in the posting", 
      "Quantify your achievements with specific metrics",
      "Research the company and industry trends"
    ];
  }
}

async generateSuggestionsDocument(
  userInfo: { name: string; email: string },
  jobSuggestions: any[]
): Promise<string> {
  try {
    await this.enforceRateLimit();

    const model = this.genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
    });

    const prompt = `Create a beautiful, professional job suggestions document in HTML format.

USER: ${userInfo.name} (${userInfo.email})
DATE: ${new Date().toLocaleDateString()}

JOB SUGGESTIONS DATA:
${JSON.stringify(jobSuggestions.slice(0, 5), null, 2)}

Create an HTML document with:
1. Professional styling with CSS
2. Company logos placeholders
3. Match scores with color coding (green >80%, yellow >60%, red <60%)
4. Organized suggestions list for each job
5. Action items and next steps
6. Professional formatting with headers, cards, and good typography

Make it look like a premium career consulting report. Use modern CSS with:
- Cards for each job
- Progress bars for match scores
- Icons for different suggestion types
- Clean, professional layout
- Print-friendly styling

Return only the complete HTML document with embedded CSS.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const htmlDocument = response.text().trim();

    console.log("Generated professional suggestions document");
    return htmlDocument;

  } catch (error) {
    console.error("Error generating suggestions document:", error);
    
    // Fallback HTML template
    return this.createFallbackSuggestionsDocument(userInfo, jobSuggestions);
  }
}

private createFallbackSuggestionsDocument(userInfo: any, jobSuggestions: any[]): string {
  const date = new Date().toLocaleDateString();
  
  const jobsHtml = jobSuggestions.slice(0, 5).map(suggestion => {
    const matchColor = suggestion.analysis.matchScore >= 80 ? '#4CAF50' : 
                      suggestion.analysis.matchScore >= 60 ? '#FF9800' : '#F44336';
    
    return `
      <div class="job-card">
        <h3>${suggestion.job.title} - ${suggestion.job.company}</h3>
        <div class="match-score" style="background-color: ${matchColor}">
          ${suggestion.analysis.matchScore}% Match
        </div>
        <div class="suggestions">
          <h4>Recommendations:</h4>
          <ul>
            ${suggestion.suggestions.map(s => `<li>${s}</li>`).join('')}
          </ul>
        </div>
      </div>
    `;
  }).join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Job Suggestions Report - ${userInfo.name}</title>
      <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 20px; margin-bottom: 30px; }
        .job-card { border: 1px solid #ddd; padding: 20px; margin-bottom: 20px; border-radius: 8px; }
        .match-score { display: inline-block; color: white; padding: 5px 10px; border-radius: 15px; font-weight: bold; }
        .suggestions ul { padding-left: 20px; }
        .suggestions li { margin-bottom: 8px; }
        h3 { color: #333; margin-bottom: 10px; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>Daily Job Suggestions Report</h1>
        <p><strong>${userInfo.name}</strong> | ${userInfo.email}</p>
        <p>Generated on: ${date}</p>
      </div>
      ${jobsHtml}
    </body>
    </html>
  `;
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