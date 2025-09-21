// src/services/GoogleDriveService.ts - Google Drive integration
import { google } from 'googleapis';

export class GoogleDriveService {
  private drive;
  private auth;
  
  constructor(accessToken: string, refreshToken?: string) {
    this.auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    
    this.auth.setCredentials({ 
      access_token: accessToken,
      refresh_token: refreshToken
    });
    
    this.drive = google.drive({ version: 'v3', auth: this.auth });
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
      
      // Create the file
      const fileMetadata = {
        name: fileName,
        parents: [companyFolderId],
        description: `Resume for ${jobTitle} at ${company} - Generated on ${new Date().toLocaleDateString()}`
      };
      
      const media = {
        mimeType: 'application/pdf', // We'll convert to PDF for better compatibility
        body: this.convertToPDF ? await this.convertToPDF(content) : content
      };
      
      // For now, save as plain text (you can implement PDF conversion later)
      const textMedia = {
        mimeType: 'text/plain',
        body: content
      };
      
      const file = await this.drive.files.create({
        requestBody: fileMetadata,
        media: textMedia,
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
      if (errorMessage.includes('401') || errorMessage.includes('invalid_grant')) {
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
  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const response = await this.drive.about.get({ fields: 'user, storageQuota' });
      
      return {
        success: true,
        message: `Connected as ${response.data.user?.displayName || 'Unknown'}`
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Connection failed: ${errorMessage}`
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