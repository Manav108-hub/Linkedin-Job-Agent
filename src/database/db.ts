// src/database/db.ts - Prisma Client Implementation (FIXED)
import { PrismaClient } from "@prisma/client";

// Initialize Prisma Client
export const prisma = new PrismaClient({
  log:
    process.env.NODE_ENV === "development"
      ? ["query", "info", "warn", "error"]
      : ["error"],
});

// Database connection
export const initDatabase = async () => {
  try {
    await prisma.$connect();
    console.log("✅ Database connected successfully");
    return prisma;
  } catch (error) {
    console.error("❌ Database connection failed:", error);
    throw error;
  }
};

export const getDatabase = () => {
  return prisma;
};

export const closeDatabase = async () => {
  await prisma.$disconnect();
  console.log("✅ Database connection closed");
};

export const getDatabaseStats = async () => {
  const [users, jobs, applications, resumes, hrContacts] = await Promise.all([
    prisma.user.count(), // Using PascalCase model names
    prisma.jobListing.count(),
    prisma.jobApplication.count(),
    prisma.resume.count(),
    prisma.hrContact.count(),
  ]);

  return {
    users,
    jobs,
    applications,
    resumes,
    hr_contacts: hrContacts,
  };
};

// Database Models using Prisma
export class UserModel {
  static updateLinkedInToken(email: any, accessToken: string) {
    throw new Error('Method not implemented.');
  }
  static async updateGoogleTokens(
    email: string,
    googleToken: string,
    googleRefreshToken?: string | null
  ) {
    return await prisma.user.update({
      where: { email },
      data: {
        googleToken,
        googleRefreshToken: googleRefreshToken || null,
      },
    });
  }

  static async create(userData: {
    id?: string;
    linkedinId?: string;
    googleId?: string;
    name: string;
    email: string;
    profileData?: any;
    resumeDocId?: string;
    resumeText?: string;
    resumeFilename?: string;
    linkedinToken?: string;
    googleToken?: string;
    googleRefreshToken?: string;
  }) {
    return await prisma.user.upsert({
      where: { email: userData.email },
      update: {
        name: userData.name,
        profileData: userData.profileData,
        resumeDocId: userData.resumeDocId,
        resumeText: userData.resumeText,
        resumeFilename: userData.resumeFilename,
        linkedinToken: userData.linkedinToken,
        googleToken: userData.googleToken,
        googleRefreshToken: userData.googleRefreshToken,
      },
      create: {
        linkedinId: userData.linkedinId,
        googleId: userData.googleId,
        name: userData.name,
        email: userData.email,
        profileData: userData.profileData,
        resumeDocId: userData.resumeDocId,
        resumeText: userData.resumeText,
        resumeFilename: userData.resumeFilename,
        linkedinToken: userData.linkedinToken,
        googleToken: userData.googleToken,
        googleRefreshToken: userData.googleRefreshToken,
      },
    });
  }

  static async updateResume(
    userId: string,
    resumeData: {
      resumeText: string;
      resumeFilename: string;
      resumeDocId?: string;
    }
  ) {
    return await prisma.user.update({
      where: { id: userId },
      data: {
        resumeText: resumeData.resumeText,
        resumeFilename: resumeData.resumeFilename,
        resumeDocId: resumeData.resumeDocId,
      },
    });
  }

  static async findById(id: string) {
    return await prisma.user.findUnique({
      where: { id },
    });
  }

  static async findByEmail(email: string) {
    return await prisma.user.findUnique({
      where: { email },
    });
  }

  static async findByLinkedInId(linkedinId: string) {
    return await prisma.user.findUnique({
      where: { linkedinId },
    });
  }

  static async findByGoogleId(googleId: string) {
    return await prisma.user.findUnique({
      where: { googleId },
    });
  }

