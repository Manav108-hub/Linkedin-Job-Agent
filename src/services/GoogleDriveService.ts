// src/services/GoogleDriveService.ts - FIXED MIME Type Issue
import { google } from 'googleapis';
import { Readable } from 'stream';

export class GoogleDriveService {
  private drive;
  private auth;
  
  constructor(accessToken: string, refreshToken?: string) {
    // Validate required parameters
    if (!accessToken) {
      throw new Error('Google access token is required');
    }

    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      throw new Error('Google OAuth credentials not configured in environment');
    }

    this.auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/api/auth/google/callback'
    );
    
    this.auth.setCredentials({ 
      access_token: accessToken,
      refresh_token: refreshToken
    });
    
    this.drive = google.drive({ version: 'v3', auth: this.auth });
    
    console.log('GoogleDriveService initialized with token:', accessToken.substring(0, 10) + '...');
  }

  async saveResume(
    content: string, 
    fileName: string, 
    jobTitle: string, 
    company: string
  ): Promise<string | null> {
    try {
      console.log(`💾 Saving resume to Drive: ${fileName}`);
      
      // Get or create the main "Job Applications" folder
      const mainFolderId = await this.getOrCreateJobFolder();
      
      // Create company-specific subfolder
      const companyFolderId = await this.getOrCreateCompanyFolder(company, mainFolderId);
      
      // Format content for better readability
      const formattedContent = this.formatResumeContent(content);
      
      // FIXED: Create proper stream for content upload
      const contentStream = Readable.from([formattedContent]);
      
      // Create the file metadata
      const fileMetadata = {
        name: fileName,
        parents: [companyFolderId],
        description: `Resume for ${jobTitle} at ${company} - Generated on ${new Date().toLocaleDateString()}`
      };
      
      // FIXED: Use text/plain MIME type and proper stream upload
      const media = {
        mimeType: 'text/plain',
        body: contentStream
      };
      
      const file = await this.drive.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: 'id, name, webViewLink, webContentLink'
      });
      
      if (!file.data.id) {
        throw new Error('Failed to create file - no ID returned');
      }
      
      // Make file shareable (view access for anyone with link)
      await this.drive.permissions.create({
        fileId: file.data.id,
        requestBody: {
          role: 'reader',
          type: 'anyone'
        }
      });
      
      const fileLink = `https://drive.google.com/file/d/${file.data.id}/view`;
      console.log(`✅ Resume saved to Drive: ${fileLink}`);
      
      return fileLink;
      
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('❌ Failed to save resume to Drive:', errorMessage);
      
      // Try to refresh token if it's an auth error
      if (errorMessage.includes('401') || errorMessage.includes('invalid_grant') || errorMessage.includes('Invalid Credentials')) {
        console.log('🔄 Attempting to refresh Google token...');
        try {
          await this.refreshAccessToken();
          // Retry once with refreshed token
          return await this.saveResume(content, fileName, jobTitle, company);
        } catch (refreshError) {
          console.error('❌ Token refresh failed:', refreshError);
        }
      }
      
      return null;
    }
  }

  // Alternative method to save as Google Doc (if text/plain fails)
  async saveResumeAsGoogleDoc(
    content: string, 
    fileName: string, 
    jobTitle: string, 
    company: string
  ): Promise<string | null> {
    try {
      console.log(`📝 Saving resume as Google Doc: ${fileName}`);
      
      const mainFolderId = await this.getOrCreateJobFolder();
      const companyFolderId = await this.getOrCreateCompanyFolder(company, mainFolderId);
      
      const formattedContent = this.formatResumeContent(content);
      
      // Create as Google Doc
      const fileMetadata = {
        name: fileName,
        parents: [companyFolderId],
        mimeType: 'application/vnd.google-apps.document'
      };
      
      // Import as Google Doc
      const file = await this.drive.files.create({
        requestBody: fileMetadata,
        media: {
          mimeType: 'text/plain',
          body: formattedContent
        },
        fields: 'id, name, webViewLink'
      });
      
      if (!file.data.id) {
        throw new Error('Failed to create Google Doc');
      }
      
      // Make shareable
      await this.drive.permissions.create({
        fileId: file.data.id,
        requestBody: {
          role: 'reader',
          type: 'anyone'
        }
      });
      
      const docLink = `https://docs.google.com/document/d/${file.data.id}/edit`;
      console.log(`✅ Resume saved as Google Doc: ${docLink}`);
      
      return docLink;
      
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('❌ Failed to save as Google Doc:', errorMessage);
      return null;
    }
  }

  // Format resume content for better readability
  private formatResumeContent(content: string): string {
    return content
      .replace(/\*\s/g, '• ') // Replace asterisks with bullet points
      .replace(/\*\*/g, '') // Remove markdown bold markers
      .replace(/\n{3,}/g, '\n\n') // Normalize excessive line breaks
      .replace(/^\s+/gm, '') // Remove leading spaces
      .trim();
  }

  private async getOrCreateJobFolder(): Promise<string> {
    try {
      // Check if "Job Applications" folder exists
      const response = await this.drive.files.list({
        q: "name='Job Applications' and mimeType='application/vnd.google-apps.folder' and trashed=false",
        fields: 'files(id, name)',
        spaces: 'drive'
      });

      if (response.data.files && response.data.files.length > 0) {
        console.log('📁 Found existing Job Applications folder');
        return response.data.files[0].id!;
      }

      // Create folder if it doesn't exist
      console.log('📁 Creating Job Applications folder');
      const folderMetadata = {
        name: 'Job Applications',
        mimeType: 'application/vnd.google-apps.folder',
        description: 'Automated job application resumes and documents'
      };

      const folder = await this.drive.files.create({
        requestBody: folderMetadata,
        fields: 'id'
      });

      if (!folder.data.id) {
        throw new Error('Failed to create main folder');
      }

      console.log('✅ Job Applications folder created');
      return folder.data.id;
      
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('❌ Failed to create/find main Drive folder:', errorMessage);
      throw error;
    }
  }

  private async getOrCreateCompanyFolder(companyName: string, parentFolderId: string): Promise<string> {
    try {
      // Sanitize company name for folder name
      const sanitizedName = companyName.replace(/[^a-zA-Z0-9\s-_]/g, '').trim();
      
      // Check if company folder exists
      const response = await this.drive.files.list({
        q: `name='${sanitizedName}' and mimeType='application/vnd.google-apps.folder' and '${parentFolderId}' in parents and trashed=false`,
        fields: 'files(id, name)',
        spaces: 'drive'
      });

      if (response.data.files && response.data.files.length > 0) {
        return response.data.files[0].id!;
      }

      // Create company folder
      console.log(`📁 Creating folder for company: ${sanitizedName}`);
      const folderMetadata = {
        name: sanitizedName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentFolderId],
        description: `Job applications for ${companyName}`
      };

      const folder = await this.drive.files.create({
        requestBody: folderMetadata,
        fields: 'id'
      });

      if (!folder.data.id) {
        throw new Error('Failed to create company folder');
      }

      return folder.data.id;
      
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`❌ Failed to create company folder for ${companyName}:`, errorMessage);
      // Fallback to main folder
      return parentFolderId;
    }
  }

  private async refreshAccessToken(): Promise<void> {
    try {
      const { credentials } = await this.auth.refreshAccessToken();
      this.auth.setCredentials(credentials);
      console.log('✅ Google access token refreshed');
    } catch (error) {
      console.error('❌ Failed to refresh access token:', error);
      throw error;
    }
  }

  // Get folder contents for verification
  async getFolderContents(folderId?: string): Promise<any[]> {
    try {
      const response = await this.drive.files.list({
        q: folderId ? `'${folderId}' in parents` : undefined,
        fields: 'files(id, name, mimeType, createdTime, size)',
        orderBy: 'createdTime desc'
      });

      return response.data.files || [];
    } catch (error) {
      console.error('Error getting folder contents:', error);
      return [];
    }
  }

  // Test Drive connection
  async testConnection(): Promise<{ success: boolean; message: string; details?: any }> {
    try {
      console.log('🧪 Testing Google Drive connection...');
      
      const response = await this.drive.about.get({ 
        fields: 'user(displayName, emailAddress), storageQuota(limit, usage)' 
      });
      
      const user = response.data.user;
      const quota = response.data.storageQuota;
      
      console.log('✅ Google Drive connection successful');
      console.log('User:', user?.displayName, user?.emailAddress);
      
      return {
        success: true,
        message: `Connected as ${user?.displayName || 'Unknown'} (${user?.emailAddress || 'No email'})`,
        details: {
          user: user,
          quota: quota
        }
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('❌ Google Drive connection failed:', errorMessage);
      
      return {
        success: false,
        message: `Connection failed: ${errorMessage}`,
        details: { error: errorMessage }
      };
    }
  }

  // Generate file name for resume
  static generateResumeFileName(jobTitle: string, company: string, customized: boolean = false): string {
    const sanitize = (str: string) => str.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '_');
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const type = customized ? 'AI_Customized' : 'Original';
    
    return `Resume_${sanitize(company)}_${sanitize(jobTitle)}_${type}_${date}.txt`;
  }
}