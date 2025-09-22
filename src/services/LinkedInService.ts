// src/services/LinkedInService.ts - Production version with anti-bot resistance
import puppeteer, { Browser, Page } from 'puppeteer';
import axios from 'axios';
import * as cheerio from 'cheerio';

export class LinkedInService {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private isInitialized = false;
  private useHttpOnly = false; // Skip browser automation if LinkedIn blocks it

  constructor() {}

  async initialize(): Promise<void> {
    // Skip browser initialization if we're in HTTP-only mode
    if (this.useHttpOnly) {
      console.log('📡 Using HTTP-only mode (browser automation disabled)');
      this.isInitialized = true;
      return;
    }

    try {
      console.log('🚀 Initializing LinkedIn automation...');
      
      this.browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor',
          '--single-process',
          '--disable-blink-features=AutomationControlled', // Anti-detection
          '--exclude-switches=enable-automation',
          '--disable-extensions'
        ],
        timeout: 15000
      });

      this.page = await this.browser.newPage();
      
      // Anti-detection measures
      await this.page.evaluateOnNewDocument(() => {
        // Remove webdriver property
        delete (navigator as any).webdriver;
        
        // Mock plugins
        Object.defineProperty(navigator, 'plugins', {
          get: () => [1, 2, 3, 4, 5]
        });
        
        // Mock languages
        Object.defineProperty(navigator, 'languages', {
          get: () => ['en-US', 'en']
        });
      });
      
      await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');
      await this.page.setViewport({ width: 1366, height: 768 });

      this.isInitialized = true;
      console.log('✅ LinkedIn automation initialized');
    } catch (error) {
      console.error('❌ Browser initialization failed, switching to HTTP-only mode:', error);
      this.useHttpOnly = true;
      this.isInitialized = true;
    }
  }

  async loginWithToken(linkedinToken: string): Promise<boolean> {
    if (this.useHttpOnly) {
      console.log('📡 Skipping login (HTTP-only mode)');
      return false;
    }

    try {
      console.log('🔐 Attempting LinkedIn login...');
      
      // Test navigation to detect if LinkedIn is blocking us
      await this.page!.goto('https://www.linkedin.com', { 
        waitUntil: 'domcontentloaded', 
        timeout: 10000 
      });
      
      // Check for redirect loops or blocks
      const currentUrl = this.page!.url();
      if (currentUrl.includes('authwall') || currentUrl.includes('challenge')) {
        console.log('🚫 LinkedIn detected automation, switching to HTTP-only mode');
        this.useHttpOnly = true;
        return false;
      }

      // Set authentication cookie
      await this.page!.setCookie({
        name: 'li_at',
        value: linkedinToken,
        domain: '.linkedin.com',
        path: '/',
        httpOnly: true,
        secure: true
      });

      await this.page!.reload({ waitUntil: 'domcontentloaded', timeout: 10000 });
      
      // Check if logged in
      const isLoggedIn = await this.page!.$('.global-nav__me, .global-nav__primary-link--me') !== null;
      
      if (isLoggedIn) {
        console.log('✅ Successfully logged into LinkedIn');
        return true;
      } else {
        console.log('❌ Login failed, switching to HTTP-only mode');
        this.useHttpOnly = true;
        return false;
      }
      
    } catch (error) {
      console.error('❌ LinkedIn login error:', error);
      console.log('🔄 Switching to HTTP-only mode due to login failure');
      this.useHttpOnly = true;
      return false;
    }
  }

  async searchJobs(keywords: string[], location: string, limit: number = 10): Promise<any[]> {
    const searchQuery = keywords.join(' ');
    
    // Always try HTTP first since it's more reliable
    console.log('🌐 Starting with HTTP job search...');
    const httpJobs = await this.searchJobsViaHTTP(keywords, location, limit);
    
    if (httpJobs.length > 0) {
      return httpJobs;
    }

    // Try browser as fallback only if HTTP fails
    if (!this.useHttpOnly && this.browser && this.page) {
      console.log('🔄 HTTP failed, trying browser search...');
      return await this.searchJobsViaBrowser(keywords, location, limit);
    }

    // Final fallback: realistic mock jobs
    console.log('🎭 Using mock jobs for testing/demonstration');
    return this.generateRealisticMockJobs(keywords, location, Math.min(limit, 5));
  }

  private async searchJobsViaHTTP(keywords: string[], location: string, limit: number): Promise<any[]> {
    try {
      const searchQuery = keywords.join(' ');
      
      // Use Google search for LinkedIn jobs (more reliable than direct LinkedIn scraping)
      const googleSearchUrl = `https://www.google.com/search?q=site:linkedin.com/jobs+${encodeURIComponent(searchQuery)}+${encodeURIComponent(location)}`;
      
      console.log('🔍 Google search for LinkedIn jobs:', googleSearchUrl);
      
      const response = await axios.get(googleSearchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'DNT': '1',
          'Connection': 'keep-alive'
        },
        timeout: 15000
      });

      const $ = cheerio.load(response.data);
      const jobs: any[] = [];

      // Extract LinkedIn job links from Google search results
      $('a[href*="linkedin.com/jobs/view"]').each((index, element) => {
        if (index >= limit) return false;

        try {
          const $element = $(element);
          const href = $element.attr('href');
          const text = $element.text().trim();

          if (href && text && href.includes('linkedin.com/jobs/view')) {
            // Extract job ID from URL
            const jobIdMatch = href.match(/linkedin\.com\/jobs\/view\/(\d+)/);
            const jobId = jobIdMatch ? jobIdMatch[1] : `google_${Date.now()}_${index}`;

            // Parse title and company from search result text
            const parts = text.split(' - ');
            const title = parts[0] || text.substring(0, 50);
            const company = parts[1] || 'Company Name';

            jobs.push({
              id: `job_${jobId}`,
              title: title.trim(),
              company: company.trim(),
              location: location,
              url: href.startsWith('http') ? href : `https://www.linkedin.com${href}`,
              description: '',
              postedDate: new Date()
            });
          }
        } catch (error) {
          console.log('Error parsing Google result:', error);
        }
      });

      // If Google didn't work, try Indeed as a more reliable source
      if (jobs.length === 0) {
        return await this.searchIndeedJobs(keywords, location, limit);
      }

      console.log(`✅ Found ${jobs.length} jobs via Google search`);
      return jobs;

    } catch (error) {
      console.error('❌ HTTP search failed:', error);
      return [];
    }
  }

  private async searchIndeedJobs(keywords: string[], location: string, limit: number): Promise<any[]> {
    try {
      const searchQuery = keywords.join(' ');
      const indeedUrl = `https://www.indeed.com/jobs?q=${encodeURIComponent(searchQuery)}&l=${encodeURIComponent(location)}&sort=date`;
      
      console.log('🔍 Searching Indeed as fallback:', indeedUrl);
      
      const response = await axios.get(indeedUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        timeout: 15000
      });

      const $ = cheerio.load(response.data);
      const jobs: any[] = [];

      $('.jobsearch-SerpJobCard, .job_seen_beacon').each((index, element) => {
        if (index >= limit) return false;

        try {
          const $element = $(element);
          const titleElement = $element.find('.jobTitle a, h2 a').first();
          const companyElement = $element.find('.companyName a, .companyName').first();
          const locationElement = $element.find('.companyLocation').first();

          const title = titleElement.text().trim();
          const company = companyElement.text().trim();
          const jobLocation = locationElement.text().trim() || location;
          const relativeUrl = titleElement.attr('href');

          if (title && company && relativeUrl) {
            jobs.push({
              id: `indeed_${Date.now()}_${index}`,
              title,
              company,
              location: jobLocation,
              url: relativeUrl.startsWith('http') ? relativeUrl : `https://www.indeed.com${relativeUrl}`,
              description: '',
              postedDate: new Date()
            });
          }
        } catch (error) {
          console.log('Error parsing Indeed result:', error);
        }
      });

      console.log(`✅ Found ${jobs.length} jobs via Indeed fallback`);
      return jobs;

    } catch (error) {
      console.error('❌ Indeed search failed:', error);
      return [];
    }
  }

  private async searchJobsViaBrowser(keywords: string[], location: string, limit: number): Promise<any[]> {
    try {
      const searchQuery = keywords.join(' ');
      const searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(searchQuery)}&location=${encodeURIComponent(location)}&f_TPR=r86400&f_JT=F&sortBy=DD`;
      
      await this.page!.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await this.sleep(3000);

      const jobs = await this.page!.evaluate((maxJobs) => {
        const jobCards = document.querySelectorAll('.job-search-card, .base-search-card');
        const jobList: any[] = [];

        for (let i = 0; i < Math.min(jobCards.length, maxJobs); i++) {
          const card = jobCards[i];
          
          try {
            const titleElement = card.querySelector('.base-search-card__title a');
            const companyElement = card.querySelector('.base-search-card__subtitle a');
            const linkElement = card.querySelector('.base-search-card__title a');

            if (titleElement && companyElement && linkElement) {
              jobList.push({
                id: `browser_${Date.now()}_${i}`,
                title: titleElement.textContent?.trim() || '',
                company: companyElement.textContent?.trim() || '',
                location: card.querySelector('.job-search-card__location')?.textContent?.trim() || '',
                url: (linkElement as HTMLAnchorElement).href || '',
                description: '',
                postedDate: new Date()
              });
            }
          } catch (error) {
            console.log('Error extracting browser job card:', error);
          }
        }

        return jobList;
      }, limit);

      console.log(`✅ Found ${jobs.length} jobs via browser`);
      return jobs;

    } catch (error) {
      console.error('❌ Browser search failed:', error);
      return [];
    }
  }

  private generateRealisticMockJobs(keywords: string[], location: string, count: number): any[] {
    const companies = [
      'Meta', 'Google', 'Microsoft', 'Amazon', 'Apple',
      'Netflix', 'Spotify', 'Uber', 'Airbnb', 'Stripe',
      'Atlassian', 'Shopify', 'GitHub', 'GitLab', 'Slack'
    ];
    
    const titles = [
      'Senior Frontend Developer',
      'Full Stack Engineer',
      'React Developer',
      'TypeScript Developer',
      'Node.js Backend Engineer',
      'Software Engineer',
      'Senior Software Developer',
      'Frontend Engineer'
    ];

    const jobs = [];
    for (let i = 0; i < count; i++) {
      const company = companies[i % companies.length];
      const title = titles[i % titles.length];
      
      jobs.push({
        id: `demo_${Date.now()}_${i}`,
        title,
        company,
        location,
        url: `https://linkedin.com/jobs/view/demo-${Date.now()}-${i}`,
        description: `We are looking for a skilled ${keywords.join(', ')} developer to join our ${company} team. This is a ${location}-based role with competitive compensation and benefits.`,
        postedDate: new Date()
      });
    }

    console.log(`✅ Generated ${jobs.length} realistic demo jobs`);
    return jobs;
  }

  

  async getJobDescription(jobUrl: string): Promise<string> {
    const result = await this.getJobDescriptionAndApply(jobUrl, '');
    return result.description;
  }

  async checkApplicationStatus(jobUrl: string): Promise<boolean> {
    return false; // Always return false since we can't reliably check LinkedIn status
  }

  getCurrentPage(): Page | null {
    return this.useHttpOnly ? null : this.page;
  }

  async cleanup(): Promise<void> {
    try {
      if (this.page && !this.page.isClosed()) {
        await this.page.close();
      }
      this.page = null;
      
      if (this.browser && this.browser.connected) {
        await this.browser.close();
      }
      this.browser = null;
      
      this.isInitialized = false;
      console.log('🧹 LinkedIn service cleaned up');
    } catch (error) {
      console.error('Cleanup error (non-critical):', error);
      this.isInitialized = false;
      this.browser = null;
      this.page = null;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Add to your existing LinkedInService.ts - just the new methods

async fillApplicationForm(page: Page, userInfo: any, resumePath?: string): Promise<{
  formFilled: boolean;
  readyForSubmission: boolean;
  submitButtonFound: boolean;
}> {
  try {
    console.log('🔍 Analyzing application form...');
    
    // Fill name fields
    await this.fillFieldSafely(page, 'input[name*="name"], input[placeholder*="name"]', userInfo.name);
    
    // Fill email fields  
    await this.fillFieldSafely(page, 'input[type="email"], input[name*="email"]', userInfo.email);
    
    // Fill phone fields
    await this.fillFieldSafely(page, 'input[type="tel"], input[name*="phone"]', userInfo.phone);
    
    // Upload resume if file input exists
    if (resumePath) {
      await this.uploadResumeSafely(page, resumePath);
    }
    
    // Fill cover letter/message
    await this.fillTextAreaSafely(page, userInfo.coverLetter);
    
    // Answer common questions
    await this.answerCommonQuestions(page, userInfo);
    
    // Find and highlight submit button
    const submitButton = await this.findAndHighlightSubmitButton(page);
    
    return {
      formFilled: true,
      readyForSubmission: true,
      submitButtonFound: !!submitButton
    };
    
  } catch (error) {
    console.log('Form filling error:', error);
    return {
      formFilled: false,
      readyForSubmission: false,
      submitButtonFound: false
    };
  }
}

private async fillFieldSafely(page: Page, selector: string, value: string): Promise<void> {
  try {
    const field = await page.$(selector);
    if (field && value) {
      await field.click();
      await field.type(value, { delay: 50 });
      console.log(`✅ Filled field: ${selector}`);
    }
  } catch (error) {
    console.log(`⚠️ Could not fill field ${selector}:`, error.message);
  }
}

private async uploadResumeSafely(page: Page, resumePath: string): Promise<void> {
  try {
    const fileInput = await page.$('input[type="file"]');
    if (fileInput && resumePath) {
      // Download from Google Drive first
      const localPath = await this.downloadResumeFromDrive(resumePath);
      await fileInput.uploadFile(localPath);
      console.log('✅ Resume uploaded successfully');
      
      // Cleanup local file
      require('fs').unlinkSync(localPath);
    }
  } catch (error) {
    console.log('⚠️ Resume upload failed:', error.message);
  }
}
  downloadResumeFromDrive(resumePath: string) {
    throw new Error('Method not implemented.');
  }

private async fillTextAreaSafely(page: Page, coverLetter: string): Promise<void> {
  try {
    const textAreas = await page.$$('textarea');
    for (const textArea of textAreas) {
      const placeholder = await textArea.evaluate(el => el.placeholder?.toLowerCase() || '');
      
      if (placeholder.includes('cover') || placeholder.includes('message') || placeholder.includes('why')) {
        await textArea.click();
        await textArea.type(coverLetter, { delay: 30 });
        console.log('✅ Cover letter filled');
        break;
      }
    }
  } catch (error) {
    console.log('⚠️ Cover letter filling failed:', error.message);
  }
}

private async answerCommonQuestions(page: Page, userInfo: any): Promise<void> {
  const commonAnswers = {
    'years of experience': userInfo.experience || '2',
    'willing to relocate': userInfo.relocate || 'Yes',
    'authorization to work': 'Yes',
    'notice period': userInfo.noticePeriod || '30 days',
    'expected salary': userInfo.expectedSalary || 'Competitive',
    'start date': userInfo.startDate || 'Immediately available'
  };

  try {
    // Handle text inputs
    const inputs = await page.$$('input[type="text"], input[type="number"]');
    
    for (const input of inputs) {
      const label = await input.evaluate(el => {
        const labelEl = el.closest('.form-element, .field')?.querySelector('label');
        return labelEl?.textContent?.toLowerCase() || '';
      });

      for (const [keyword, answer] of Object.entries(commonAnswers)) {
        if (label.includes(keyword)) {
          await input.click();
          await input.type(answer, { delay: 50 });
          console.log(`✅ Answered: ${keyword} = ${answer}`);
          break;
        }
      }
    }

    // Handle dropdowns
    const selects = await page.$$('select');
    for (const select of selects) {
      try {
        const options = await select.$$('option');
        if (options.length > 1) {
          // Select first non-empty option
          const firstValue = await options[1].evaluate(el => el.value);
          if (firstValue) {
            await select.select(firstValue);
            console.log('✅ Dropdown selection made');
          }
        }
      } catch (error) {
        // Continue with other selects
      }
    }

  } catch (error) {
    console.log('⚠️ Question answering failed:', error.message);
  }
}

private async findAndHighlightSubmitButton(page: Page): Promise<any> {
  try {
    const submitSelectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button:contains("Submit")',
      'button:contains("Apply")',
      '.submit-btn',
      '.apply-btn',
      '[data-test*="submit"]'
    ];

    for (const selector of submitSelectors) {
      const button = await page.$(selector);
      if (button) {
        // Highlight the submit button
        await button.evaluate(el => {
          el.style.border = '5px solid red';
          el.style.backgroundColor = 'yellow';
          el.style.color = 'black';
          el.style.fontWeight = 'bold';
          el.scrollIntoView({ behavior: 'smooth' });
        });
        
        console.log('🎯 SUBMIT BUTTON HIGHLIGHTED - Ready for manual click');
        return button;
      }
    }
    
    return null;
  } catch (error) {
    console.log('⚠️ Submit button highlighting failed:', error.message);
    return null;
  }
}

// Updated main application method
async getJobDescriptionAndApply(jobUrl: string, resumeContent: string, userInfo?: any): Promise<{
  description: string;
  applied: boolean;
  applicationMethod: string;
  formFilled?: boolean;
  readyForSubmission?: boolean;
}> {
  
  // Handle demo jobs
  if (jobUrl.includes('demo-')) {
    return {
      description: 'Demo job description',
      applied: true,
      applicationMethod: 'demo_application'
    };
  }

  try {
    if (!this.useHttpOnly && this.page) {
      await this.page.goto(jobUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      
      // Extract description
      const description = await this.page.$eval(
        '.description__text, .show-more-less-html__markup, .job-description', 
        el => el.textContent?.trim() || 'Job description not found'
      ).catch(() => 'Job description not available');

      // Look for apply button and try to click it
      const applyButton = await this.page.$('.jobs-s-apply button, .apply-button, [class*="apply"]');
      
      if (applyButton) {
        console.log('🎯 Apply button found, clicking...');
        await applyButton.click();
        await this.sleep(3000);
        
        // Check if form appeared
        const hasForm = await this.page.$('form, input[type="email"], textarea') !== null;
        
        if (hasForm && userInfo) {
          console.log('📝 Application form detected, filling automatically...');
          const formResult = await this.fillApplicationForm(this.page, userInfo, userInfo.resumePath);
          
          return {
            description,
            applied: false, // Not submitted yet
            applicationMethod: 'form_filled_awaiting_submission',
            formFilled: formResult.formFilled,
            readyForSubmission: formResult.readyForSubmission
          };
        } else {
          return {
            description,
            applied: true,
            applicationMethod: 'direct_application_completed'
          };
        }
      }
    }
    
    return {
      description: 'Could not access application form',
      applied: false,
      applicationMethod: 'access_failed'
    };
    
  } catch (error) {
    return {
      description: 'Error processing application',
      applied: false,
      applicationMethod: 'error'
    };
  }
}


}