// src/services/ResumeService.ts - Smart content extraction preserving links
import pdf from 'pdf-parse';
import fs from 'fs';
import path from 'path';
import { UserModel } from '../database/db';

interface ResumeSection {
  summary?: string;
  experience?: string;
  skills?: string;
  projects?: string;
  education?: string;
}

export class ResumeService {
  private uploadsDir: string;

  constructor() {
    this.uploadsDir = path.join(__dirname, '../../uploads');
    this.ensureUploadsDir();
  }

  private ensureUploadsDir() {
    if (!fs.existsSync(this.uploadsDir)) {
      fs.mkdirSync(this.uploadsDir, { recursive: true });
    }
  }

  async processResumeUpload(file: any, userId: string): Promise<{
    filename: string;
    resumeText: string;
    resumeSections: ResumeSection;
    originalFileBuffer: Buffer;
    success: boolean;
  }> {
    try {
      console.log('DEBUG: Processing resume upload for user:', userId);
      console.log('DEBUG: File details:', {
        filename: file.filename,
        mimetype: file.mimetype,
        size: file.size
      });

      let resumeText = '';
      let originalFileBuffer: Buffer;

      // Store original file buffer for later use
      originalFileBuffer = fs.readFileSync(file.path);

      // Extract text based on file type
      if (file.mimetype === 'application/pdf') {
        resumeText = await this.extractTextFromPDF(file.path);
      } else if (file.mimetype === 'text/plain') {
        resumeText = fs.readFileSync(file.path, 'utf8');
      } else if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        resumeText = await this.extractTextFromDocx(file.path);
      } else if (file.mimetype === 'application/msword') {
        throw new Error('Legacy .doc files not supported. Please use .docx or PDF format.');
      } else {
        throw new Error(`Unsupported file type: ${file.mimetype}`);
      }

      console.log('DEBUG: Extracted text length:', resumeText.length);

      if (!resumeText || resumeText.trim().length < 50) {
        throw new Error('Could not extract meaningful text from resume. Please ensure the file contains readable text.');
      }

      // Extract sections from resume text
      const resumeSections = this.extractResumeSections(resumeText);

      // Update user with resume data - FIXED: Removed resumeSections from database update
      await UserModel.updateResume(userId, {
        resumeText: resumeText,
        resumeFilename: file.filename,
        resumeDocId: `resume_${userId}_${Date.now()}`
      });

      console.log('DEBUG: Resume successfully processed and sections extracted');

      return {
        filename: file.filename,
        resumeText: resumeText,
        resumeSections: resumeSections,
        originalFileBuffer: originalFileBuffer,
        success: true
      };

    } catch (error: unknown) {
      console.error('ERROR: Resume processing failed:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to process resume: ${errorMessage}`);
    }
  }

  // Extract structured sections from resume text
  private extractResumeSections(resumeText: string): ResumeSection {
    const text = resumeText.toLowerCase();
    const sections: ResumeSection = {};

    // Define section patterns
    const patterns = {
      summary: /(summary|profile|objective|about)/,
      experience: /(experience|work|employment|career)/,
      skills: /(skills|technical|technologies|competencies)/,
      projects: /(projects|portfolio|work samples)/,
      education: /(education|qualifications|degrees|academic)/
    };

    // Split text into lines for processing
    const lines = resumeText.split('\n');
    let currentSection = '';
    let sectionContent: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const lowercaseLine = line.toLowerCase();

      // Check if this line is a section header
      let foundSection = '';
      for (const [sectionName, pattern] of Object.entries(patterns)) {
        if (pattern.test(lowercaseLine) && line.length < 50) {
          foundSection = sectionName;
          break;
        }
      }

      if (foundSection) {
        // Save previous section if exists
        if (currentSection && sectionContent.length > 0) {
          sections[currentSection as keyof ResumeSection] = sectionContent.join('\n').trim();
        }
        // Start new section
        currentSection = foundSection;
        sectionContent = [];
      } else if (currentSection && line.length > 0) {
        // Add content to current section
        sectionContent.push(line);
      }
    }

    // Save the last section
    if (currentSection && sectionContent.length > 0) {
      sections[currentSection as keyof ResumeSection] = sectionContent.join('\n').trim();
    }

