import { Express } from 'express';
import { Server as SocketServer } from 'socket.io';
import authRoutes from './auth';
import apiRoutes from './api';

export const setupRoutes = (app: Express, io: SocketServer) => {
  // Health check route
  app.get('/api/health', (req, res) => {
    res.json({ 
      status: 'OK', 
      timestamp: new Date().toISOString(),
      activeSessions: 0 // You can import activeSessions if needed
    });
  });

  // Setup route modules
  authRoutes(app);
  apiRoutes(app, io);
};