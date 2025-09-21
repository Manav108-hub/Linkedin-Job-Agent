import { Page } from 'puppeteer';

export interface HRContact {
  name?: string;
  email?: string;
  linkedin_profile?: string;
  title?: string;
  company?: string;
  phone?: string;
}

export class HRExtractorService {
  private emailPatterns = [
    // Common email patterns
    /[\w\.-]+@[\w\.-]+\.\w+/g,
    // HR specific patterns
    /hr@[\w\.-]+\.\w+/gi,
    /careers@[\w\.-]+\.\w+/gi,
    /recruiting@[\w\.-]+\.\w+/gi,
    /talent@[\w\.-]+\.\w+/gi,
    /jobs@[\w\.-]+\.\w+/gi
  ];

  private hrTitles = [
    'hr manager', 'human resources', 'recruiter', 'talent acquisition',
    'hiring manager', 'people operations', 'hr business partner',
    'talent manager', 'recruitment specialist', 'hr coordinator',
    'people manager', 'hr generalist', 'staffing coordinator'
  ];

  async extractHRContactsFromJobPage(page: Page, jobUrl: string, company: string): Promise<HRContact[]> {
    const contacts: HRContact[] = [];
    
    try {
      console.log(`Extracting HR contacts from: ${jobUrl}`);
      
      await page.goto(jobUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      
      // Extract from job description
      const jobPageContacts = await this.extractFromJobDescription(page, company);
      contacts.push(...jobPageContacts);
      
      // Try to find company employees/hiring team
      const employeeContacts = await this.extractEmployeeContacts(page, company);
      contacts.push(...employeeContacts);
      
      // Extract from company page if available
      const companyContacts = await this.extractFromCompanyPage(page, company);
      contacts.push(...companyContacts);
      
      return this.deduplicateContacts(contacts);
      
    } catch (error) {
      console.error('Error extracting HR contacts:', error);
      return contacts;
    }
  }

  private async extractFromJobDescription(page: Page, company: string): Promise<HRContact[]> {
    const contacts: HRContact[] = [];
    
    try {
      // Get job description text
      const jobDescription = await page.evaluate(() => {
        const desc = document.querySelector('.show-more-less-html__markup') ||
                    document.querySelector('.job-description') ||
                    document.querySelector('[data-testid="job-description"]') ||
                    document.querySelector('.description__text');
        return desc?.textContent || '';
      });

      // Extract emails from description
      const emails = this.extractEmailsFromText(jobDescription);
      for (const email of emails) {
        contacts.push({
          email: email,
          company: company
        });
      }

      // Look for contact information sections
      const contactInfo = await page.evaluate(() => {
        const contactElements = Array.from(document.querySelectorAll('*')).filter(el => {
          const text = el.textContent?.toLowerCase() || '';
          return text.includes('contact') || text.includes('apply') || 
                 text.includes('send resume') || text.includes('email');
        });

        return contactElements.map(el => el.textContent || '').join(' ');
      });

      const contactEmails = this.extractEmailsFromText(contactInfo);
      for (const email of contactEmails) {
        contacts.push({
          email: email,
          company: company
        });
      }

    } catch (error) {
      console.error('Error extracting from job description:', error);
    }
    
    return contacts;
  }

  private async extractEmployeeContacts(page: Page, company: string): Promise<HRContact[]> {
    const contacts: HRContact[] = [];
    
    try {
      // Look for hiring manager or poster information
      const posterInfo = await page.evaluate(() => {
        // Check for job poster/hiring manager info
        const posterSelectors = [
          '.hiring-insights__poster',
          '.job-poster-info',
          '[data-testid="job-poster"]',
          '.job-details-jobs-unified-top-card__company-name',
          '.hiring-insights'
        ];

        for (const selector of posterSelectors) {
          const element = document.querySelector(selector);
          if (element) {
            const links = element.querySelectorAll('a[href*="/in/"]');
            const names = element.querySelectorAll('[aria-label*="View"], .hiring-insights__poster-name');
            
            return Array.from(links).map((link, index) => ({
              name: (names[index] as HTMLElement)?.textContent?.trim() || '',
              linkedin_profile: (link as HTMLAnchorElement).getAttribute('href') || '',
              title: 'Hiring Team'
            }));
          }
        }
        return [];
      });

      contacts.push(...posterInfo.map(info => ({
        ...info,
        company: company
      })));

      // Try to find "See who you know" section for employee connections
      const employeeConnections = await page.evaluate(() => {
        const connectionsSection = document.querySelector('.job-details-jobs-unified-top-card__company-name');
        if (connectionsSection) {
          const links = connectionsSection.querySelectorAll('a[href*="/in/"]');
          return Array.from(links).map(link => ({
            linkedin_profile: (link as HTMLAnchorElement).getAttribute('href') || '',
            name: link.textContent?.trim() || ''
          }));
        }
        return [];
      });

      contacts.push(...employeeConnections.map(conn => ({
        ...conn,
        company: company,
        title: 'Employee'
      })));

    } catch (error) {
      console.error('Error extracting employee contacts:', error);
    }
    
    return contacts;
  }

  private async extractFromCompanyPage(page: Page, company: string): Promise<HRContact[]> {
    const contacts: HRContact[] = [];
    
    try {
      // Try to navigate to company's LinkedIn page
      const companyPageUrl = `https://www.linkedin.com/company/${company.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}`;
      
      await page.goto(companyPageUrl, { waitUntil: 'networkidle2', timeout: 15000 });
      
      // Extract HR team members with proper typing
      const hrTeamMembers = await page.evaluate((hrTitles: string[]) => {
        const employees = document.querySelectorAll('.org-people-profile-card');
        const hrMembers: Array<{
          name?: string;
          title?: string;
          linkedin_profile?: string;
        }> = [];
        
        employees.forEach((card) => {
          const nameEl = card.querySelector('.org-people-profile-card__profile-title') as HTMLElement;
          const titleEl = card.querySelector('.org-people-profile-card__profile-info .t-14') as HTMLElement;
          const linkEl = card.querySelector('a[href*="/in/"]') as HTMLAnchorElement;
          
          const name = nameEl?.textContent?.trim();
          const title = titleEl?.textContent?.trim().toLowerCase();
          const linkedin_profile = linkEl?.getAttribute('href');
          
          if (title && hrTitles.some((hrTitle: string) => title.includes(hrTitle.toLowerCase()))) {
            hrMembers.push({
              name: name,
              title: titleEl?.textContent?.trim(),
              linkedin_profile: linkedin_profile || undefined
            });
          }
        });
        
        return hrMembers;
      }, this.hrTitles);

      contacts.push(...hrTeamMembers.map(member => ({
        ...member,
        company: company
      })));

      // Extract company contact information
      const companyContactInfo = await page.evaluate(() => {
        const contactSection = document.querySelector('.org-page-details__definition-text') ||
                              document.querySelector('.company-info');
        return contactSection?.textContent || '';
      });

      const companyEmails = this.extractEmailsFromText(companyContactInfo);
      for (const email of companyEmails) {
        contacts.push({
          email: email,
          company: company,
          title: 'Company Contact'
        });
      }

    } catch (error) {
      console.error('Error extracting from company page:', error);
      // Don't throw error, just continue with what we have
    }
    
    return contacts;
  }

  private extractEmailsFromText(text: string): string[] {
    const emails: string[] = [];
    
    for (const pattern of this.emailPatterns) {
      const matches = text.match(pattern);
      if (matches) {
        emails.push(...matches);
      }
    }
    
    return [...new Set(emails)]; // Remove duplicates
  }

  private deduplicateContacts(contacts: HRContact[]): HRContact[] {
    const seen = new Set();
    const unique: HRContact[] = [];
    
    for (const contact of contacts) {
      const key = contact.email || contact.linkedin_profile || contact.name;
      if (key && !seen.has(key)) {
        seen.add(key);
        unique.push(contact);
      }
    }
    
    return unique;
  }

  // Generate common email patterns for a company
  generateEmailPatterns(company: string, names: string[]): string[] {
    const domain = this.guessDomain(company);
    const patterns: string[] = [];
    
    for (const name of names) {
      const firstName = name.split(' ')[0]?.toLowerCase();
      const lastName = name.split(' ').slice(-1)[0]?.toLowerCase();
      const firstInitial = firstName?.[0];
      const lastInitial = lastName?.[0];
      
      if (firstName && lastName && domain) {
        patterns.push(
          `${firstName}.${lastName}@${domain}`,
          `${firstName}${lastName}@${domain}`,
          `${firstInitial}${lastName}@${domain}`,
          `${firstName}${lastInitial}@${domain}`,
          `${firstInitial}.${lastName}@${domain}`
        );
      }
    }
    
    // Add common HR emails
    if (domain) {
      patterns.push(
        `hr@${domain}`,
        `careers@${domain}`,
        `recruiting@${domain}`,
        `talent@${domain}`,
        `jobs@${domain}`
      );
    }
    
    return patterns;
  }

  private guessDomain(company: string): string {
    // Simple domain guessing - in production, you might want a more sophisticated approach
    const cleanCompany = company.toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[^a-z0-9]/g, '')
      .replace(/(inc|llc|corp|ltd|company|co)$/g, '');
    
    return `${cleanCompany}.com`;
  }

  // Generate personalized email drafts
  generateEmailDraft(contact: HRContact, jobTitle: string, userName: string, userSkills: string[]): {
    subject: string;
    body: string;
  } {
    const contactName = contact.name || 'Hiring Manager';
    const company = contact.company || 'your company';
    
    const subject = `Application for ${jobTitle} Position - ${userName}`;
    
    const body = `Dear ${contactName},

I hope this message finds you well. I recently applied for the ${jobTitle} position at ${company} and wanted to reach out personally to express my strong interest in this opportunity.

With expertise in ${userSkills.slice(0, 3).join(', ')}, I believe I would be a valuable addition to your team. I'm particularly excited about ${company}'s innovative approach and would welcome the opportunity to contribute to your continued success.

I've attached my tailored resume for your review and would be delighted to discuss how my background aligns with your needs. Thank you for considering my application, and I look forward to the possibility of speaking with you soon.

Best regards,
${userName}

P.S. I'm available for an interview at your convenience and can be reached at your preferred method of communication.`;

    return { subject, body };
  }
}