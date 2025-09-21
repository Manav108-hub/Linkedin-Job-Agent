// src/types/index.ts - Updated for Prisma Integration

// Enhanced UserSession with Prisma fields
export interface UserSession {
  id: string;
  name: string;
  email: string;
  linkedinToken?: string;
  googleToken?: string;
  googleRefreshToken?: string;
  socketId?: string;
  createdAt: Date;
  expiresAt: Date;
  // Prisma database fields
  linkedinId?: string;
  googleId?: string;
  profileData?: {
    skills?: string[];
    experience?: string;
    education?: string;
    location?: string;
    phone?: string;
    website?: string;
    resume_content?: string;
    resume_filename?: string;
    resume_uploaded_at?: string;
    resume_size?: number;
  };
  resumeDocId?: string;
  resumeText?: string;
  resumeFilename?: string;
  // Automation fields
  automationEnabled?: boolean;
  telegramChatId?: string;
  preferredKeywords?: string[]; // JSON array
  preferredLocation?: string;
  experienceLevel?: string;
}

// Prisma User Model (matches Prisma schema)
export interface User {
  id: string;
  linkedinId?: string | null;
  googleId?: string | null;
  name: string;
  email: string;
  profileData?: any; // JSON object in Prisma
  resumeDocId?: string | null;
  resumeText?: string | null;
  resumeFilename?: string | null;
  linkedinToken?: string | null;
  googleToken?: string | null;
  googleRefreshToken?: string | null;
  automationEnabled: boolean;
  telegramChatId?: string | null;
  preferredKeywords?: any; // JSON array
  preferredLocation?: string | null;
  experienceLevel?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// Enhanced JobListing with Prisma fields
export interface JobListing {
  id: string;
  title: string;
  company: string;
  location?: string | null;
  description?: string | null;
  url?: string | null;
  salaryRange?: string | null;
  jobType?: string | null; // 'full-time' | 'part-time' | 'contract' | 'freelance' | 'internship'
  experienceLevel?: string | null; // 'entry-level' | 'mid-level' | 'senior-level' | 'executive'
  postedDate?: Date | null;
  scrapedAt: Date;
  isActive: boolean;
  // Derived fields for compatibility
  requirements?: string[];
  benefits?: string[];
}

// Prisma JobApplication Model
export interface JobApplication {
  id: string;
  userId: string;
  jobId: string;
  jobUrl?: string | null;
  status: string; // 'pending' | 'applied' | 'rejected' | 'interview' | 'offer'
  matchScore?: number | null;
  appliedAt: Date;
  updatedAt: Date;
  notes?: string | null;
  resumeCustomized: boolean;
  driveLink?: string | null;
  // Relation fields (when included)
  jobListing?: {
    title: string;
    company: string;
    location?: string | null;
    url?: string | null;
  };
  user?: {
    name: string;
    email: string;
  };
}

// Enhanced CustomizedApplication (for API responses)
export interface CustomizedApplication {
  id?: string;
  jobId: string;
  originalResume: string;
  customizedResume: string;
  company: string;
  title: string;
  status: 'pending' | 'applied' | 'rejected' | 'interview' | 'offer' | 'failed';
  resumeDocId?: string;
  userId?: string;
  match_score?: number;
  applied_at?: Date;
  updated_at?: Date;
  notes?: string;
  hr_contacts_found?: number;
  email_drafted?: boolean;
  driveLink?: string;
}

// Enhanced JobSearchCriteria
export interface JobSearchCriteria {
  keywords: string[];
  location: string;
  experienceLevel: 'entry-level' | 'mid-level' | 'senior-level' | 'executive';
  jobType: 'full-time' | 'part-time' | 'contract' | 'freelance' | 'internship';
  // Optional filters
  salaryMin?: number;
  salaryMax?: number;
  datePosted?: '24h' | '7d' | '30d';
  companySize?: 'startup' | 'small' | 'medium' | 'large' | 'enterprise';
  remoteWork?: 'on-site' | 'remote' | 'hybrid';
}

// Prisma HRContact Model
export interface HRContact {
  id: string;
  jobId: string;
  name?: string | null;
  email?: string | null;
  linkedinProfile?: string | null;
  title?: string | null;
  company?: string | null;
  phone?: string | null;
  extractedAt: Date;
}

// Prisma Resume Model
export interface ResumeRecord {
  id: string;
  userId: string;
  jobId: string;
  originalContent: string;
  customizedContent: string;
  formatType: string; // 'professional' | 'modern' | 'creative'
  filePath?: string | null;
  customizationSuccessful: boolean;
  createdAt: Date;
  // Relation fields (when included)
  jobListing?: {
    title: string;
    company: string;
  };
}

// Prisma EmailDraft Model
export interface EmailDraft {
  id: string;
  userId: string;
  jobId: string;
  hrContactId?: string | null;
  subject: string;
  body: string;
  emailType: string; // 'application' | 'follow_up' | 'thank_you'
  createdAt: Date;
  sentAt?: Date | null;
  // Relation fields
  hrContact?: {
    name?: string | null;
    email?: string | null;
    title?: string | null;
  };
}

// New Automation Models
export interface AutomationLog {
  id: string;
  userId: string;
  runDate: Date;
  jobsFound: number;
  applicationsSent: number;
  duplicatesSkipped: number;
  errorsOccurred: number;
  executionTimeMs?: number | null;
  status: string; // 'completed' | 'failed' | 'partial'
  errorMessage?: string | null;
  createdAt: Date;
}

export interface NotificationLog {
  id: string;
  userId: string;
  notificationType: string; // 'telegram' | 'email' | 'drive'
  status: string; // 'sent' | 'failed' | 'skipped'
  messageContent?: string | null;
  errorMessage?: string | null;
  sentAt: Date;
}

// API Response types
export interface APIResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  timestamp?: string;
}

