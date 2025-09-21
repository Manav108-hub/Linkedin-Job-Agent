CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  linkedin_id TEXT UNIQUE,
  google_id TEXT UNIQUE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  profile_data TEXT, -- JSON string for additional profile info
  resume_doc_id TEXT, -- Google Docs ID for original resume
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Job listings table
CREATE TABLE IF NOT EXISTS job_listings (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  location TEXT,
  description TEXT,
  url TEXT UNIQUE,
  salary_range TEXT,
  job_type TEXT, -- full-time, part-time, contract
  experience_level TEXT,
  posted_date DATETIME,
  scraped_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  is_active BOOLEAN DEFAULT 1
);

-- Job applications table
CREATE TABLE IF NOT EXISTS job_applications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  status TEXT NOT NULL, -- pending, applied, rejected, interview, offer
  match_score INTEGER, -- AI match score 0-100
  applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  notes TEXT,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  FOREIGN KEY (job_id) REFERENCES job_listings (id) ON DELETE CASCADE
);

-- HR contacts table
CREATE TABLE IF NOT EXISTS hr_contacts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  name TEXT,
  email TEXT,
  linkedin_profile TEXT,
  title TEXT, -- HR Manager, Recruiter, etc.
  company TEXT,
  phone TEXT,
  extracted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (job_id) REFERENCES job_listings (id) ON DELETE CASCADE
);

-- Customized resumes table
CREATE TABLE IF NOT EXISTS resumes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  original_content TEXT,
  customized_content TEXT,
  format_type TEXT DEFAULT 'professional', -- professional, modern, creative
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  file_path TEXT, -- Path to generated PDF/DOC
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  FOREIGN KEY (job_id) REFERENCES job_listings (id) ON DELETE CASCADE
);

-- Email drafts table
CREATE TABLE IF NOT EXISTS email_drafts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  hr_contact_id TEXT,
  subject TEXT,
  body TEXT,
  email_type TEXT DEFAULT 'application', -- application, follow_up, thank_you
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  sent_at DATETIME,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  FOREIGN KEY (job_id) REFERENCES job_listings (id) ON DELETE CASCADE,
  FOREIGN KEY (hr_contact_id) REFERENCES hr_contacts (id) ON DELETE SET NULL
);

-- Application history view
CREATE VIEW IF NOT EXISTS application_history AS
SELECT 
  ja.id,
  ja.user_id,
  jl.title,
  jl.company,
  jl.location,
  ja.status,
  ja.match_score,
  ja.applied_at,
  COUNT(hc.id) as hr_contacts_found,
  r.id as resume_id
FROM job_applications ja
JOIN job_listings jl ON ja.job_id = jl.id
LEFT JOIN hr_contacts hc ON jl.id = hc.job_id
LEFT JOIN resumes r ON ja.job_id = r.job_id AND ja.user_id = r.user_id
GROUP BY ja.id;

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_users_linkedin_id ON users(linkedin_id);
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
CREATE INDEX IF NOT EXISTS idx_job_applications_user_id ON job_applications(user_id);
CREATE INDEX IF NOT EXISTS idx_job_applications_status ON job_applications(status);
CREATE INDEX IF NOT EXISTS idx_job_listings_company ON job_listings(company);
CREATE INDEX IF NOT EXISTS idx_job_listings_posted_date ON job_listings(posted_date);
CREATE INDEX IF NOT EXISTS idx_hr_contacts_job_id ON hr_contacts(job_id);
CREATE INDEX IF NOT EXISTS idx_resumes_user_id ON resumes(user_id);