// src/server.ts - Updated with Prisma and Database Integration
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Debug dotenv loading
console.log('=== DOTENV DEBUG ===');
console.log('Current working directory:', process.cwd());

const envPath = path.resolve(process.cwd(), '.env');
console.log('Looking for .env at:', envPath);
console.log('.env file exists:', fs.existsSync(envPath));

if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  console.log('.env file size:', envContent.length, 'characters');
  console.log('Contains DATABASE_URL:', envContent.includes('DATABASE_URL'));
  console.log('Contains GEMINI_API_KEY:', envContent.includes('GEMINI_API_KEY'));
}

const dotenvResult = dotenv.config({ path: envPath });
console.log('dotenv.config() result:', dotenvResult);
console.log('==================');

// Check environment variables after loading
console.log('=== ENVIRONMENT CHECK ===');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('DATABASE_URL loaded:', !!process.env.DATABASE_URL);
console.log('GEMINI_API_KEY loaded:', !!process.env.GEMINI_API_KEY);
console.log('TELEGRAM_BOT_TOKEN loaded:', !!process.env.TELEGRAM_BOT_TOKEN);
console.log('ENABLE_AUTOMATION:', process.env.ENABLE_AUTOMATION);
console.log('========================');

import express from 'express';
import cors from 'cors';
import passport from 'passport';
import session from 'express-session';
import { Server } from 'socket.io';
import { createServer } from 'http';

// Import Prisma database
import { initDatabase, getDatabaseStats, closeDatabase } from './database/db';

// Import configurations
import { setupPassportStrategies } from './config/passport';
import { setupRoutes } from './routes/index';
import { setupSocketIO } from './config/sockets';

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true
  }
});

// Initialize database and start server
const startServer = async () => {
  try {
    console.log('Starting Job Agent Server with Prisma...');
    console.log('Connecting to PostgreSQL database...');
    await initDatabase();
    console.log('Database connected successfully');

    // Middleware
    app.use(cors({
      origin: process.env.FRONTEND_URL || "http://localhost:3000",
      credentials: true
    }));

    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    app.use(session({
      secret: process.env.SESSION_SECRET || 'dev-secret-key',
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: process.env.NODE_ENV === 'production',
        maxAge: 4 * 60 * 60 * 1000 // 4 hours
      }
    }));

    app.use(passport.initialize());
    app.use(passport.session());

    // Setup configurations
    console.log('Setting up authentication strategies...');
    setupPassportStrategies();

    // Setup routes
    console.log('Setting up routes...');
    setupRoutes(app, io);

    // Setup Socket.IO
    console.log('Setting up Socket.IO...');
    setupSocketIO(io);

    // Global error handling middleware
    app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      console.error('Server error:', err);
      res.status(500).json({ 
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
      });
    });

    // 404 handler
    app.use('*', (req, res) => {
      res.status(404).json({ error: 'Endpoint not found' });
    });

    const PORT = process.env.PORT || 3001;

    server.listen(PORT, async () => {
      console.log('\nJob Agent Server Started Successfully!');
      console.log('='.repeat(50));
      console.log(`Server running on port: ${PORT}`);
      console.log(`Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:3000'}`);
      
      // Show service status
      console.log(`LinkedIn OAuth: ${!!process.env.LINKEDIN_CLIENT_ID ? 'Connected' : 'Missing'}`);
      console.log(`Google OAuth: ${!!process.env.GOOGLE_CLIENT_ID ? 'Connected' : 'Missing'}`);
      console.log(`Gemini AI: ${!!process.env.GEMINI_API_KEY ? 'Connected' : 'Missing'}`);
      console.log(`Telegram Bot: ${!!process.env.TELEGRAM_BOT_TOKEN ? 'Connected' : 'Missing'}`);
      console.log(`Automation: ${process.env.ENABLE_AUTOMATION === 'true' ? 'Enabled' : 'Disabled'}`);
      
      // Show database stats
      try {
        const stats = await getDatabaseStats();
        console.log(`Database: PostgreSQL (Users: ${stats.users}, Jobs: ${stats.jobs}, Applications: ${stats.applications})`);
      } catch (error) {
        console.log('Database: Error getting stats');
      }
      
      console.log('='.repeat(50));
      console.log('🚀 Ready to accept connections!');
      console.log('📱 Automation endpoints available at /api/automation/*');
      console.log('🔧 Health check: /api/automation/health');
      console.log('Use Ctrl+C to stop the server\n');
    });

  } catch (error) {
    console.error('\nFailed to start server:', error);
    process.exit(1);
  }
};

// Graceful shutdown handling
process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, shutting down gracefully...');
  await closeDatabase();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('\nReceived SIGINT (Ctrl+C), shutting down gracefully...');
  await closeDatabase();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', async (error) => {
  console.error('Uncaught Exception:', error);
  await closeDatabase();
  process.exit(1);
});

process.on('unhandledRejection', async (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  await closeDatabase();
  process.exit(1);
});

// Start the server
startServer();

export { io };
