import puppeteer, { Browser, Page } from 'puppeteer';
import { JobListing } from '../types';

export class LinkedInService {
  [x: string]: any;
  private browser: Browser | null = null;
  private page: Page | null = null;

  async initialize(): Promise<void> {
    try {
      this.browser = await puppeteer.launch({
        headless: true, // Set to false for debugging
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu'
        ]
      });
      
      this.page = await this.browser.newPage();
      
      // Set realistic user agent
      await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
      
      // Set viewport
      await this.page.setViewport({ width: 1366, height: 768 });
      
    } catch (error) {
      console.error('Failed to initialize LinkedIn service:', error);
      throw error;
    }
  }

  // NEW: Add the missing getCurrentPage method
  getCurrentPage(): Page | null {
    return this.page;
  }

  async loginWithToken(accessToken: string): Promise<boolean> {
    try {
      if (!this.page) await this.initialize();
      
      // Note: LinkedIn OAuth tokens don't work directly with web scraping
      // This is a placeholder - in production, you'd need to handle this differently
      // Consider using LinkedIn's official API where possible
      
      await this.page!.goto('https://www.linkedin.com/login');
      
      // For now, return true - implement actual token-based auth as needed
      return true;
      
    } catch (error) {
      console.error('LinkedIn login failed:', error);
      return false;
    }
  }

  async searchJobs(keywords: string[], location: string = '', limit: number = 10): Promise<JobListing[]> {
    try {
      if (!this.page) await this.initialize();
      
      const searchQuery = keywords.join(' OR ');
      const encodedQuery = encodeURIComponent(searchQuery);
      const encodedLocation = encodeURIComponent(location);
      
      // LinkedIn job search URL with date filter (24 hours)
      const searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodedQuery}&location=${encodedLocation}&f_TPR=r86400&f_JT=F&sortBy=DD`;
      
      console.log('Searching LinkedIn jobs:', searchUrl);
      
      await this.page!.goto(searchUrl, { waitUntil: 'networkidle2' });
      
      // Wait for job listings to load
      await this.page!.waitForSelector('.job-search-card', { timeout: 10000 });
      
      // Extract job listings
      const jobs = await this.page!.evaluate((limitCount) => {
        const jobCards = document.querySelectorAll('.job-search-card');
        const jobList: any[] = [];
        
        for (let i = 0; i < Math.min(jobCards.length, limitCount); i++) {
          const card = jobCards[i];
          
          const titleElement = card.querySelector('.base-search-card__title');
          const companyElement = card.querySelector('.base-search-card__subtitle');
          const locationElement = card.querySelector('.job-search-card__location');
          const linkElement = card.querySelector('.base-card__full-link');
          
          if (titleElement && companyElement && linkElement) {
            jobList.push({
              id: `job-${i}-${Date.now()}`,
              title: titleElement.textContent?.trim() || '',
              company: companyElement.textContent?.trim() || '',
              location: locationElement?.textContent?.trim() || '',
              url: linkElement.getAttribute('href') || '',
              description: '', // Will be fetched separately if needed
              postedDate: new Date()
            });
          }
        }
        
        return jobList;
      }, limit);
      
      console.log(`Found ${jobs.length} jobs on LinkedIn`);
      return jobs;
      
    } catch (error) {
      console.error('Error searching LinkedIn jobs:', error);
      return [];
    }
  }

  async getJobDescription(jobUrl: string): Promise<string> {
    try {
      if (!this.page) await this.initialize();
      
      await this.page!.goto(jobUrl, { waitUntil: 'networkidle2' });
      
      // Wait for job description to load
      await this.page!.waitForSelector('.show-more-less-html__markup', { timeout: 5000 });
      
      const description = await this.page!.evaluate(() => {
        const descElement = document.querySelector('.show-more-less-html__markup');
        return descElement?.textContent?.trim() || '';
      });
      
      return description;
      
    } catch (error) {
      console.error('Error fetching job description:', error);
      return '';
    }
  }

  async applyToJob(jobUrl: string): Promise<boolean> {
    try {
      if (!this.page) await this.initialize();
      
      await this.page!.goto(jobUrl, { waitUntil: 'networkidle2' });
      
      // Look for "Easy Apply" button
      const easyApplyButton = await this.page!.$('.jobs-apply-button--top-card button');
      
      if (easyApplyButton) {
        await easyApplyButton.click();
        
        // Wait for application modal
        await this.page!.waitForSelector('.jobs-easy-apply-modal', { timeout: 5000 });
        
        // This is where you'd handle the application flow
        // For now, we'll just return true to indicate the process started
        
        console.log('Easy Apply process initiated for:', jobUrl);
        return true;
      }
      
      return false;
      
    } catch (error) {
      console.error('Error applying to job:', error);
      return false;
    }
  }

  async cleanup(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }
}