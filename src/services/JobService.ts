// src/services/JobService.ts - Fixed with proper user ID handling
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

  // Interactive job processing (existing method with Drive integration)
  async processJobsForUser(
    user: UserSession,
    io: Socket,
    criteria: JobSearchCriteria
  ): Promise<void> {
    try {
      await this.linkedinService.initialize();

      io.emit("job_search_started", { message: "Searching for jobs..." });

      // 1. Search for jobs
      const jobs = await this.linkedinService.searchJobs(
        criteria.keywords,
        criteria.location,
        10
      );

      io.emit("jobs_found", { count: jobs.length, jobs: jobs.slice(0, 3) });

      if (jobs.length === 0) {
        io.emit("job_search_completed", { message: "No matching jobs found." });
        return;
      }

      // 2. Get the actual database user (FIX FOR ID MISMATCH)
      const dbUser = await this.getActualDatabaseUser(user);
      if (!dbUser) {
        throw new Error(`User not found in database: ${user.email}`);
      }

      // 3. Get user's resume text using database user ID
      const originalResume = await this.resumeService.getUserResumeText(dbUser.id);
      console.log('DEBUG: Using resume text of length:', originalResume.length);

      // 4. Initialize Google Drive service if user has token
      let driveService: GoogleDriveService | null = null;
      if (user.googleToken) {
        try {
          driveService = new GoogleDriveService(user.googleToken, user.googleRefreshToken);
          const driveTest = await driveService.testConnection();
          console.log('Google Drive:', driveTest.message);
        } catch (error) {
          console.log('Google Drive initialization failed, continuing without Drive integration');
        }
      }

      // 5. Process each job
      const applications: CustomizedApplication[] = [];

      for (let i = 0; i < Math.min(jobs.length, 5); i++) {
        const job = jobs[i];

        try {
          io.emit("processing_job", {
            company: job.company,
            title: job.title,
            progress: Math.round(((i + 1) / Math.min(jobs.length, 5)) * 100),
          });

          const result = await this.processIndividualJob(dbUser, job, originalResume, driveService);
          applications.push(result.application);

          io.emit("job_processed", {
            company: job.company,
            title: job.title,
            matchScore: result.matchScore,
            status: result.resumeCustomized ? "Applied & Resume AI-Customized" : "Applied with Original Resume",
            timestamp: new Date().toISOString(),
            hrContactsFound: result.hrContactsCount,
            resumeGenerated: true,
            emailDrafted: result.hrContactsCount > 0,
            resumeCustomized: result.resumeCustomized,
            driveLink: result.driveLink
          });

          await this.sleep(2000);
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(`Error processing job ${job.title} at ${job.company}:`, errorMessage);

          io.emit("job_error", {
            company: job.company,
            title: job.title,
            error: "Failed to process job",
          });
        }
      }

      await this.linkedinService.cleanup();

      const successfulApplications = applications.length;
      const customizedResumes = applications.filter(app => app.customizedResume !== app.originalResume).length;

      io.emit("job_search_completed", {
        message: `Completed! ${successfulApplications} applications processed. ${customizedResumes} resumes AI-customized.`,
        applications: successfulApplications,
        customizedResumes: customizedResumes
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("Job processing error:", errorMessage);
      io.emit("job_search_error", {
        error: "Job search failed. Please try again.",
      });
    }
  }

  // Automated job processing for scheduled runs
  async processJobsAutomated(
    user: UserSession, 
    criteria: JobSearchCriteria, 
    excludeUrls: Set<string>
  ): Promise<{found: number, applied: number, skipped: number, errors: number}> {
    
    const results = { found: 0, applied: 0, skipped: 0, errors: 0 };
    
    try {
      await this.linkedinService.initialize();
      
      // Get the actual database user
      const dbUser = await this.getActualDatabaseUser(user);
      if (!dbUser) {
        throw new Error(`User not found in database: ${user.email}`);
      }
      
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
      const originalResume = await this.resumeService.getUserResumeText(dbUser.id);
      
      // Initialize Google Drive service
      let driveService: GoogleDriveService | null = null;
      if (user.googleToken) {
        try {
          driveService = new GoogleDriveService(user.googleToken, user.googleRefreshToken);
          console.log('Google Drive service initialized for automation');
        } catch (error) {
          console.log('Google Drive initialization failed, continuing without Drive');
        }
      }
      
      // Filter out duplicate jobs
      const newJobs = jobs.filter(job => !excludeUrls.has(job.url));
      results.skipped = jobs.length - newJobs.length;
      
      console.log(`Processing ${newJobs.length} new jobs (${results.skipped} duplicates skipped)`);
      
      // Process only new jobs (limit to 5 per day to avoid spam)
      const jobsToProcess = newJobs.slice(0, 5);
      
      for (const job of jobsToProcess) {
        try {
          const result = await this.processIndividualJob(dbUser, job, originalResume, driveService);
          
          // Send individual Telegram notification
          await this.telegramService.sendJobApplicationNotification(
            user.email,
            { 
              ...job, 
              matchScore: result.matchScore,
              resumeCustomized: result.resumeCustomized
            },
            result.driveLink
          );
          
          results.applied++;
          console.log(`Applied to ${job.title} at ${job.company} (Score: ${result.matchScore}%)`);
          
          // Add delay between applications to be respectful
          await this.sleep(3000);
          
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(`Failed to process job ${job.title} at ${job.company}:`, errorMessage);
          results.errors++;
        }
      }
      
      await this.linkedinService.cleanup();
      
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('Automated job processing failed:', errorMessage);
      results.errors++;
    }
    
    return results;
  }

  // Helper method to get actual database user (FIXES ID MISMATCH)
  private async getActualDatabaseUser(user: UserSession): Promise<any> {
    // First try to find by session ID
    let dbUser = await UserModel.findById(user.id);
    
    if (!dbUser) {
      console.log('User not found by session ID, trying email...');
      // Fallback to email lookup
      dbUser = await UserModel.findByEmail(user.email);
      
      if (dbUser) {
        console.log('Found user by email - ID mismatch detected!');
        console.log('Session ID:', user.id);
        console.log('Database ID:', dbUser.id);
      }
    }
    
    return dbUser;
  }

  // Core job processing logic (FIXED with proper user ID)
  // FIXED: Core job processing logic with proper user ID handling
private async processIndividualJob(
  dbUser: any, // Database user object with correct ID (ALREADY FIXED IN YOUR CODE)
  job: any, 
  originalResume: string, 
  driveService: GoogleDriveService | null
): Promise<{
  application: CustomizedApplication;
  matchScore: number;
  resumeCustomized: boolean;
  hrContactsCount: number;
  driveLink: string | null;
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

  // Get detailed job description
  let jobDescription = job.description;
  if (!jobDescription && job.url) {
    try {
      jobDescription = await this.linkedinService.getJobDescription(job.url);
    } catch (error) {
      console.log('DEBUG: Failed to get job description from URL, using basic description');
      jobDescription = job.description || 'No job description available';
    }
  }

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
    console.log('DEBUG: Failed to extract HR contacts, continuing without them');
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
      console.log('DEBUG: Failed to save HR contact, skipping');
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
    recommendations: []
  };

  try {
    console.log('DEBUG: Attempting AI resume customization...');
    customizedResume = await this.geminiService.customizeResume(
      originalResume,
      jobDescription,
      job.title,
      job.company
    );
    resumeCustomized = true;
    console.log('DEBUG: AI resume customization successful');

    // Try to analyze job match
    try {
      analysisResult = await this.geminiService.analyzeJobMatch(
        originalResume,
        jobDescription
      );
      matchScore = analysisResult.matchScore;
      console.log('DEBUG: Job match analysis successful, score:', matchScore);
    } catch (analysisError) {
      console.log('DEBUG: Job match analysis failed, using default score');
    }

  } catch (customizationError: unknown) {
    const errorMessage = customizationError instanceof Error ? customizationError.message : String(customizationError);
    console.log('DEBUG: AI resume customization failed:', errorMessage);
    
    if (errorMessage.includes('quota') || errorMessage.includes('429')) {
      console.log('DEBUG: Quota exceeded, using original resume');
    } else {
      console.log('DEBUG: Other AI error, using original resume');
    }
    // Continue with original resume
  }

  // ✅ FIXED: Save customized resume to database with correct user ID
  const savedResume = await ResumeModel.create({
    userId: dbUser.id,                 // ✅ Use actual database user ID (NOT session user ID)
    jobId: savedJob.id!,
    originalContent: originalResume,
    customizedContent: customizedResume,
    formatType: "professional",
    customizationSuccessful: resumeCustomized
  });

  // Save to Google Drive
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
      console.log('Failed to save to Google Drive, continuing without it');
    }
  }

  // ✅ FIXED: Save job application to database with correct user ID
  const savedApplication = await JobApplicationModel.create({
    userId: dbUser.id,                // ✅ Use actual database user ID (NOT session user ID)
    jobId: savedJob.id!,
    jobUrl: job.url ?? undefined,
    status: "applied",
    matchScore: matchScore,
    notes: `HR contacts found: ${hrContacts.length}. Resume ${resumeCustomized ? 'customized with AI' : 'used as original'}. ${driveLink ? 'Saved to Drive.' : ''}`,
    resumeCustomized: resumeCustomized,
    driveLink: driveLink ?? undefined
  });

  const application: CustomizedApplication = {
    id: savedApplication.id,
    jobId: job.id,
    originalResume,
    customizedResume,
    company: job.company,
    title: job.title,
    status: "applied",
    match_score: matchScore,
    hr_contacts_found: hrContacts.length,
    email_drafted: hrContacts.length > 0,
  };

  return {
    application,
    matchScore,
    resumeCustomized,
    hrContactsCount: hrContacts.length,
    driveLink
  };
}

  // Verification methods
  async verifyJobApplication(jobUrl: string): Promise<{applied: boolean, method: string}> {
    try {
      // Method 1: Check if job URL is in our database
      const existingApplication = await JobApplicationModel.findByJobUrl(jobUrl);
      if (existingApplication) {
        return { applied: true, method: 'database_record' };
      }

      // Method 2: Check LinkedIn page for application status
      if (this.linkedinService) {
        try {
          const appliedStatus = await this.linkedinService.checkApplicationStatus(jobUrl);
          if (appliedStatus) {
            return { applied: true, method: 'linkedin_verification' };
          }
        } catch (error) {
          console.log('LinkedIn verification failed, using database check only');
        }
      }

      return { applied: false, method: 'not_found' };
    } catch (error) {
      console.error('Error verifying job application:', error);
      return { applied: false, method: 'verification_failed' };
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
        recentApplications: applications.slice(0, 10)
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
        const company = app.jobListing?.company || 'Unknown';
        stats.topCompanies.set(company, (stats.topCompanies.get(company) || 0) + 1);
      }

      stats.averageMatchScore = scoreCount > 0 ? Math.round(totalScore / scoreCount) : 0;

      return stats;
    } catch (error) {
      console.error('Error getting user application stats:', error);
      return null;
    }
  }

  // Safe date parsing method
  private safeParseDate(dateInput: any): string {
    try {
      if (dateInput instanceof Date) {
        if (isNaN(dateInput.getTime())) {
          console.log('DEBUG: Invalid Date object, using current time');
          return new Date().toISOString();
        }
        return dateInput.toISOString();
      }

      if (dateInput) {
        const parsedDate = new Date(dateInput);
        if (isNaN(parsedDate.getTime())) {
          console.log('DEBUG: Failed to parse date:', dateInput, 'using current time');
          return new Date().toISOString();
        }
        return parsedDate.toISOString();
      }

      return new Date().toISOString();
    } catch (error: unknown) {
      console.log('DEBUG: Date parsing error for:', dateInput, 'using current time');
      return new Date().toISOString();
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}