// src/services/LinkedInService.ts - Complete Fixed Version
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

  // ========================================
  // ENHANCED JOB SEARCH WITH REAL APIs
  // ========================================

  async searchJobs(keywords: string[], location: string, limit: number = 10): Promise<any[]> {
    console.log('🔍 Searching jobs with enhanced API integration...');
    const allJobs: any[] = [];

    // Priority 1: Try Real Job APIs (Most Reliable)
    console.log('🌐 Step 1: Trying real job APIs...');
    
    // 1. JSearch API (RapidAPI) - 150 free requests/month
    const jsearchJobs = await this.searchJobsWithJSearch(keywords, location, 5);
    if (jsearchJobs.length > 0) {
      console.log(`✅ JSearch found ${jsearchJobs.length} jobs`);
      allJobs.push(...jsearchJobs);
    }

    // 2. Reed API for UK jobs - 100 free requests/month  
    if (location.toLowerCase().includes('uk') || location.toLowerCase().includes('england') || location.toLowerCase().includes('london')) {
      const reedJobs = await this.searchJobsWithReed(keywords, location, 3);
      if (reedJobs.length > 0) {
        console.log(`✅ Reed found ${reedJobs.length} UK jobs`);
        allJobs.push(...reedJobs);
      }
    }

    // 3. Remotive for remote jobs - Unlimited free
    const remotiveJobs = await this.searchJobsWithRemotive(keywords, 3);
    if (remotiveJobs.length > 0) {
      console.log(`✅ Remotive found ${remotiveJobs.length} remote jobs`);
      allJobs.push(...remotiveJobs);
    }

    // If we got good results from APIs, return them
    if (allJobs.length >= 3) {
      console.log(`🎉 Success! Found ${allJobs.length} REAL jobs from APIs`);
      return allJobs.slice(0, limit);
    }

    // Priority 2: Fallback to HTTP scraping if APIs didn't provide enough jobs
    console.log('🔄 Step 2: APIs provided limited results, trying HTTP scraping...');
    const httpJobs = await this.searchJobsViaHTTP(keywords, location, Math.max(limit - allJobs.length, 3));
    allJobs.push(...httpJobs);

    if (allJobs.length >= 2) {
      console.log(`✅ Combined APIs + HTTP: ${allJobs.length} jobs found`);
      return allJobs.slice(0, limit);
    }

    // Priority 3: Browser scraping as additional fallback
    if (!this.useHttpOnly && this.browser && this.page && allJobs.length < 2) {
      console.log('🔄 Step 3: Trying browser scraping for additional jobs...');
      const browserJobs = await this.searchJobsViaBrowser(keywords, location, 3);
      allJobs.push(...browserJobs);
    }

    if (allJobs.length > 0) {
      console.log(`✅ Total jobs found: ${allJobs.length}`);
      return allJobs.slice(0, limit);
    }

    // Final fallback: Demo jobs for testing
    console.log('📝 All methods failed, using demo jobs for testing');
    return this.generateRealisticMockJobs(keywords, location, Math.min(limit, 5));
  }

  // ========================================
  // REAL JOB API METHODS
  // ========================================

  private async searchJobsWithJSearch(keywords: string[], location: string, limit: number): Promise<any[]> {
    try {
      if (!process.env.RAPIDAPI_KEY) {
        console.log('⚠️ JSearch API key not configured, skipping...');
        return [];
      }

      console.log('🔍 JSearch API: Searching for', keywords.join(' '), 'in', location);

      const response = await axios.get('https://jsearch.p.rapidapi.com/search', {
        params: {
          query: `${keywords.join(' ')} ${location}`.trim(),
          page: '1',
          num_pages: '1',
          date_posted: 'all'
        },
        headers: {
          'X-RapidAPI-Key': process.env.RAPIDAPI_KEY,
          'X-RapidAPI-Host': 'jsearch.p.rapidapi.com'
        },
        timeout: 15000
      });

      if (!response.data?.data || !Array.isArray(response.data.data)) {
        console.log('JSearch API returned no valid data');
        return [];
      }

      const jobs = response.data.data.slice(0, limit).map((job: any) => ({
        id: `jsearch_${job.job_id || Date.now()}`,
        title: job.job_title || 'Title not available',
        company: job.employer_name || 'Company not available',
        location: job.job_city && job.job_country ? 
          `${job.job_city}, ${job.job_country}` : 
          job.job_country || location,
        url: job.job_apply_link || job.job_url || '',
        description: job.job_description || 'Description not available',
        salary: job.job_min_salary && job.job_max_salary ? 
          `$${job.job_min_salary} - $${job.job_max_salary}` : 
          job.job_salary || 'Salary not specified',
        jobType: job.job_employment_type || 'Full-time',
        postedDate: job.job_posted_at_datetime_utc ? 
          new Date(job.job_posted_at_datetime_utc) : 
          new Date(),
        source: 'JSearch',
        apiSource: true
      }));

      console.log(`✅ JSearch API returned ${jobs.length} jobs`);
      return jobs;

    } catch (error: any) {
      console.log('❌ JSearch API failed:', error.response?.data?.message || error.message);
      return [];
    }
  }

  private async searchJobsWithReed(keywords: string[], location: string, limit: number): Promise<any[]> {
    try {
      if (!process.env.REED_API_KEY) {
        console.log('⚠️ Reed API key not configured, skipping...');
        return [];
      }

      console.log('🔍 Reed API: Searching for', keywords.join(' '), 'in', location);

      const response = await axios.get('https://www.reed.co.uk/api/1.0/search', {
        params: {
          keywords: keywords.join(' '),
          locationName: location,
          resultsToTake: limit,
          resultsToSkip: 0
        },
        headers: {
          'Authorization': `Basic ${Buffer.from(process.env.REED_API_KEY + ':').toString('base64')}`
        },
        timeout: 15000
      });

      if (!response.data?.results || !Array.isArray(response.data.results)) {
        console.log('Reed API returned no valid results');
        return [];
      }

      const jobs = response.data.results.map((job: any) => ({
        id: `reed_${job.jobId || Date.now()}`,
        title: job.jobTitle || 'Title not available',
        company: job.employerName || 'Company not available',
        location: job.locationName || location,
        url: job.jobUrl || '',
        description: job.jobDescription || 'Description not available',
        salary: job.minimumSalary && job.maximumSalary ? 
          `£${job.minimumSalary} - £${job.maximumSalary}` :
          job.minimumSalary ? `£${job.minimumSalary}+` : 'Competitive',
        jobType: job.jobType || 'Full-time',
        contractType: job.contractType,
        postedDate: job.date ? new Date(job.date) : new Date(),
        source: 'Reed',
        apiSource: true,
        // Reed-specific data for detailed view
        reedJobId: job.jobId,
        applications: job.applications
      }));

      console.log(`✅ Reed API returned ${jobs.length} jobs`);
      return jobs;

    } catch (error: any) {
      console.log('❌ Reed API failed:', error.response?.data || error.message);
      return [];
    }
  }

  private async searchJobsWithRemotive(keywords: string[], limit: number): Promise<any[]> {
    try {
      console.log('🔍 Remotive API: Searching for remote', keywords.join(' '), 'jobs');

      const response = await axios.get('https://remotive.io/api/remote-jobs', {
        params: {
          limit: limit * 2, // Get more to filter better
          search: keywords.join(' ')
        },
        timeout: 15000
      });

      if (!response.data?.jobs || !Array.isArray(response.data.jobs)) {
        console.log('Remotive API returned no valid jobs');
        return [];
      }

      // Filter and map jobs
      const jobs = response.data.jobs
        .filter((job: any) => {
          // Basic filtering for relevant jobs
          const titleMatch = keywords.some(keyword => 
            job.title?.toLowerCase().includes(keyword.toLowerCase())
          );
          const descMatch = keywords.some(keyword => 
            job.description?.toLowerCase().includes(keyword.toLowerCase())
          );
          return titleMatch || descMatch;
        })
        .slice(0, limit)
        .map((job: any) => ({
          id: `remotive_${job.id || Date.now()}`,
          title: job.title || 'Title not available',
          company: job.company_name || 'Company not available',
          location: 'Remote',
          url: job.url || '',
          description: job.description || 'Description not available',
          salary: job.salary || 'Salary not specified',
          jobType: job.job_type || 'Full-time',
          category: job.category,
          postedDate: job.publication_date ? new Date(job.publication_date) : new Date(),
          source: 'Remotive',
          apiSource: true,
          tags: job.tags || []
        }));

      console.log(`✅ Remotive API returned ${jobs.length} remote jobs`);
      return jobs;

    } catch (error: any) {
      console.log('❌ Remotive API failed:', error.message);
      return [];
    }
  }

  // ========================================
  // ENHANCED JOB DETAILS METHODS
  // ========================================

  async getDetailedJobInfo(jobUrl: string): Promise<any | null> {
    // Check if this is a Reed job and get detailed info
    const reedJobIdMatch = jobUrl.match(/reed\.co\.uk.*\/jobs\/(\d+)/);
    if (reedJobIdMatch) {
      const jobId = reedJobIdMatch[1];
      console.log(`🔍 Fetching Reed job details for ID: ${jobId}`);
      return await this.getJobDetailsFromReed(jobId);
    }

    // For other job sources, try basic scraping
    try {
      if (!this.useHttpOnly && this.page) {
        await this.page.goto(jobUrl, { waitUntil: 'networkidle2', timeout: 15000 });
        
        const jobInfo = await this.page.evaluate(() => {
          const title = document.querySelector('h1, .job-title, .job-details-jobs-unified-top-card__job-title')?.textContent?.trim();
          const company = document.querySelector('.job-details-jobs-unified-top-card__company-name, .company-name')?.textContent?.trim();
          const location = document.querySelector('.job-details-jobs-unified-top-card__bullet, .job-location')?.textContent?.trim();
          const description = document.querySelector('.job-description, .description__text')?.textContent?.trim();
          
          return {
            title: title || 'Job Title Not Found',
            company: company || 'Company Not Found', 
            location: location || 'Location Not Found',
            description: description || 'Description Not Available',
            source: 'Scraped'
          };
        });
        
        return jobInfo;
      }
    } catch (error) {
      console.log('Error scraping job details:', error);
    }
    
    return null;
  }

  private async getJobDetailsFromReed(jobId: string): Promise<any | null> {
    try {
      if (!process.env.REED_API_KEY) {
        console.log('⚠️ Reed API key not configured for job details');
        return null;
      }

      const response = await axios.get(`https://www.reed.co.uk/api/1.0/jobs/${jobId}`, {
        headers: {
          'Authorization': `Basic ${Buffer.from(process.env.REED_API_KEY + ':').toString('base64')}`
        },
        timeout: 10000
      });

      const job = response.data;
      
      // Reed returns a blank object {} if job not found
      if (!job || Object.keys(job).length === 0 || !job.jobTitle) {
        console.log(`❌ No job found with Reed ID: ${jobId}`);
        return null;
      }

      console.log(`✅ Retrieved detailed Reed job: ${job.jobTitle} at ${job.employerName}`);

      return {
        id: `reed_${job.jobId}`,
        title: job.jobTitle,
        company: job.employerName,
        location: job.locationName,
        url: job.jobUrl,
        description: job.jobDescription,
        fullDescription: job.jobDescription,
        salary: job.minimumSalary && job.maximumSalary ? 
          `£${job.minimumSalary} - £${job.maximumSalary}` : 
          job.minimumSalary ? `£${job.minimumSalary}+` : 'Competitive',
        jobType: job.jobType || 'Full-time',
        contractType: job.contractType,
        postedDate: new Date(job.date),
        expiryDate: job.expiryDate ? new Date(job.expiryDate) : null,
        applications: job.applications,
        source: 'Reed',
        apiSource: true,
        // Additional Reed-specific fields
        employerId: job.employerId,
        employerProfileId: job.employerProfileId,
        employerProfileName: job.employerProfileName,
        currency: job.currency || 'GBP'
      };

    } catch (error: any) {
      if (error.response?.status === 404) {
        console.log(`❌ Reed job ID ${jobId} not found (404)`);
        return null;
      }
      console.log('❌ Reed job details API failed:', error.response?.data || error.message);
      return null;
    }
  }

  // ========================================
  // APPLICATION METHODS
  // ========================================

  async applyToJob(jobUrl: string, userSession: any): Promise<{
    success: boolean;
    method: string;
    details: string;
  }> {
    if (this.useHttpOnly || !this.page || !this.browser) {
      throw new Error('LinkedInService not initialized or in HTTP-only mode');
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
      await this.sleep(2000);

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
    return this.browser?.isConnected() || false;
  }

  // ========================================
  // HTTP & BROWSER SCRAPING FALLBACKS
  // ========================================

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
              id: `linkedin_scraped_${jobId}`,
              title: title.trim(),
              company: company.trim(),
              location: location,
              url: href.startsWith('http') ? href : `https://www.linkedin.com${href}`,
              description: '',
              postedDate: new Date(),
              source: 'LinkedIn (Google Search)',
              apiSource: false
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

      console.log(`✅ Found ${jobs.length} jobs via Google/HTTP search`);
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
              postedDate: new Date(),
              source: 'Indeed',
              apiSource: false
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
                id: `linkedin_browser_${Date.now()}_${i}`,
                title: titleElement.textContent?.trim() || '',
                company: companyElement.textContent?.trim() || '',
                location: card.querySelector('.job-search-card__location')?.textContent?.trim() || '',
                url: (linkElement as HTMLAnchorElement).href || '',
                description: '',
                postedDate: new Date(),
                source: 'LinkedIn (Browser)',
                apiSource: false
              });
            }
          } catch (error) {
            console.log('Error extracting browser job card:', error);
          }
        }

        return jobList;
      }, limit);

      console.log(`✅ Found ${jobs.length} jobs via browser scraping`);
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
        postedDate: new Date(),
        source: 'Demo',
        apiSource: false
      });
    }

    console.log(`✅ Generated ${jobs.length} realistic demo jobs`);
    return jobs;
  }

  // ========================================
  // ENHANCED APPLICATION METHODS  
  // ========================================

  async getJobDescriptionAndApply(jobUrl: string, resumeContent: string, userInfo?: any): Promise<{
    description: string;
    applied: boolean;
    applicationMethod: string;
    formFilled?: boolean;
    readyForSubmission?: boolean;
    jobDetails?: any;
  }> {
    
    // Handle demo jobs
    if (jobUrl.includes('demo-')) {
      return {
        description: 'Demo job description for testing purposes',
        applied: true,
        applicationMethod: 'demo_application'
      };
    }

    // Check if this is a Reed job URL and get detailed info
    const reedJobIdMatch = jobUrl.match(/reed\.co\.uk.*\/jobs\/(\d+)/);
    if (reedJobIdMatch) {
      const jobId = reedJobIdMatch[1];
      console.log(`🔍 Detected Reed job, fetching details for ID: ${jobId}`);
      
      const jobDetails = await this.getJobDetailsFromReed(jobId);
      if (jobDetails) {
        console.log(`✅ Retrieved Reed job details: ${jobDetails.title} at ${jobDetails.company}`);
        
        return {
          description: jobDetails.fullDescription || jobDetails.description,
          applied: false, // Reed jobs require external application
          applicationMethod: 'external_reed_application',
          jobDetails: jobDetails
        };
      } else {
        console.log(`❌ Could not fetch Reed job details for ID: ${jobId}`);
      }
    }

    // Handle other job sources with existing logic
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

  private async autoScroll() {
    if (!this.page || this.useHttpOnly) return;

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

  async close() {
    try {
      if (this.page && !this.page.isClosed()) {
        await this.page.close();
        this.page = null;
      }
      if (this.browser && this.browser.isConnected()) {
        await this.browser.close();
        this.browser = null;
      }
      this.isInitialized = false;
      console.log('✅ LinkedInService closed successfully');
    } catch (error) {
      console.error('Error closing LinkedInService:', error);
      this.isInitialized = false;
      this.browser = null;
      this.page = null;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ========================================
  // APPLICATION FORM FILLING METHODS
  // ========================================

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
      console.log(`⚠️ Could not fill field ${selector}:`, error);
    }
  }

  private async uploadResumeSafely(page: Page, resumePath: string): Promise<void> {
    try {
      const fileInput = await page.$('input[type="file"]');
      if (fileInput && resumePath) {
        // For now, skip file upload as we need Google Drive integration
        // This will be implemented when Google Drive service is available
        console.log('⚠️ Resume upload skipped - Google Drive integration needed');
      }
    } catch (error) {
      console.log('⚠️ Resume upload failed:', error);
    }
  }

  private async fillTextAreaSafely(page: Page, coverLetter: string): Promise<void> {
  try {
    // Use $$eval to get all textareas as an array
    await page.$$eval('textarea', (textAreas: HTMLTextAreaElement[]) => {
      textAreas.forEach((textArea, index) => {
        const placeholder = textArea.placeholder?.toLowerCase() || '';
        
        if (placeholder.includes('cover') || placeholder.includes('message') || placeholder.includes('why')) {
          textArea.value = coverLetter;
          console.log(`✅ Cover letter filled in textarea ${index + 1}`);
        }
      });
    });
  } catch (error) {
    console.log('⚠️ Cover letter filling failed:', error);
    // Fallback: try individual element handling
    try {
      const textAreaElements = await page.$$('textarea');
      for (let i = 0; i < textAreaElements.length; i++) {
        const textArea = textAreaElements[i];
        const placeholder = await textArea.evaluate(el => el.placeholder?.toLowerCase() || '');
        
        if (placeholder.includes('cover') || placeholder.includes('message') || placeholder.includes('why')) {
          await textArea.click({ clickCount: 3 }); // Select all existing text
          await textArea.type(coverLetter, { delay: 30 });
          console.log('✅ Cover letter filled (fallback method)');
          break;
        }
      }
    } catch (fallbackError) {
      console.log('⚠️ Fallback cover letter filling also failed');
    }
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
    // Handle text inputs using $$eval
    await page.$$eval('input[type="text"], input[type="number"]', 
      (inputs: HTMLInputElement[], commonAnswers: any) => {
        inputs.forEach(input => {
          // Find the associated label
          const labelEl = input.closest('.form-element, .field, .input-group')?.querySelector('label');
          const labelText = labelEl?.textContent?.toLowerCase() || '';
          
          for (const [keyword, answer] of Object.entries(commonAnswers)) {
            if (labelText.includes(keyword)) {
              input.value = answer as string;
              console.log(`✅ Answered: ${keyword} = ${answer}`);
              break;
            }
          }
        });
      }, commonAnswers);
  } catch (error) {
    console.log('⚠️ Question answering failed with $$eval, trying fallback:', error);
    
    // Fallback: manual iteration
    try {
      const inputElements = await page.$$('input[type="text"], input[type="number"]');
      for (let i = 0; i < inputElements.length; i++) {
        const input = inputElements[i];
        const label = await input.evaluate(el => {
          const labelEl = el.closest('.form-element, .field, .input-group')?.querySelector('label');
          return labelEl?.textContent?.toLowerCase() || '';
        });

        for (const [keyword, answer] of Object.entries(commonAnswers)) {
          if (label.includes(keyword)) {
            await input.click({ clickCount: 3 }); // Select all text
            await input.type(answer as string, { delay: 50 });
            console.log(`✅ Answered: ${keyword} = ${answer}`);
            break;
          }
        }
      }
    } catch (fallbackError) {
      console.log('⚠️ Fallback question answering also failed');
    }
  }

  // Fix for line 1091 - selects iteration
  try {
    const selectElements = await page.$$('select');
    for (let i = 0; i < selectElements.length; i++) {
      const select = selectElements[i];
      try {
        const options = await select.$$('option');
        if (options.length > 1) {
          // Select first non-empty option
          const firstValue = await options[1].evaluate(el => (el as HTMLOptionElement).value);
          if (firstValue) {
            await select.select(firstValue);
            console.log('✅ Dropdown selection made');
          }
        }
      } catch (error) {
        // Continue with other selects
        console.log('⚠️ Failed to handle select dropdown');
      }
    }
  } catch (error) {
    console.log('⚠️ Select dropdown handling failed');
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
          await button.evaluate((el: HTMLElement) => {
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
      console.log('⚠️ Submit button highlighting failed:', error);
      return null;
    }
  }
}