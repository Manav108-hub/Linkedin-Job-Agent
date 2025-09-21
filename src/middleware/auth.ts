// src/middleware/auth.ts - TEMPORARY: Name-Based Session Matching
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { UserSession } from '../types';

// Extend Express Request type
declare global {
  namespace Express {
    interface User extends UserSession {}
  }
}

// In-memory session storage (use Redis in production)
export const activeSessions = new Map<string, UserSession>();

// Both email and name mapping for fallback
export const emailToSessionMap = new Map<string, string>();
export const nameToSessionMap = new Map<string, string>();

export const verifyToken = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
    const user = activeSessions.get(decoded.userId);
    
    if (!user) {
      return res.status(401).json({ error: 'Session expired or invalid' });
    }
    
    // Check if session has expired
    if (new Date() > user.expiresAt) {
      activeSessions.delete(user.id);
      if (user.email) {
        emailToSessionMap.delete(user.email);
      }
      if (user.name) {
        nameToSessionMap.delete(user.name);
      }
      return res.status(401).json({ error: 'Session expired' });
    }
    
    req.user = user;
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
};

export const createUserSession = (
  profile: any, 
  accessToken: string, 
  provider: 'linkedin' | 'google'
): UserSession => {
  const email = profile.emails?.[0]?.value || '';
  const name = profile.displayName || '';
  
  console.log(`Creating ${provider} session for:`, { email, name });
  
  // Try to find existing session by email first, then by any existing session (single user assumption)
  let existingSessionId: string | undefined;
  let existingUser: UserSession | undefined;
  
  // Priority 1: Match by email (if not temp email)
  if (email && !email.includes('@linkedin.temp')) {
    existingSessionId = emailToSessionMap.get(email);
  }
  
  // Priority 2: Match by name (for LinkedIn temp emails)
  if (!existingSessionId && name && name !== 'LinkedIn User') {
    existingSessionId = nameToSessionMap.get(name);
  }
  
  // Priority 3: SINGLE USER MODE - If no match found but we have existing sessions, 
  // assume it's the same user (since you're testing alone)
  if (!existingSessionId && activeSessions.size > 0) {
    // Get the first (most recent) active session
    const firstSession = Array.from(activeSessions.entries())[0];
    existingSessionId = firstSession[0];
    existingUser = firstSession[1];
    console.log(`Single user mode: Merging with existing session for different provider`);
  }
  
  if (existingSessionId && !existingUser) {
    existingUser = activeSessions.get(existingSessionId);
  }
  
  if (existingUser) {
    console.log(`Found existing session for user:`, {
      email,
      name,
      existingEmail: existingUser.email,
      existingName: existingUser.name,
      hasLinkedIn: !!existingUser?.linkedinToken,
      hasGoogle: !!existingUser?.googleToken
    });
  }
  
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 4 * 60 * 60 * 1000);
  
  // Use existing session ID if available, otherwise create new one
  const sessionId = existingUser?.id || generateUniqueSessionId(email || name);
  
  const session: UserSession = {
    id: sessionId,
    // Use the better name/email when available
    name: (name && name !== 'LinkedIn User') ? name : (existingUser?.name || name || 'User'),
    email: (email && !email.includes('@linkedin.temp')) ? email : (existingUser?.email || email || ''),
    createdAt: existingUser?.createdAt || now,
    expiresAt,
    // Preserve existing tokens and add new one - FIX: Don't spread existingUser after setting tokens
    linkedinToken: provider === 'linkedin' ? accessToken : existingUser?.linkedinToken,
    googleToken: provider === 'google' ? accessToken : existingUser?.googleToken,
    socketId: existingUser?.socketId,
    // Don't spread existingUser here as it overwrites the tokens above
  };
  
  // Store session with both email and name mapping
  activeSessions.set(sessionId, session);
  
  // Map both emails if available
  if (session.email && !session.email.includes('@linkedin.temp')) {
    emailToSessionMap.set(session.email, sessionId);
  }
  if (email && email.includes('@linkedin.temp')) {
    emailToSessionMap.set(email, sessionId); // Also map temp email for consistency
  }
  
  if (session.name && session.name !== 'LinkedIn User') {
    nameToSessionMap.set(session.name, sessionId);
  }
  
  console.log(`Session created/updated:`, {
    sessionId,
    email: session.email,
    name: session.name,
    hasLinkedIn: !!session.linkedinToken,
    hasGoogle: !!session.googleToken
  });
  
  return session;
};

// Generate a unique session ID
const generateUniqueSessionId = (identifier: string): string => {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(identifier + Date.now()).digest('hex').substring(0, 16);
};

// Cleanup expired sessions
export const cleanupExpiredSessions = () => {
  const now = new Date();
  
  for (const [sessionId, session] of activeSessions.entries()) {
    if (now > session.expiresAt) {
      activeSessions.delete(sessionId);
      if (session.email) {
        emailToSessionMap.delete(session.email);
      }
      if (session.name) {
        nameToSessionMap.delete(session.name);
      }
    }
  }
};

// Export session stats for debugging
export const getSessionStats = () => {
  return {
    activeSessions: activeSessions.size,
    emailMappings: emailToSessionMap.size,
    nameMappings: nameToSessionMap.size,
    sessions: Array.from(activeSessions.values()).map(s => ({
      id: s.id,
      email: s.email,
      name: s.name,
      hasLinkedIn: !!s.linkedinToken,
      hasGoogle: !!s.googleToken,
      expiresAt: s.expiresAt
    }))
  };
};