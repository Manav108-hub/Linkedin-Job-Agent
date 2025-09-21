# LinkedIn-Job-Agent

A self-hosted automation agent that searches job listings, applies on behalf of registered users, stores application history, and sends notifications via Telegram. Integrates with LinkedIn (OAuth), Google Drive (resume storage), and Telegram for alerts. Includes an automation scheduler to wake, search, and apply automatically.

---

## Features

* User registration & authentication (LinkedIn + local/email optional)
* Save user profile, preferred keywords, locations, experience level
* Search job listings across configured sources (LinkedIn, custom scrapers)
* Auto-apply to jobs using user credentials & stored resume
* Track history of applied jobs and prevent duplicate applications
* Automation scheduler (daily or configurable cron) to auto-search & apply
* Telegram notifications: daily summary + error alerts
* Resume management: upload to Google Drive and attach during applications
* WebSocket / Socket.IO for live updates
* Admin endpoints for monitoring & debugging

---

## Architecture Overview

* **Express** backend (TypeScript)
* **Prisma** + PostgreSQL for persistent storage
* **Redis** optional for rate-limiting / caching / job queue
* **Socket.IO** for real-time events
* **node-cron** for scheduling automation tasks
* **Telegram Bot API** for notifications
* **OAuth** (LinkedIn, Google) for secure user access
* **Google Drive API** for resume storage

---

## Data Models (high-level)

* **User**: id, name, email, linkedinId, linkedinToken, googleToken, googleRefreshToken, telegramChatId, automationEnabled, preferredKeywords, preferredLocation, experienceLevel, profileData
* **JobListing**: id, title, company, location, url, source, postedAt, rawPayload
* **JobApplication**: id, userId, jobListingId, appliedAt, status, coverLetter, resumeDriveId

---

## Environment Variables

Create a `.env` at the project root with the following keys:

```
# Server
NODE_ENV=development
PORT=3001
FRONTEND_URL=http://localhost:3000
SESSION_SECRET=your_session_secret

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/job_agent_db

# OAuth / APIs
LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GEMINI_API_KEY=

# Telegram
TELEGRAM_BOT_TOKEN=

# Google Drive
GOOGLE_DRIVE_FOLDER_ID=

# Feature flags
ENABLE_AUTOMATION=true

```

---

## Quick Start (local)

1. Install dependencies

```bash
npm install
```

2. Set up database (Prisma)

```bash
npx prisma generate
npx prisma migrate dev --name init
```

3. Create `.env` with the required variables (see above)

4. Run development server

```bash
npm run dev
```

5. Open frontend (if present) at `http://localhost:3000` and backend at `http://localhost:3001`

---

## Running with Docker (optional)

Add `Dockerfile` and `docker-compose.yml` mapping Postgres, Redis and the app. Example docker-compose should include service definitions for `db` (postgres), `redis` (optional) and `app` with `DATABASE_URL` pointed to the db container.

---

## Important Endpoints

> `POST /api/auth/linkedin` - start LinkedIn OAuth flow

> `GET /api/auth/linkedin/callback` - LinkedIn OAuth callback

> `POST /api/users/register` - register user (optional local flow)

> `GET /api/jobs/search` - query jobs with `?q=keyword&location=&experience=`

> `POST /api/jobs/apply` - apply to a job (requires user session). Body includes `jobListingId`, `coverLetter`, `resumeId`.

> `GET /api/users/:id/applications` - get application history for user

> `POST /api/automation/trigger` - manual trigger for automation (admin or user-triggered)

> `GET /api/automation/health` - health check

---

## Automation Behavior

* The automation scheduler (configurable using `node-cron`) runs at a set time (e.g. 9:00 IST) per server. For each automation-enabled user:

  * Build search criteria from user preferences
  * Query job sources (LinkedIn scraping or API)
  * Filter out previously applied jobs using past `JobApplication` records
  * Attempt application: fill fields (attach resume from Drive if needed), submit
  * Record application status in DB
  * Send daily Telegram summary

**Rate limiting & safety:** space out actions per-user (e.g. 10s delay between users, and pause between application requests) to avoid detection/rate limits.

---

## Telegram Integration

* Bot sends:

  * Daily summary: total jobs scanned, applied, skipped
  * Error alerts for automation failures
  * Manual triggers / application confirmations

**Webhook vs polling:** Use polling for simple setups; use webhooks if deploying on a reachable server.

---

## LinkedIn Integration

* Use OAuth to obtain `linkedinToken` for each user. Store token & refresh token if available.
* For applying, depending on whether API access is available, either:

  * Use official APIs (if you have partner access), OR
  * Use a reliable browser automation (Puppeteer) per user token/session to apply.

**IMPORTANT:** Automated interaction with LinkedIn may violate its TOS. Use caution and ensure users consent.

---

## Google Drive Resume Storage

* When user uploads a resume, store it in the configured Google Drive folder and save `driveFileId` on the user record.
* Use Drive file link during application when an upload field is required.

---

## Security & Privacy

* Store tokens encrypted at rest (or use secrets manager) and never log tokens to stdout.
* Only store the minimum required personal data and be transparent with users.
* Add rate-limiting and request throttling to avoid abuse.
* Provide a way for users to revoke automation (toggle `automationEnabled`).

---

## Monitoring & Debugging

* Health endpoints (`/api/automation/health`).
* Admin routes to view automation queue and per-user logs.
* Use Sentry or similar for error tracking.

---

## Testing

* Add unit tests for job filtering, deduplication, and DB operations.
* Mock external APIs (LinkedIn, Google Drive, Telegram) in tests.

---

## Contributing

Contributions welcome. Please open PRs against `main`. Follow code style (TypeScript, ESLint, Prettier).

---

## License

MIT

---

## Roadmap (optional)

* Add multi-source scrapers (Indeed, Naukri, Glassdoor)
* Add resume tailoring per job using an LLM (cover letter & resume tweaks)
* Add a web UI for automation schedules & per-user controls
* Add job application confidence scoring

---

If you want, I can:

* Create example Express routes and Prisma schema for `User`, `JobListing`, `JobApplication`.
* Provide a Docker Compose file to run Postgres + Redis + app.
* Scaffold the Telegram integration module with sample messages.

Tell me which of those you'd like next.
