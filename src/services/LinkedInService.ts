// src/services/LinkedInService.ts - Complete Fixed Version
import puppeteer, { Browser, Page } from 'puppeteer';

export class LinkedInService {
  private browser?: Browser;
  private page?: Page;
  
  async initialize() {
    try {
      this.browser = await puppeteer.launch({
        headless: true,
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
      await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    } catch (error) {
      console.error('Failed to initialize LinkedInService:', error);
      throw error;
    }
  }

  async searchJobs(keywords: string[], location: string, limit: number = 25) {
    if (!this.page || !this.browser) {
      throw new Error('LinkedInService not initialized');
    }

    try {
      const jobs: any[] = [];
      const searchQuery = keywords.join(' ');
      const searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(searchQuery)}&location=${encodeURIComponent(location)}&f_TPR=r86400`;

      console.log('Navigating to LinkedIn jobs:', searchUrl);
      await this.page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });

      // Wait for job listings to load
      await this.page.waitForSelector('.jobs-search__results-list', { timeout: 10000 });

      // Scroll to load more jobs
      await this.autoScroll();

      // Extract job listings - FIXED: Proper array handling
      const jobElements = await this.page.$$('.jobs-search__results-list .result-card');
      
      for (let i = 0; i < Math.min(jobElements.length, limit); i++) {
        try {
          const jobElement = jobElements[i];
          
          const jobData = await this.page.evaluate((element) => {
            const titleEl = element.querySelector('.result-card__title');
            const companyEl = element.querySelector('.result-card__subtitle');
            const locationEl = element.querySelector('.job-result-card__location');
            const linkEl = element.querySelector('a[href*="/jobs/view/"]');
            const timeEl = element.querySelector('.job-result-card__listdate');

            return {
              title: titleEl?.textContent?.trim() || '',
              company: companyEl?.textContent?.trim() || '',
              location: locationEl?.textContent?.trim() || location,
              url: linkEl?.getAttribute('href') || '',
              postedDate: timeEl?.textContent?.trim() || '',
              description: '',
              requirements: [],
              benefits: []
            };
          }, jobElement);

          if (jobData.title && jobData.company) {
            jobs.push({
              ...jobData,
              id: `linkedin-${i}-${Date.now()}`,
              source: 'LinkedIn'
            });
          }
        } catch (jobError) {
          console.error(`Error extracting job ${i}:`, jobError);
          continue;
        }
      }

      console.log(`Extracted ${jobs.length} jobs from LinkedIn`);
      return jobs;

    } catch (error) {
      console.error('Error searching LinkedIn jobs:', error);
      return [];
    }
  }

  private async autoScroll() {
    if (!this.page) return;

    try {
      await this.page.evaluate(async () => {
        await new Promise<void>((resolve) => {
          let totalHeight = 0;
          const distance = 100;
          const timer = setInterval(() => {
            const scrollHeight = document.body.scrollHeight;
            window.scrollBy(0, distance);
            totalHeight += distance;

            if (totalHeight >= scrollHeight) {
              clearInterval(timer);
              resolve();
            }
          }, 100);
        });
      });
    } catch (error) {
      console.error('Auto scroll error:', error);
    }
  }

  async applyToJob(jobUrl: string, userSession: any): Promise<{
    success: boolean;
    method: string;
    details: string;
  }> {
    if (!this.page || !this.browser) {
      throw new Error('LinkedInService not initialized');
    }

    try {
      console.log('Navigating to job:', jobUrl);
      await this.page.goto(jobUrl, { waitUntil: 'networkidle2', timeout: 30000 });

      // Look for Easy Apply button
      const easyApplyButton = await this.page.$('.jobs-apply-button--top-card');
      
      if (easyApplyButton) {
        return await this.handleEasyApply();
      }

      // Look for external apply button
      const externalButton = await this.page.$('a[href*="apply"]');
      if (externalButton) {
        const href = await externalButton.getProperty('href');
        const url = await href.jsonValue();
        return {
          success: false,
          method: 'external_redirect',
          details: `External application required: ${url}`
        };
      }

      return {
        success: false,
        method: 'no_apply_button',
        details: 'No apply button found on job page'
      };

    } catch (error) {
      console.error('Error applying to job:', error);
      return {
        success: false,
        method: 'error',
        details: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async handleEasyApply(): Promise<{
    success: boolean;
    method: string;
    details: string;
  }> {
    if (!this.page) {
      throw new Error('Page not available');
    }

    try {
      // Click Easy Apply button
      await this.page.click('.jobs-apply-button--top-card');
      await this.page.waitForTimeout(2000);

      // Check if application form appears
      const modal = await this.page.$('.jobs-easy-apply-modal');
      
      if (modal) {
        // Look for submit button
        const submitButton = await this.page.$('button[aria-label*="Submit"]');
        
        if (submitButton) {
          // Don't actually submit in automated mode
          return {
            success: false,
            method: 'easy_apply_form',
            details: 'Easy Apply form ready - manual submission required'
          };
        } else {
          return {
            success: false,
            method: 'easy_apply_complex',
            details: 'Easy Apply requires additional information'
          };
        }
      }

      return {
        success: false,
        method: 'easy_apply_failed',
        details: 'Easy Apply modal did not appear'
      };

    } catch (error) {
      return {
        success: false,
        method: 'easy_apply_error',
        details: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async isConnected(): Promise<boolean> {
    // FIXED: Use isConnected() instead of connected property
    return this.browser?.isConnected() || false;
  }

  async close() {
    try {
      if (this.page) {
        await this.page.close();
        this.page = undefined;
      }
      if (this.browser) {
        await this.browser.close();
        this.browser = undefined;
      }
    } catch (error) {
      console.error('Error closing LinkedInService:', error);
    }
  }
}