  static async findAutomationUsers() {
    return await prisma.user.findMany({
      where: {
        automationEnabled: true,
        resumeText: { not: null },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  static async updateAutomationSettings(
    userId: string,
    settings: {
      automationEnabled?: boolean;
      telegramChatId?: string;
      preferredKeywords?: string;
      preferredLocation?: string | null; // Allow null
      experienceLevel?: string | null; // Allow null
    }
  ) {
    const updateData: any = {};

    // Handle null values properly
    if (settings.automationEnabled !== undefined)
      updateData.automationEnabled = settings.automationEnabled;
    if (settings.telegramChatId !== undefined)
      updateData.telegramChatId = settings.telegramChatId;
    if (settings.preferredKeywords !== undefined)
      updateData.preferredKeywords = settings.preferredKeywords;
    if (settings.preferredLocation !== undefined)
      updateData.preferredLocation = settings.preferredLocation || null;
    if (settings.experienceLevel !== undefined)
      updateData.experienceLevel = settings.experienceLevel || null;
    return await prisma.user.update({
      where: { id: userId },
      data: settings,
    });
  }

  static async updateTelegramChatId(email: string, chatId: string) {
    return await prisma.user.update({
      where: { email },
      data: { telegramChatId: chatId },
    });
  }
}

export class JobListingModel {
  static async create(jobData: {
    id?: string;
    title: string;
    company: string;
    location?: string;
    description?: string;
    url?: string;
    salaryRange?: string;
    jobType?: string;
    experienceLevel?: string;
    postedDate?: string;
  }) {
    const data: any = {
      title: jobData.title,
      company: jobData.company,
      location: jobData.location,
      description: jobData.description,
      url: jobData.url,
      salaryRange: jobData.salaryRange,
      jobType: jobData.jobType,
      experienceLevel: jobData.experienceLevel,
    };

    // Safe date handling
    if (jobData.postedDate) {
      try {
        const parsedDate = new Date(jobData.postedDate);
        if (!isNaN(parsedDate.getTime())) {
          data.postedDate = parsedDate;
        }
      } catch (error) {
        console.log("Date parsing error, using current date");
      }
    }

    return await prisma.jobListing.upsert({
      where: { url: jobData.url || "no-url-" + Date.now() },
      update: data,
      create: { ...data, id: jobData.id },
    });
  }

  static async findById(id: string) {
    return await prisma.jobListing.findUnique({
      where: { id },
    });
  }

  static async findByUrl(url: string) {
    return await prisma.jobListing.findUnique({
      where: { url },
    });
  }
}

export class JobApplicationModel {
  static async create(applicationData: {
    userId: string;
    jobId: string;
    jobUrl?: string;
    status: string;
    matchScore?: number;
    notes?: string;
    resumeCustomized?: boolean;
    driveLink?: string;
  }) {
    return await prisma.jobApplication.create({
      data: {
        userId: applicationData.userId,
        jobId: applicationData.jobId,
        jobUrl: applicationData.jobUrl,
        status: applicationData.status,
        matchScore: applicationData.matchScore,
        notes: applicationData.notes,
        resumeCustomized: applicationData.resumeCustomized || false,
        driveLink: applicationData.driveLink,
      },
    });
  }

  static async findById(id: string) {
    return await prisma.jobApplication.findUnique({
      where: { id },
      include: {
        jobListing: true,
        user: true,
      },
    });
  }

  static async findByUserId(userId: string, limit: number = 50) {
    return await prisma.jobApplication.findMany({
      where: { userId },
      include: {
        jobListing: {
          select: {
            title: true,
            company: true,
            url: true,
            location: true,
          },
        },
      },
      orderBy: { appliedAt: "desc" },
      take: limit,
    });
  }

  static async findByJobUrl(jobUrl: string) {
    return await prisma.jobApplication.findFirst({
      where: { jobUrl },
    });
  }

  static async updateStatus(id: string, status: string, notes?: string) {
    return await prisma.jobApplication.update({
      where: { id },
      data: { status, notes },
    });
  }

  static async getAppliedUrls(userId: string): Promise<Set<string>> {
    const applications = await prisma.jobApplication.findMany({
      where: { userId },
      include: { jobListing: { select: { url: true } } },
    });

    const urls = applications
      .map((app) => app.jobListing.url)
      .filter((url) => url !== null) as string[];

    return new Set(urls);
  }
}

export class HRContactModel {
  static async create(contactData: {
    jobId: string;
    name?: string;
    email?: string;
    linkedinProfile?: string;
    title?: string;
    company?: string;
    phone?: string;
  }) {
    return await prisma.hrContact.create({
      data: {
        jobId: contactData.jobId,
        name: contactData.name,
        email: contactData.email,
        linkedinProfile: contactData.linkedinProfile,
        title: contactData.title,
        company: contactData.company,
        phone: contactData.phone,
      },
    });
  }

  static async findById(id: string) {
    return await prisma.hrContact.findUnique({
      where: { id },
    });
  }

  static async findByJobId(jobId: string) {
    return await prisma.hrContact.findMany({
      where: { jobId },
    });
  }
}

export class ResumeModel {
  static async create(resumeData: {
    userId: string;
    jobId: string;
    originalContent: string;
    customizedContent: string;
    formatType?: string;
    filePath?: string;
    customizationSuccessful?: boolean;
  }) {
    return await prisma.resume.create({
      data: {
        userId: resumeData.userId,
        jobId: resumeData.jobId,
        originalContent: resumeData.originalContent,
        customizedContent: resumeData.customizedContent,
        formatType: resumeData.formatType || "professional",
        filePath: resumeData.filePath,
        customizationSuccessful: resumeData.customizationSuccessful !== false,
      },
    });
  }

  static async findById(id: string) {
    return await prisma.resume.findUnique({
      where: { id },
    });
  }

  static async findByUserAndJob(userId: string, jobId: string) {
    return await prisma.resume.findFirst({
      where: { userId, jobId },
    });
  }

  static async findByUserId(userId: string) {
    return await prisma.resume.findMany({
      where: { userId },
      include: {
        jobListing: {
          select: {
            title: true,
            company: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }
}

export class EmailDraftModel {
  static async create(emailData: {
    userId: string;
    jobId: string;
    hrContactId?: string;
    subject: string;
    body: string;
    emailType?: string;
  }) {
    return await prisma.emailDraft.create({
      data: {
        userId: emailData.userId,
        jobId: emailData.jobId,
        hrContactId: emailData.hrContactId,
        subject: emailData.subject,
        body: emailData.body,
        emailType: emailData.emailType || "application",
      },
    });
  }

  static async findById(id: string) {
    return await prisma.emailDraft.findUnique({
      where: { id },
    });
  }

  static async findByJobId(jobId: string) {
    return await prisma.emailDraft.findMany({
      where: { jobId },
    });
  }

  static async markAsSent(id: string) {
    return await prisma.emailDraft.update({
      where: { id },
      data: { sentAt: new Date() },
    });
  }
}

export class AutomationLogModel {
  static async create(logData: {
    userId: string;
    runDate: Date;
    jobsFound: number;
    applicationsSent: number;
    duplicatesSkipped: number;
    errorsOccurred: number;
    executionTimeMs?: number;
    status: string;
    errorMessage?: string;
  }) {
    return await prisma.automationLog.create({
      data: logData,
    });
  }

  static async findByUserId(userId: string, limit: number = 10) {
    return await prisma.automationLog.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }
}

export class NotificationLogModel {
  static async create(logData: {
    userId: string;
    notificationType: string;
    status: string;
    messageContent?: string;
    errorMessage?: string;
  }) {
    return await prisma.notificationLog.create({
      data: logData,
    });
  }

  static async findByUserId(userId: string, limit: number = 20) {
    return await prisma.notificationLog.findMany({
      where: { userId },
      orderBy: { sentAt: "desc" },
      take: limit,
    });
  }
}
