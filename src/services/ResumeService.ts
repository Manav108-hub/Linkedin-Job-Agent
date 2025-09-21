// src/services/ResumeService.ts
import pdf from 'pdf-parse';
import fs from 'fs';
import path from 'path';
import { UserModel } from '../database/db';

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
      
      // Extract text based on file type
      if (file.mimetype === 'application/pdf') {
        resumeText = await this.extractTextFromPDF(file.path);
      } else if (file.mimetype === 'text/plain') {
        resumeText = fs.readFileSync(file.path, 'utf8');
      } else if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        // Handle .docx files (you'll need mammoth package)
        resumeText = await this.extractTextFromDocx(file.path);
      } else if (file.mimetype === 'application/msword') {
        // Handle .doc files
        throw new Error('Legacy .doc files not supported. Please use .docx or PDF format.');
      } else {
        throw new Error(`Unsupported file type: ${file.mimetype}`);
      }

      console.log('DEBUG: Extracted text length:', resumeText.length);
      console.log('DEBUG: First 200 chars:', resumeText.substring(0, 200));

      if (!resumeText || resumeText.trim().length < 50) {
        throw new Error('Could not extract meaningful text from resume. Please ensure the file contains readable text.');
      }

      // Update user with resume text and filename
      await UserModel.updateResume(userId, {
        resume_text: resumeText,
        resume_filename: file.filename
      });

      console.log('DEBUG: Resume successfully processed and saved to database');

      return {
        filename: file.filename,
        resumeText: resumeText,
        success: true
      };

    } catch (error: unknown) {
      console.error('ERROR: Resume processing failed:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to process resume: ${errorMessage}`);
    }
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
      // You'll need to install mammoth: npm install mammoth
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

  async getUserResumeText(userId: string): Promise<string> {
    try {
      const user = await UserModel.findById(userId);
      
      if (user && user.resume_text) {
        console.log('DEBUG: Found resume text for user:', userId, 'Length:', user.resume_text.length);
        return user.resume_text;
      }
      
      console.log('DEBUG: No resume text found for user:', userId, 'using mock resume');
      return this.getMockResume();
    } catch (error: unknown) {
      console.error('ERROR: Failed to get user resume text:', error);
      return this.getMockResume();
    }
  }

  private getMockResume(): string {
    return `
JOHN DOE
Senior Full-Stack Developer
john.doe@email.com | (555) 123-4567 | LinkedIn: /in/johndoe

PROFESSIONAL SUMMARY
Experienced full-stack developer with 5+ years of expertise in TypeScript, React, Node.js, and cloud technologies. Passionate about building scalable applications and leading development teams.

TECHNICAL SKILLS
- Languages: TypeScript, JavaScript, Python, Java
- Frontend: React, Vue.js, Angular, HTML5, CSS3, Tailwind CSS
- Backend: Node.js, Express.js, NestJS, Django, Spring Boot
- Databases: PostgreSQL, MongoDB, Redis, MySQL
- Cloud: AWS, Google Cloud Platform, Docker, Kubernetes
- Tools: Git, Jenkins, Jest, Cypress, Webpack

PROFESSIONAL EXPERIENCE

Senior Full-Stack Developer | Tech Solutions Inc. | 2021 - Present
- Led development of microservices architecture serving 100k+ users
- Implemented CI/CD pipelines reducing deployment time by 60%
- Mentored 5 junior developers and conducted code reviews
- Technologies: TypeScript, React, Node.js, AWS, PostgreSQL

Full-Stack Developer | StartupCorp | 2019 - 2021  
- Built responsive web applications using React and TypeScript
- Developed RESTful APIs handling 50k+ requests per day
- Collaborated with cross-functional teams in Agile environment
- Technologies: JavaScript, React, Express.js, MongoDB

EDUCATION
Bachelor of Science in Computer Science | University of Technology | 2019

CERTIFICATIONS
- AWS Certified Solutions Architect
- Google Cloud Professional Developer
`;
  }

  // Clean up old resume files (call this periodically)
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