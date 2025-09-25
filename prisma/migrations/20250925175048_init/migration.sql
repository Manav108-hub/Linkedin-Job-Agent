-- CreateTable
CREATE TABLE "public"."users" (
    "id" TEXT NOT NULL,
    "linkedin_id" TEXT,
    "google_id" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "profile_data" JSONB,
    "resume_doc_id" TEXT,
    "resume_text" TEXT,
    "resume_filename" TEXT,
    "linkedin_token" TEXT,
    "google_token" TEXT,
    "google_refresh_token" TEXT,
    "resume_sections" JSONB,
    "original_file_buffer" BYTEA,
    "automation_enabled" BOOLEAN NOT NULL DEFAULT true,
    "telegram_chat_id" TEXT,
    "preferred_keywords" JSONB,
    "preferred_location" TEXT DEFAULT 'India',
    "experience_level" TEXT DEFAULT 'mid-level',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."job_listings" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "location" TEXT,
    "description" TEXT,
    "url" TEXT,
    "salary_range" TEXT,
    "job_type" TEXT,
    "experience_level" TEXT,
    "posted_date" TIMESTAMP(3),
    "scraped_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "job_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."job_applications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "job_url" TEXT,
    "status" TEXT NOT NULL,
    "match_score" INTEGER,
    "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "resume_customized" BOOLEAN NOT NULL DEFAULT false,
    "drive_link" TEXT,

    CONSTRAINT "job_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."hr_contacts" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "linkedin_profile" TEXT,
    "title" TEXT,
    "company" TEXT,
    "phone" TEXT,
    "extracted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."resumes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "original_content" TEXT NOT NULL,
    "customized_content" TEXT NOT NULL,
    "format_type" TEXT NOT NULL DEFAULT 'professional',
    "file_path" TEXT,
    "customization_successful" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resumes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."email_drafts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "hr_contact_id" TEXT,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "email_type" TEXT NOT NULL DEFAULT 'application',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),

    CONSTRAINT "email_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."automation_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "run_date" DATE NOT NULL,
    "jobs_found" INTEGER NOT NULL DEFAULT 0,
    "applications_sent" INTEGER NOT NULL DEFAULT 0,
    "duplicates_skipped" INTEGER NOT NULL DEFAULT 0,
    "errors_occurred" INTEGER NOT NULL DEFAULT 0,
    "execution_time_ms" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."notification_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "notification_type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message_content" TEXT,
    "error_message" TEXT,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_linkedin_id_key" ON "public"."users"("linkedin_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_google_id_key" ON "public"."users"("google_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "public"."users"("email");

-- CreateIndex
CREATE INDEX "users_linkedin_id_idx" ON "public"."users"("linkedin_id");

-- CreateIndex
CREATE INDEX "users_google_id_idx" ON "public"."users"("google_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_listings_url_key" ON "public"."job_listings"("url");

-- CreateIndex
CREATE INDEX "job_listings_company_idx" ON "public"."job_listings"("company");

-- CreateIndex
CREATE INDEX "job_listings_posted_date_idx" ON "public"."job_listings"("posted_date");

-- CreateIndex
CREATE INDEX "job_applications_user_id_idx" ON "public"."job_applications"("user_id");

-- CreateIndex
CREATE INDEX "job_applications_status_idx" ON "public"."job_applications"("status");

-- CreateIndex
CREATE INDEX "job_applications_user_id_job_url_idx" ON "public"."job_applications"("user_id", "job_url");

-- CreateIndex
CREATE INDEX "hr_contacts_job_id_idx" ON "public"."hr_contacts"("job_id");

-- CreateIndex
CREATE INDEX "resumes_user_id_idx" ON "public"."resumes"("user_id");

-- CreateIndex
CREATE INDEX "automation_logs_user_id_run_date_idx" ON "public"."automation_logs"("user_id", "run_date");

-- CreateIndex
CREATE INDEX "notification_logs_user_id_notification_type_idx" ON "public"."notification_logs"("user_id", "notification_type");

-- AddForeignKey
ALTER TABLE "public"."job_applications" ADD CONSTRAINT "job_applications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."job_applications" ADD CONSTRAINT "job_applications_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."job_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."hr_contacts" ADD CONSTRAINT "hr_contacts_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."job_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."resumes" ADD CONSTRAINT "resumes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."resumes" ADD CONSTRAINT "resumes_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."job_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."email_drafts" ADD CONSTRAINT "email_drafts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."email_drafts" ADD CONSTRAINT "email_drafts_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."job_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."email_drafts" ADD CONSTRAINT "email_drafts_hr_contact_id_fkey" FOREIGN KEY ("hr_contact_id") REFERENCES "public"."hr_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."automation_logs" ADD CONSTRAINT "automation_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."notification_logs" ADD CONSTRAINT "notification_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