export interface UserStatusResponse {
  id: string;
  name: string;
  email: string;
  linkedinConnected: boolean;
  googleConnected: boolean;
  resumeUploaded: boolean;
  automationEnabled: boolean;
  telegramConfigured: boolean;
  sessionExpires: Date;
  stats: {
    totalApplications: number;
    recentApplications: JobApplication[];
  };
}

export interface AutomationStatusResponse {
  user: {
    email: string;
    name: string;
    automationEnabled: boolean;
    hasLinkedInToken: boolean;
    hasGoogleToken: boolean;
    hasTelegramChatId: boolean;
    preferredKeywords: string[];
    preferredLocation: string;
  };
  applicationStats: any;
  integrations: {
    telegram: {
      configured: boolean;
      userConfigured: boolean;
    };
    googleDrive: {
      configured: boolean;
      canSave: boolean;
    };
    linkedin: {
      configured: boolean;
    };
  };
}

export interface JobHistoryResponse {
  applications: JobApplication[];
  total: number;
  userId: string;
}

export interface JobDetailsResponse {
  application: JobApplication;
  hrContacts: HRContact[];
  resume?: ResumeRecord;
  emailDrafts: EmailDraft[];
}

// Automation Results
export interface AutomationResults {
  found: number;
  applied: number;
  skipped: number;
  errors: number;
}

// Telegram Bot Info
export interface TelegramBotInfo {
  success: boolean;
  botInfo?: {
    id: number;
    is_bot: boolean;
    first_name: string;
    username: string;
    can_join_groups: boolean;
    can_read_all_group_messages: boolean;
    supports_inline_queries: boolean;
  };
  configured: boolean;
  error?: string;
}

// Google Drive Test Response
export interface DriveTestResponse {
  success: boolean;
  message: string;
  testFileLink?: string;
  timestamp: string;
}

// Socket.IO event types
export interface SocketEvents {
  // Client to server
  authenticate: (token: string) => void;
  
  // Server to client
  authenticated: (data: { status: 'success' | 'error'; message?: string; user?: any }) => void;
  job_search_started: (data: { message: string }) => void;
  jobs_found: (data: { count: number; jobs: JobListing[] }) => void;
  processing_job: (data: { company: string; title: string; progress: number }) => void;
  job_processed: (data: { 
    company: string; 
    title: string; 
    matchScore?: number; 
    status: string; 
    timestamp: string;
    hrContactsFound?: number;
    resumeGenerated?: boolean;
    emailDrafted?: boolean;
    resumeCustomized?: boolean;
    driveLink?: string;
  }) => void;
  job_error: (data: { company: string; title: string; error: string }) => void;
  job_search_completed: (data: { 
    message: string; 
    applications: number;
    customizedResumes?: number;
  }) => void;
  job_search_error: (data: { error: string }) => void;
}

// Database Stats
export interface DatabaseStats {
  users: number;
  jobs: number;
  applications: number;
  resumes: number;
  hr_contacts: number;
}

// Verification Response
export interface ApplicationVerification {
  applied: boolean;
  method: 'database_record' | 'linkedin_verification' | 'not_found' | 'verification_failed';
}

// User Application Statistics
export interface UserApplicationStats {
  total: number;
  thisWeek: number;
  thisMonth: number;
  customizedResumes: number;
  averageMatchScore: number;
  topCompanies: Map<string, number>;
  recentApplications: JobApplication[];
}