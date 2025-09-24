// src/services/JobService.ts - UPDATED with actual LinkedIn application and Telegram integration
import { Socket } from "socket.io";
import {
  UserSession,
  JobListing,
  CustomizedApplication,
  JobSearchCriteria,
} from "../types";
import { LinkedInService } from "./LinkedInService";
import { GeminiService } from "./GeminiService";
import { HRExtractorService } from "./HrExtractorService";
import { ResumeService } from "./ResumeService";
import { TelegramService } from "./TelegramService";
import { GoogleDriveService } from "./GoogleDriveService";
import {
  UserModel,
  JobListingModel,
  JobApplicationModel,
  ResumeModel,
  HRContactModel,
} from "../database/db";

export class JobService {
  private linkedinService: LinkedInService;
  private geminiService: GeminiService;
  private hrExtractor: HRExtractorService;
  private resumeService: ResumeService;
  private telegramService: TelegramService;

  constructor() {
    this.linkedinService = new LinkedInService();
    this.geminiService = new GeminiService();
    this.hrExtractor = new HRExtractorService();
    this.resumeService = new ResumeService();
    this.telegramService = new TelegramService();
  }

  // Interactive job processing with ACTUAL LinkedIn application
  // REPLACE your processJobsForUser method in JobService.ts with this FIXED version:

async processJobsForUser(
  user: UserSession,
  io: Socket,
  criteria: JobSearchCriteria
): Promise<void> {
  try {
    await this.linkedinService.initialize();
    io.emit("job_search_started", { message: "Searching for jobs..." });

    // 1. Search for jobs (NO APPLICATION ATTEMPTS)
    const jobs = await this.linkedinService.searchJobs(
      criteria.keywords,
      criteria.location,
      20
    );

    io.emit("jobs_found", { count: jobs.length, jobs: jobs.slice(0, 5) });

    if (jobs.length === 0) {
      io.emit("job_search_completed", { message: "No matching jobs found." });
      return;
    }

    // 2. Get actual database user
    const dbUser = await this.getActualDatabaseUser(user);
    if (!dbUser) {
      throw new Error(`User not found in database: ${user.email}`);
    }

    // 3. Get user's resume text
    const originalResume = await this.resumeService.getUserResumeText(dbUser.id);
    console.log("Using resume text of length:", originalResume.length);

    // 4. Analyze jobs and create suggestions (NO APPLICATIONS)
    const jobSuggestions: any[] = [];

    for (let i = 0; i < Math.min(jobs.length, 10); i++) {
      const job = jobs[i];

      try {
        io.emit("processing_job", {
          company: job.company,
          title: job.title,
          progress: Math.round(((i + 1) / Math.min(jobs.length, 10)) * 100),
        });

        // FIX: Get job description (assuming it returns string directly)
        let jobDescription = "";
        try {
          // Try to get description from LinkedIn service
          if (this.linkedinService.getJobDescription) {
            const descriptionResult = await this.linkedinService.getJobDescription(job.url);
            // Handle both string and object returns
            jobDescription = typeof descriptionResult === 'string' ? 
              descriptionResult : (descriptionResult.description || job.description || "");
          } else {
            // Fallback to job.description if method doesn't exist
            jobDescription = job.description || "Job description not available";
          }
        } catch (descError) {
          console.log("Failed to get detailed job description, using basic info");
          jobDescription = job.description || `Job: ${job.title} at ${job.company}. Location: ${job.location}`;
        }

        // Analyze match with Gemini
        let analysis = {
          matchScore: 70,
          missingSkills: [],
          recommendations: []
        };
        
        try {
          analysis = await this.geminiService.analyzeJobMatch(
            originalResume,
            jobDescription
          );
        } catch (geminiError) {
          console.log("Gemini analysis failed, using defaults");
        }

        // Generate improvement suggestions
        let suggestions: string[] = [];
        try {
          // Check if the method exists (we'll add it to GeminiService)
          if (typeof this.geminiService.generateJobSuggestions === 'function') {
            suggestions = await this.geminiService.generateJobSuggestions(
              originalResume,
              jobDescription,
              job.title,
              job.company
            );
          } else {
            // Fallback suggestions
            suggestions = [
              `Tailor your resume for ${job.title} position`,
              `Research ${job.company} company culture and values`,
              `Highlight relevant experience for this role`,
              `Prepare specific examples for this job interview`
            ];
          }
        } catch (suggestionError) {
          console.log("Failed to generate suggestions, using fallback");
          suggestions = [
            `Review requirements for ${job.title}`,
            `Customize resume for ${job.company}`,
            `Prepare for technical interview`
          ];
        }

        // FIX: Use existing JobListingModel.create method from your database
        let savedJob;
        try {
          savedJob = await JobListingModel.create({
            id: job.id,
            title: job.title,
            company: job.company,
            location: job.location,
            description: jobDescription,
            url: job.url ?? undefined,
            postedDate: this.safeParseDate(job.postedDate),
          });
        } catch (dbError) {
          console.log("Failed to save job to database:", dbError);
          // Continue without saving to database
        }

        const jobSuggestion = {
          job: {
            id: job.id,
            title: job.title,
            company: job.company,
            location: job.location,
            url: job.url,
            postedDate: job.postedDate
          },
          analysis: {
            matchScore: analysis.matchScore,
            missingSkills: analysis.missingSkills,
            recommendations: analysis.recommendations
          },
          suggestions: suggestions,
          status: 'suggestion_ready'
        };

        jobSuggestions.push(jobSuggestion);

        io.emit("job_processed", {
          company: job.company,
          title: job.title,
          matchScore: analysis.matchScore,
          status: `📋 Suggestions Ready (${analysis.matchScore}% match)`,
          timestamp: new Date().toISOString(),
          suggestionsCount: suggestions.length
        });

        await this.sleep(3000); // Delay between jobs

      } catch (error) {
        console.error(`Error processing job ${job.title}:`, error);
        io.emit("job_error", {
          company: job.company,
          title: job.title,
          error: "Failed to analyze job"
        });
      }
    }

    // Send Telegram notification with daily suggestions
    if (jobSuggestions.length > 0) {
      try {
        await this.telegramService.sendDailyJobSuggestions(
          user.email,
          jobSuggestions
        );
      } catch (telegramError) {
        console.log("Failed to send Telegram notification:", telegramError);
      }
    }

    await this.linkedinService.cleanup();

    io.emit("job_search_completed", {
      message: `Found ${jobSuggestions.length} job suggestions! Check your Telegram for details.`,
      suggestions: jobSuggestions.length,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Job processing error:", errorMessage);
    io.emit("job_search_error", {
      error: "Job search failed. Please try again."
    });
  }
}

  // Automated job processing for scheduled runs (UPDATED)
  async processJobsAutomated(
    user: UserSession,
    criteria: JobSearchCriteria,
    excludeUrls: Set<string>
  ): Promise<{
    found: number;
    applied: number;
    skipped: number;
    errors: number;
  }> {
    const results = { found: 0, applied: 0, skipped: 0, errors: 0 };

    try {
      await this.linkedinService.initialize();

      // Login to LinkedIn
      const loginSuccess = await this.linkedinService.loginWithToken(
        user.linkedinToken!
      );
      if (!loginSuccess) {
        console.log("⚠️ LinkedIn login failed for automation");
        results.errors++;
        return results;
      }

      // Get the actual database user
      const dbUser = await this.getActualDatabaseUser(user);
      if (!dbUser) {
        throw new Error(`User not found in database: ${user.email}`);
      }

      // Send automation start notification
      await this.telegramService.sendAutomationStartNotification(user.email);

      // Search for jobs
      const jobs = await this.linkedinService.searchJobs(
        criteria.keywords,
        criteria.location,
        20 // Get more jobs to account for duplicates
      );

      results.found = jobs.length;
      console.log(`Found ${jobs.length} jobs for automation`);

      if (jobs.length === 0) {
        return results;
      }

      // Get user's resume using database user ID
      const originalResume = await this.resumeService.getUserResumeText(
        dbUser.id
      );

      // Initialize Google Drive service
      let driveService: GoogleDriveService | null = null;
      if (user.googleToken) {
        try {
          driveService = new GoogleDriveService(
            user.googleToken,
            user.googleRefreshToken
          );
          console.log("Google Drive service initialized for automation");
        } catch (error) {
          console.log(
            "Google Drive initialization failed, continuing without Drive"
          );
        }
      }

      // Filter out duplicate jobs
      const newJobs = jobs.filter((job) => !excludeUrls.has(job.url));
      results.skipped = jobs.length - newJobs.length;

      console.log(
        `Processing ${newJobs.length} new jobs (${results.skipped} duplicates skipped)`
      );

      // Process only new jobs (limit to 3 per day for automation safety)
      const jobsToProcess = newJobs.slice(0, 3);

      for (const job of jobsToProcess) {
        try {
          const result = await this.processIndividualJobWithApplication(
            dbUser,
            job,
            originalResume,
            driveService,
            user.linkedinToken!
          );

          // Count as applied only if actually applied
          if (result.actuallyApplied) {
            results.applied++;

            // Send individual Telegram notification
            await this.telegramService.sendJobApplicationNotification(
              user.email,
              {
                ...job,
                matchScore: result.matchScore,
                resumeCustomized: result.resumeCustomized,
              },
              result.driveLink
            );
          }

          console.log(
            `Processed ${job.title} at ${job.company} - Applied: ${result.actuallyApplied} (${result.applicationMethod})`
          );

          // Add delay between applications to be respectful
          await this.sleep(8000); // 8 second delay for automation
        } catch (error: unknown) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          console.error(
            `Failed to process job ${job.title} at ${job.company}:`,
            errorMessage
          );
          results.errors++;
        }
      }

      await this.linkedinService.cleanup();
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error("Automated job processing failed:", errorMessage);
      results.errors++;

      // Send error notification
      await this.telegramService.sendErrorNotification(
        user.email,
        errorMessage
      );
    }

    return results;
  }

  // UPDATED: Core job processing logic with ACTUAL LinkedIn application
  private async processIndividualJobWithApplication(
    dbUser: any,
    job: any,
    originalResume: string,
    driveService: GoogleDriveService | null,
    linkedinToken: string
  ): Promise<{
    application: CustomizedApplication;
    matchScore: number;
    resumeCustomized: boolean;
    hrContactsCount: number;
    driveLink: string | null;
    actuallyApplied: boolean;
    applicationMethod: string;
    applicationDetails: string;
  }> {
    // Save job to database
    const savedJob = await JobListingModel.create({
      id: job.id,
      title: job.title,
      company: job.company,
      location: job.location,
      description: job.description,
      url: job.url ?? undefined,
      postedDate: this.safeParseDate(job.postedDate),
    });

    // Get detailed job description AND apply to the job
    console.log(
      `🎯 Processing job with ACTUAL APPLICATION: ${job.title} at ${job.company}`
    );

    const jobResult = await this.linkedinService.getJobDescriptionAndApply(
      job.url,
      originalResume
    );

    const jobDescription = jobResult.description;
    const actuallyApplied = jobResult.applied;
    const applicationMethod = jobResult.applicationMethod;

    // Extract HR contacts
    let hrContacts: any[] = [];
    try {
      const currentPage = this.linkedinService.getCurrentPage();
      if (currentPage) {
        hrContacts = await this.hrExtractor.extractHRContactsFromJobPage(
          currentPage,
          job.url,
          job.company
        );
      }
    } catch (error) {
      console.log(
        "DEBUG: Failed to extract HR contacts, continuing without them"
      );
    }

    // Save HR contacts to database
    for (const contact of hrContacts) {
      try {
        await HRContactModel.create({
          jobId: savedJob.id,
          name: contact.name,
          email: contact.email,
          linkedinProfile: contact.linkedin_profile,
          title: contact.title,
          company: contact.company,
          phone: contact.phone,
        });
      } catch (error) {
        console.log("DEBUG: Failed to save HR contact, skipping");
      }
    }

    // Customize resume with AI (with fallback)
    let customizedResume = originalResume;
    let matchScore = 75; // Default match score
    let resumeCustomized = false;
    let analysisResult: {
      matchScore: number;
      missingSkills: string[];
      recommendations: string[];
    } = {
      matchScore: 75,
      missingSkills: [],
      recommendations: [],
    };

    try {
      console.log("DEBUG: Attempting AI resume customization...");
      customizedResume = await this.geminiService.customizeResume(
        originalResume,
        jobDescription,
        job.title,
        job.company
      );
      resumeCustomized = true;
      console.log("DEBUG: AI resume customization successful");

      // Try to analyze job match
      try {
        analysisResult = await this.geminiService.analyzeJobMatch(
          originalResume,
          jobDescription
        );
        matchScore = analysisResult.matchScore;
        console.log("DEBUG: Job match analysis successful, score:", matchScore);
      } catch (analysisError) {
        console.log("DEBUG: Job match analysis failed, using default score");
      }
    } catch (customizationError: unknown) {
      const errorMessage =
        customizationError instanceof Error
          ? customizationError.message
          : String(customizationError);
      console.log("DEBUG: AI resume customization failed:", errorMessage);

      if (errorMessage.includes("quota") || errorMessage.includes("429")) {
        console.log("DEBUG: Quota exceeded, using original resume");
      } else {
        console.log("DEBUG: Other AI error, using original resume");
      }
      // Continue with original resume
    }

    // Save customized resume to database with correct user ID
    const savedResume = await ResumeModel.create({
      userId: dbUser.id,
      jobId: savedJob.id!,
      originalContent: originalResume,
      customizedContent: customizedResume,
      formatType: "professional",
      customizationSuccessful: resumeCustomized,
    });

    // Save to Google Drive with TEXT format
    let driveLink: string | null = null;
    if (driveService) {
      try {
        const fileName = GoogleDriveService.generateResumeFileName(
          job.title,
          job.company,
          resumeCustomized
        );

        driveLink = await driveService.saveResume(
          customizedResume,
          fileName,
          job.title,
          job.company
        );

        if (driveLink) {
          console.log(`Resume saved to Google Drive: ${fileName}`);
        }
      } catch (driveError) {
        console.log("Failed to save to Google Drive:", driveError.message);
      }
    }

    // Save job application to database with APPLICATION STATUS
    const applicationStatus = actuallyApplied ? "applied" : "attempted";
    const applicationNotes = `Application ${applicationStatus} via ${applicationMethod}. HR contacts found: ${
      hrContacts.length
    }. Resume ${
      resumeCustomized ? "customized with AI" : "used as original"
    }. ${driveLink ? "Saved to Drive." : ""}`;

    const savedApplication = await JobApplicationModel.create({
      userId: dbUser.id,
      jobId: savedJob.id!,
      jobUrl: job.url ?? undefined,
      status: applicationStatus,
      matchScore: matchScore,
      notes: applicationNotes,
      resumeCustomized: resumeCustomized,
      driveLink: driveLink ?? undefined,
    });

    const application: CustomizedApplication = {
      id: savedApplication.id,
      jobId: job.id,
      originalResume,
      customizedResume,
      company: job.company,
      title: job.title,
      status: applicationStatus as any,
      match_score: matchScore,
      hr_contacts_found: hrContacts.length,
      email_drafted: hrContacts.length > 0,
    };

    return {
      application,
      matchScore,
      resumeCustomized,
      hrContactsCount: hrContacts.length,
      driveLink,
      actuallyApplied,
      applicationMethod,
      applicationDetails: applicationNotes,
    };
  }

  // Helper method to get actual database user (FIXES ID MISMATCH)
  private async getActualDatabaseUser(user: UserSession): Promise<any> {
    // First try to find by session ID
    let dbUser = await UserModel.findById(user.id);

    if (!dbUser) {
      console.log("User not found by session ID, trying email...");
      // Fallback to email lookup
      dbUser = await UserModel.findByEmail(user.email);

      if (dbUser) {
        console.log("Found user by email - ID mismatch detected!");
        console.log("Session ID:", user.id);
        console.log("Database ID:", dbUser.id);
      }
    }

    return dbUser;
  }

  // Verification methods
  async verifyJobApplication(
    jobUrl: string
  ): Promise<{ applied: boolean; method: string }> {
    try {
      // Method 1: Check if job URL is in our database
      const existingApplication = await JobApplicationModel.findByJobUrl(
        jobUrl
      );
      if (existingApplication) {
        return { applied: true, method: "database_record" };
      }

      // Method 2: Check LinkedIn page for application status
      if (this.linkedinService) {
        try {
          const appliedStatus =
            await this.linkedinService.checkApplicationStatus(jobUrl);
          if (appliedStatus) {
            return { applied: true, method: "linkedin_verification" };
          }
        } catch (error) {
          console.log(
            "LinkedIn verification failed, using database check only"
          );
        }
      }

      return { applied: false, method: "not_found" };
    } catch (error) {
      console.error("Error verifying job application:", error);
      return { applied: false, method: "verification_failed" };
    }
  }

  // Get user's application statistics
  async getUserApplicationStats(userId: string): Promise<any> {
    try {
      const applications = await JobApplicationModel.findByUserId(userId);

      const stats = {
        total: applications.length,
        thisWeek: 0,
        thisMonth: 0,
        customizedResumes: 0,
        averageMatchScore: 0,
        topCompanies: new Map(),
        recentApplications: applications.slice(0, 10),
      };

      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      let totalScore = 0;
      let scoreCount = 0;

      for (const app of applications) {
        const appDate = new Date(app.appliedAt);

        if (appDate > weekAgo) stats.thisWeek++;
        if (appDate > monthAgo) stats.thisMonth++;

        if (app.resumeCustomized) stats.customizedResumes++;

        if (app.matchScore) {
          totalScore += app.matchScore;
          scoreCount++;
        }

        // Count company applications - need to get from jobListing relation
        const company = app.jobListing?.company || "Unknown";
        stats.topCompanies.set(
          company,
          (stats.topCompanies.get(company) || 0) + 1
        );
      }

      stats.averageMatchScore =
        scoreCount > 0 ? Math.round(totalScore / scoreCount) : 0;

      return stats;
    } catch (error) {
      console.error("Error getting user application stats:", error);
      return null;
    }
  }

  // Add this to your JobService.ts to enhance application tracking

async processJobApplication(job: any, user: any): Promise<{
  applied: boolean;
  applicationMethod: string;
  status: string;
  actionRequired?: string;
}> {
  try {
    console.log(`🎯 Processing job: ${job.title} at ${job.company}`);
    
    // Determine application method based on job source
    let applicationResult;
    
    if (job.source === 'JSearch' || job.source === 'Reed' || job.source === 'Remotive') {
      // These are external job board jobs - require manual application
      applicationResult = {
        applied: false,
        applicationMethod: 'external_application_required',
        status: 'pending_manual_application',
        actionRequired: `Visit ${job.url} to apply manually`,
        requiresAction: true
      };
      
      console.log(`📋 External job detected: ${job.source} - Manual application required`);
      
    } else if (job.url.includes('linkedin.com')) {
      // Try LinkedIn automation
      const linkedinResult = await this.linkedinService.getJobDescriptionAndApply(
        job.url, 
        user.resumeText || '', 
        {
          name: user.name,
          email: user.email,
          phone: user.phone || '',
          coverLetter: this.generateCoverLetter(job, user)
        }
      );
      
      applicationResult = {
        applied: linkedinResult.applied,
        applicationMethod: linkedinResult.applicationMethod,
        status: linkedinResult.applied ? 'applied' : 'application_attempted',
        formFilled: linkedinResult.formFilled,
        readyForSubmission: linkedinResult.readyForSubmission
      };
      
      if (linkedinResult.formFilled && !linkedinResult.applied) {
        applicationResult.actionRequired = 'Form filled - manual submission required';
        applicationResult.requiresAction = true;
      }
      
    } else {
      // Other job sources
      applicationResult = {
        applied: false,
        applicationMethod: 'external_site_application',
        status: 'requires_manual_application',
        actionRequired: `Visit ${job.url} to apply`,
        requiresAction: true
      };
    }
    
    // Enhanced status tracking
    const statusMap = {
      'external_application_required': 'MANUAL_ACTION_REQUIRED',
      'form_filled_awaiting_submission': 'FORM_READY_FOR_SUBMIT', 
      'direct_application_completed': 'APPLIED',
      'external_site_application': 'VISIT_SITE_TO_APPLY',
      'demo_application': 'DEMO_ONLY',
      'error': 'APPLICATION_FAILED'
    };
    
    const finalStatus = statusMap[applicationResult.applicationMethod] || 'UNKNOWN';
    
    console.log(`📊 Application Status: ${finalStatus}`);
    console.log(`🔗 Job URL: ${job.url}`);
    console.log(`⚡ Action Required: ${applicationResult.actionRequired || 'None'}`);
    
    return {
      ...applicationResult,
      status: finalStatus
    };
    
  } catch (error) {
    console.error('Error processing job application:', error);
    return {
      applied: false,
      applicationMethod: 'error',
      status: 'APPLICATION_ERROR',
      actionRequired: 'Error occurred - check logs'
    };
  }
}
  generateCoverLetter(job: any, user: any) {
    throw new Error("Method not implemented.");
  }

  // Safe date parsing method
  private safeParseDate(dateInput: any): string {
    try {
      if (dateInput instanceof Date) {
        if (isNaN(dateInput.getTime())) {
          console.log("DEBUG: Invalid Date object, using current time");
          return new Date().toISOString();
        }
        return dateInput.toISOString();
      }

      if (dateInput) {
        const parsedDate = new Date(dateInput);
        if (isNaN(parsedDate.getTime())) {
          console.log(
            "DEBUG: Failed to parse date:",
            dateInput,
            "using current time"
          );
          return new Date().toISOString();
        }
        return parsedDate.toISOString();
      }

      return new Date().toISOString();
    } catch (error: unknown) {
      console.log(
        "DEBUG: Date parsing error for:",
        dateInput,
        "using current time"
      );
      return new Date().toISOString();
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
