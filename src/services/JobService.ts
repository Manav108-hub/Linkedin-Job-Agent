// src/services/JobService.ts - FIXED with type safety
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

          // FIX: Safe job description handling with proper type checking
          let jobDescription = "";
          try {
            // Check if job has description property and handle safely
            if (job && typeof job === 'object' && 'description' in job && typeof job.description === 'string') {
              jobDescription = job.description;
            } else if (this.linkedinService.getJobDescription) {
              const descriptionResult = await this.linkedinService.getJobDescription(job.url);
              // jobDescription = typeof descriptionResult === 'string' ? 
              // With proper type checking:
                let jobDescription = "";
                try {
                  // Check if job has description property and handle safely
                  if (job && typeof job === 'object' && 'description' in job && typeof job.description === 'string') {
                    jobDescription = job.description;
                  } else if (this.linkedinService.getJobDescription) {
                    const descriptionResult = await this.linkedinService.getJobDescription(job.url);
                    // Proper type checking for descriptionResult
                    if (typeof descriptionResult === 'string') {
                      jobDescription = descriptionResult;
                    } else if (descriptionResult && typeof descriptionResult === 'object' && 'description' in descriptionResult) {
                      jobDescription = (descriptionResult as any).description || "";
                    } else {
                      jobDescription = "";
                    }
                  } else {
                    jobDescription = `Job: ${job.title} at ${job.company}. Location: ${job.location || 'Not specified'}`;
                  }
                } catch (descError) {
                  console.log("Failed to get detailed job description, using basic info");
                  jobDescription = `Job: ${job.title} at ${job.company}. Location: ${job.location || 'Not specified'}`;
                }
            } else {
              // Fallback description
              jobDescription = `Job: ${job.title} at ${job.company}. Location: ${job.location || 'Not specified'}`;
            }
          } catch (descError) {
            console.log("Failed to get detailed job description, using basic info");
            jobDescription = `Job: ${job.title} at ${job.company}. Location: ${job.location || 'Not specified'}`;
          }

          // Analyze match with Gemini
          let analysis = {
            matchScore: 70,
            missingSkills: [] as string[],
            recommendations: [] as string[]
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
            if (typeof this.geminiService.generateJobSuggestions === 'function') {
              suggestions = await this.geminiService.generateJobSuggestions(
                originalResume,
                jobDescription,
                job.title,
                job.company
              );
            } else {
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

          // Save job to database with proper error handling
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

      await this.linkedinService.close();

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

  // Automated job processing for scheduled runs
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

      const dbUser = await this.getActualDatabaseUser(user);
      if (!dbUser) {
        throw new Error(`User not found in database: ${user.email}`);
      }

      await this.telegramService.sendAutomationStartNotification(user.email);

      const jobs = await this.linkedinService.searchJobs(
        criteria.keywords,
        criteria.location,
        20
      );

      results.found = jobs.length;
      console.log(`Found ${jobs.length} jobs for automation`);

      if (jobs.length === 0) {
        return results;
      }

      const originalResume = await this.resumeService.getUserResumeText(dbUser.id);

      let driveService: GoogleDriveService | null = null;
      if (user.googleToken) {
        try {
          driveService = new GoogleDriveService(
            user.googleToken,
            user.googleRefreshToken
          );
          console.log("Google Drive service initialized for automation");
        } catch (error) {
          console.log("Google Drive initialization failed, continuing without Drive");
        }
      }

      const newJobs = jobs.filter((job) => !excludeUrls.has(job.url));
      results.skipped = jobs.length - newJobs.length;

      console.log(
        `Processing ${newJobs.length} new jobs (${results.skipped} duplicates skipped)`
      );

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

          if (result.actuallyApplied) {
            results.applied++;

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

          await this.sleep(8000);
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(
            `Failed to process job ${job.title} at ${job.company}:`,
            errorMessage
          );
          results.errors++;
        }
      }

      await this.linkedinService.close();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("Automated job processing failed:", errorMessage);
      results.errors++;

      await this.telegramService.sendErrorNotification(user.email, errorMessage);
    }

    return results;
  }

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
    const savedJob = await JobListingModel.create({
      id: job.id,
      title: job.title,
      company: job.company,
      location: job.location,
      description: job.description,
      url: job.url ?? undefined,
      postedDate: this.safeParseDate(job.postedDate),
    });

    console.log(`🎯 Processing job with ACTUAL APPLICATION: ${job.title} at ${job.company}`);

    const jobResult = await this.linkedinService.getJobDescriptionAndApply(
      job.url,
      originalResume
    );

    const jobDescription = jobResult.description;
    const actuallyApplied = jobResult.applied;
    const applicationMethod = jobResult.applicationMethod;

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
      console.log("DEBUG: Failed to extract HR contacts, continuing without them");
    }

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

    let customizedResume = originalResume;
    let matchScore = 75;
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
      const errorMessage = customizationError instanceof Error ? customizationError.message : String(customizationError);
      console.log("DEBUG: AI resume customization failed:", errorMessage);
    }

    const savedResume = await ResumeModel.create({
      userId: dbUser.id,
      jobId: savedJob.id!,
      originalContent: originalResume,
      customizedContent: customizedResume,
      formatType: "professional",
      customizationSuccessful: resumeCustomized,
    });

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
      } catch (driveError: any) {
        console.log("Failed to save to Google Drive:", driveError.message);
      }
    }

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

  private async getActualDatabaseUser(user: UserSession): Promise<any> {
    let dbUser = await UserModel.findById(user.id);

    if (!dbUser) {
      console.log("User not found by session ID, trying email...");
      dbUser = await UserModel.findByEmail(user.email);

      if (dbUser) {
        console.log("Found user by email - ID mismatch detected!");
        console.log("Session ID:", user.id);
        console.log("Database ID:", dbUser.id);
      }
    }

    return dbUser;
  }

  async verifyJobApplication(jobUrl: string): Promise<{ applied: boolean; method: string }> {
    try {
      const existingApplication = await JobApplicationModel.findByJobUrl(jobUrl);
      if (existingApplication) {
        return { applied: true, method: "database_record" };
      }

      if (this.linkedinService) {
        try {
          const appliedStatus = await this.linkedinService.checkApplicationStatus(jobUrl);
          if (appliedStatus) {
            return { applied: true, method: "linkedin_verification" };
          }
        } catch (error) {
          console.log("LinkedIn verification failed, using database check only");
        }
      }

      return { applied: false, method: "not_found" };
    } catch (error) {
      console.error("Error verifying job application:", error);
      return { applied: false, method: "verification_failed" };
    }
  }

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

        const company = app.jobListing?.company || "Unknown";
        stats.topCompanies.set(
          company,
          (stats.topCompanies.get(company) || 0) + 1
        );
      }

      stats.averageMatchScore = scoreCount > 0 ? Math.round(totalScore / scoreCount) : 0;

      return stats;
    } catch (error) {
      console.error("Error getting user application stats:", error);
      return null;
    }
  }

  private safeParseDate(dateInput: any): string {
    try {
      if (dateInput instanceof Date) {
        if (isNaN(dateInput.getTime())) {
          return new Date().toISOString();
        }
        return dateInput.toISOString();
      }

      if (dateInput) {
        const parsedDate = new Date(dateInput);
        if (isNaN(parsedDate.getTime())) {
          return new Date().toISOString();
        }
        return parsedDate.toISOString();
      }

      return new Date().toISOString();
    } catch (error: unknown) {
      return new Date().toISOString();
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}