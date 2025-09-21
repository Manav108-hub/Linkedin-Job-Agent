import { GoogleGenerativeAI } from "@google/generative-ai";

export class GeminiService {
  private genAI: GoogleGenerativeAI;

  constructor() {
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  }

  async customizeResume(
    originalResume: string,
    jobDescription: string,
    jobTitle: string,
    company: string
  ): Promise<string> {
    try {
      console.log(
        "DEBUG: Starting resume customization for:",
        jobTitle,
        "at",
        company
      );

      const model = this.genAI.getGenerativeModel({
        model: "gemini-1.5-flash",
      });

      const prompt = `
You are a professional resume writer. Customize this resume for a specific job application.

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

CUSTOMIZED RESUME:
`;

      const result = await model.generateContent(prompt);
      const response = await result.response;
      const customizedResume = response.text().trim();

      console.log("DEBUG: Resume customization completed successfully");
      return customizedResume;
    } catch (error: unknown) {
      console.error("Error customizing resume with Gemini:", error);

      // Check if it's a quota error
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (errorMessage.includes("quota") || errorMessage.includes("429")) {
        console.log("DEBUG: Quota exceeded, returning original resume");
        return originalResume; // Fallback to original resume when quota exceeded
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
      const model = this.genAI.getGenerativeModel({
        model: "gemini-1.5-flash",
      });

      const prompt = `
Analyze how well this resume matches the job description and provide actionable insights.

RESUME:
${resume}

JOB DESCRIPTION:
${jobDescription}

Please analyze and respond with a JSON object containing:
- matchScore: A percentage (0-100) of how well the resume matches
- missingSkills: Array of key skills mentioned in job but missing from resume
- recommendations: Array of specific suggestions to improve the application

Return only valid JSON, no other text or markdown formatting.
`;

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
      console.error("Error analyzing job match:", error);
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
      const model = this.genAI.getGenerativeModel({
        model: "gemini-1.5-flash",
      });

      const prompt = `
Generate a professional follow-up email for a job application.

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

Return only valid JSON, no other text or markdown formatting.
`;

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
      console.error("Error generating follow-up email:", error);
      return {
        subject: `Follow-up on ${jobTitle} Application`,
        body: `Dear Hiring Manager,\n\nI hope this email finds you well. I recently applied for the ${jobTitle} position at ${company} and wanted to follow up on my application.\n\nI am very excited about the opportunity to contribute to your team and believe my skills align well with the role requirements.\n\nThank you for your time and consideration. I look forward to hearing from you.\n\nBest regards,\n${applicantName}`,
      };
    }
  }
}
