import { Server as SocketServer } from 'socket.io';
import jwt from 'jsonwebtoken';
import { activeSessions } from '../middleware/auth';

export const setupSocketIO = (io: SocketServer) => {
  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    
    socket.on('authenticate', (token) => {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
        const user = activeSessions.get(decoded.userId);
        
        if (user) {
          // FIX: Set userId on socket so job service can find it
          (socket as any).userId = user.id;
          user.socketId = socket.id;
          activeSessions.set(user.id, user);
          
          // Join user-specific room for targeted messaging
          socket.join(user.id);
          
          socket.emit('authenticated', { 
            status: 'success',
            user: {
              name: user.name,
              email: user.email,
              linkedinConnected: !!user.linkedinToken,
              googleConnected: !!user.googleToken
            }
          });
          
          console.log(`Socket authenticated for user: ${user.name} (ID: ${user.id}, Socket: ${socket.id})`);
        } else {
          console.log('Authentication failed: Invalid session for token');
          socket.emit('authenticated', { status: 'error', message: 'Invalid session' });
        }
      } catch (error) {
        console.log('Authentication failed: Invalid token', error);
        socket.emit('authenticated', { status: 'error', message: 'Invalid token' });
      }
    });
    
    // Add job search event handlers
    socket.on('start_job_search', (data) => {
      const userId = (socket as any).userId;
      console.log(`Job search started by user ${userId}:`, data);
    });
    
    socket.on('pause_job_search', () => {
      const userId = (socket as any).userId;
      console.log(`Job search paused by user ${userId}`);
    });
    
    socket.on('disconnect', () => {
      const userId = (socket as any).userId;
      console.log(`Client disconnected: ${socket.id} (User: ${userId || 'unauthenticated'})`);
      
      // Remove socket ID from user session
      if (userId) {
        const user = activeSessions.get(userId);
        if (user && user.socketId === socket.id) {
          delete user.socketId;
          activeSessions.set(userId, user);
        }
      }
    });
  });
  
  console.log('Socket.IO configured with authentication support');
};