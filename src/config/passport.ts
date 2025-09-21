// src/config/passport.ts - RESTORE WORKING VERSION FIRST
import passport from 'passport';
import { Strategy as OAuth2Strategy } from 'passport-oauth2';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { activeSessions, createUserSession } from '../middleware/auth';
import { UserModel } from '../database/db';
import { UserSession } from '../types';

export const setupPassportStrategies = () => {
  // Passport configuration
  passport.serializeUser((user: any, done) => {
    done(null, user.id);
  });

  passport.deserializeUser((id: string, done) => {
    const user = activeSessions.get(id);
    done(null, user || false);
  });

  // LinkedIn OAuth Strategy (WORKING VERSION - RESTORE THIS FIRST)
  passport.use('linkedin', new OAuth2Strategy({
    authorizationURL: 'https://www.linkedin.com/oauth/v2/authorization',
    tokenURL: 'https://www.linkedin.com/oauth/v2/accessToken',
    clientID: process.env.LINKEDIN_CLIENT_ID!,
    clientSecret: process.env.LINKEDIN_CLIENT_SECRET!,
    callbackURL: "/api/auth/linkedin/callback",
    scope: ['openid', 'profile', 'email']
  }, async (accessToken: string, refreshToken: any, profile: { id: any; displayName: any; name: { givenName: any; familyName: any; }; emails: { value: any; }[]; }, done: (arg0: unknown, arg1: boolean | UserSession) => any) => {
    try {
      console.log('LinkedIn profile received:', JSON.stringify(profile, null, 2));
      
      // Handle different LinkedIn profile formats (WORKING LOGIC)
      const userData = {
        id: profile.id || (profile as any).sub || `linkedin_${Date.now()}`,
        name: profile.displayName || 
              (typeof profile.name === 'object' ? `${profile.name.givenName || ''} ${profile.name.familyName || ''}`.trim() : profile.name) || 
              `${(profile as any).name?.givenName || ''} ${(profile as any).name?.familyName || ''}`.trim() ||
              'LinkedIn User',
        email: profile.emails?.[0]?.value || 
               (Array.isArray(profile.emails) ? profile.emails[0].value : null) || 
               `user${Date.now()}@linkedin.temp`,
        linkedin_id: profile.id || (profile as any).sub || `linkedin_${Date.now()}`
      };
      
      console.log('Processed user data:', userData);
      
      // Create session with proper profile structure
      const sessionProfile = {
        id: userData.id,
        displayName: userData.name,
        emails: [{ value: userData.email }],
        provider: 'linkedin'
      };
      
      const user = createUserSession(sessionProfile, accessToken, 'linkedin');
      
      // Save to database
      try {
        await UserModel.create({
          id: user.id,
          linkedinId: userData.linkedin_id,
          name: userData.name,
          email: userData.email,
          profileData: profile
        });
      } catch (dbError) {
        console.log('Database save skipped (user may already exist)');
      }
      
      console.log('LinkedIn user authenticated and saved:', userData.name);
      return done(null, user);
    } catch (error) {
      console.error('LinkedIn auth error:', error);
      console.error('Profile data received:', profile);
      
      // Create fallback user to prevent complete failure
      try {
        const fallbackProfile = {
          id: `linkedin_fallback_${Date.now()}`,
          displayName: 'LinkedIn User',
          emails: [{ value: `user${Date.now()}@linkedin.temp` }],
          provider: 'linkedin'
        };
        
        const fallbackUser = createUserSession(fallbackProfile, accessToken, 'linkedin');
        
        try {
          await UserModel.create({
            id: fallbackUser.id,
            linkedinId: fallbackProfile.id,
            name: fallbackProfile.displayName,
            email: fallbackProfile.emails[0].value,
            profileData: { fallback: true, original: profile }
          });
        } catch (dbError) {
          console.log('Fallback database save skipped');
        }
        
        console.log('LinkedIn fallback user created');
        return done(null, fallbackUser);
      } catch (fallbackError) {
        console.error('LinkedIn fallback failed:', fallbackError);
        return done(error, false);
      }
    }
  }));

  // Google OAuth Strategy (unchanged)
  // Google OAuth Strategy (FIXED VERSION)
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  callbackURL: "/api/auth/google/callback",
  scope: [
    'profile', 
    'email', 
    'https://www.googleapis.com/auth/documents.readonly',
    'https://www.googleapis.com/auth/drive.file'  // Add Drive scope!
  ]
}, async (accessToken, refreshToken, profile, done) => {
  try {
    console.log('Google OAuth - accessToken exists:', !!accessToken);
    console.log('Google OAuth - refreshToken exists:', !!refreshToken);
    console.log('Google OAuth - profile:', profile.displayName, profile.emails?.[0]?.value);
    
    const user = createUserSession(profile, accessToken, 'google');
    
    // Save to database WITH TOKENS
    try {
      await UserModel.create({
        id: user.id,
        googleId: profile.id,
        name: user.name,
        email: user.email,
        profileData: profile,
        googleToken: accessToken,           // SAVE THE TOKEN!
        googleRefreshToken: refreshToken    // SAVE THE REFRESH TOKEN!
      });
      
      console.log('Google user saved with tokens:', user.name);
    } catch (dbError) {
      console.log('Google database save skipped (user may already exist)');
      
      // If user exists, UPDATE with new tokens
      try {
        await UserModel.updateGoogleTokens(user.email, accessToken, refreshToken);
        console.log('Google tokens updated for existing user');
      } catch (updateError) {
        console.error('Failed to update Google tokens:', updateError);
      }
    }
    
    console.log('Google user authenticated:', user.name);
    return done(null, user);
  } catch (error) {
    console.error('Google auth error:', error);
    return done(error, false);
  }
}));
};