    return sections;
  }

  // Get resume sections for AI customization
  async getUserResumeSections(userId: string): Promise<ResumeSection> {
    try {
      const user = await UserModel.findById(userId);
      
      if (user && user.resumeSections) {
        return JSON.parse(user.resumeSections as string);
      }
      
      // Fallback: extract sections from full text
      const resumeText = await this.getUserResumeText(userId);
      return this.extractResumeSections(resumeText);
    } catch (error) {
      console.error('Error getting resume sections:', error);
      return {};
    }
  }

  // Get user's original file buffer (preserves formatting and links)
  async getUserOriginalResume(userId: string): Promise<Buffer | null> {
    try {
      const user = await UserModel.findById(userId);
      return user?.originalFileBuffer || null;
    } catch (error) {
      console.error('Error getting original resume:', error);
      return null;
    }
  }

  // Create customized resume by replacing only specific sections
  createCustomizedResumeWithSections(
    originalText: string, 
    customizedSections: Partial<ResumeSection>
  ): string {
    let customizedText = originalText;

    // Replace each customized section in the original text
    for (const [sectionName, newContent] of Object.entries(customizedSections)) {
      if (newContent) {
        const originalSections = this.extractResumeSections(originalText);
        const originalContent = originalSections[sectionName as keyof ResumeSection];
        
        if (originalContent) {
          customizedText = customizedText.replace(originalContent, newContent);
        }
      }
    }

    return customizedText;
  }

  private async extractTextFromPDF(filePath: string): Promise<string> {
    try {
      console.log('DEBUG: Extracting text from PDF:', filePath);
      
      const dataBuffer = fs.readFileSync(filePath);
      const data = await pdf(dataBuffer);
      
      console.log('DEBUG: PDF extraction successful, text length:', data.text.length);
      
      if (!data.text || data.text.trim().length === 0) {
        throw new Error('PDF appears to be empty or contains no extractable text');
      }
      
      return data.text.trim();
    } catch (error: unknown) {
      console.error('ERROR: PDF text extraction failed:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to extract text from PDF: ${errorMessage}`);
    }
  }

  private async extractTextFromDocx(filePath: string): Promise<string> {
    try {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ path: filePath });
      
      if (!result.value || result.value.trim().length === 0) {
        throw new Error('DOCX appears to be empty or contains no extractable text');
      }
      
      return result.value.trim();
    } catch (error: unknown) {
      console.error('ERROR: DOCX text extraction failed:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to extract text from DOCX: ${errorMessage}`);
    }
  }

  // ORIGINAL METHOD - kept for compatibility
  async getUserResumeText(userId: string): Promise<string> {
    try {
      const user = await UserModel.findById(userId);
      
      if (user && user.resumeText) {
        console.log('DEBUG: Found resume text for user:', userId, 'Length:', user.resumeText.length);
        return user.resumeText;
      }
      
      if (user && user.profileData) {
        const profileData = user.profileData as any;
        if (profileData?.resume_content) {
          console.log('DEBUG: Found resume in profileData for user:', userId);
          return profileData.resume_content;
        }
      }
      
      console.log('DEBUG: No resume text found for user:', userId, 'using mock resume');
      return this.getMockResume();
    } catch (error: unknown) {
      console.error('ERROR: Failed to get user resume text:', error);
      return this.getMockResume();
    }
  }

  // NEW METHOD - lookup by email
  async getUserResumeTextByEmail(userEmail: string): Promise<string> {
    try {
      const user = await UserModel.findByEmail(userEmail);
      
      if (!user) {
        console.log('DEBUG: No user found for email:', userEmail, 'using mock resume');
        return this.getMockResume();
      }

      if (user.resumeText) {
        console.log('DEBUG: Found resume text for user email:', userEmail, 'Length:', user.resumeText.length);
        return user.resumeText;
      }
      
      if (user.profileData) {
        const profileData = user.profileData as any;
        if (profileData?.resume_content && profileData.resume_content.length > 50) {
          console.log('DEBUG: Found resume in profileData for user email:', userEmail, 'Length:', profileData.resume_content.length);
          return profileData.resume_content;
        }
      }
      
      console.log('DEBUG: No resume text found for user email:', userEmail, 'using mock resume');
      return this.getMockResume();
    } catch (error: unknown) {
      console.error('ERROR: Failed to get user resume text by email:', error);
      return this.getMockResume();
    }
  }

  private getMockResume(): string {
    return `FULL STACK DEVELOPER
Professional Software Developer
contact@email.com | (555) 123-4567 | LinkedIn Profile

PROFESSIONAL SUMMARY
Experienced software developer with expertise in modern web technologies including React, Node.js, and cloud platforms. Proven track record of building scalable applications and working effectively in agile development environments.

TECHNICAL SKILLS
Languages: JavaScript, TypeScript, Python, Java
Frontend: React, Vue.js, Angular, HTML5, CSS3
Backend: Node.js, Express.js, Python, REST APIs
Databases: PostgreSQL, MongoDB, MySQL
Cloud & DevOps: AWS, Docker, Git, CI/CD
Tools: Jest, Webpack, npm, Linux

PROFESSIONAL EXPERIENCE

Software Developer | Technology Company | 2021 - Present
• Developed and maintained web applications using React and Node.js
• Collaborated with cross-functional teams in agile development environment
• Implemented automated testing and deployment pipelines
• Optimized application performance and user experience

Junior Developer | Software Solutions Inc. | 2019 - 2021
• Built responsive web interfaces using modern JavaScript frameworks
• Worked with REST APIs and database integration
• Participated in code reviews and team development processes
• Contributed to project planning and technical documentation

PROJECTS

E-commerce Platform
• Built full-stack web application with user authentication and payment processing
• Technologies: React, Node.js, PostgreSQL, Stripe API

Task Management System
• Developed team collaboration tool with real-time updates
• Technologies: Vue.js, Express.js, MongoDB, WebSockets

EDUCATION
Bachelor of Science in Computer Science
University | 2019

CERTIFICATIONS
• AWS Cloud Practitioner
• JavaScript ES6+ Certification`;
  }

  // Clean up old resume files
  async cleanupOldFiles(maxAgeInDays: number = 30) {
    try {
      const files = fs.readdirSync(this.uploadsDir);
      const cutoffTime = Date.now() - (maxAgeInDays * 24 * 60 * 60 * 1000);
      
      for (const file of files) {
        const filePath = path.join(this.uploadsDir, file);
        const stats = fs.statSync(filePath);
        
        if (stats.mtime.getTime() < cutoffTime) {
          fs.unlinkSync(filePath);
          console.log('DEBUG: Cleaned up old file:', file);
        }
      }
    } catch (error: unknown) {
      console.error('ERROR: File cleanup failed:', error);
    }
  }
}