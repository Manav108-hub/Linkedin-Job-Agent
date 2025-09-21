// src/config/passport.ts - Complete Working Configuration
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { activeSessions, createUserSession } from '../middleware/auth';
import { UserModel } from '../database/db';

export const setupPassportStrategies = () => {
  passport.serializeUser((user: any, done) => {
    done(null, user.id);
  });

  passport.deserializeUser((id: string, done) => {
    const user = activeSessions.get(id);
    done(null, user || false);
  });

  // LinkedIn OAuth will be handled manually in auth routes
  // No passport strategy needed for LinkedIn due to token exchange issues

  // Google OAuth Strategy (working)
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    callbackURL: "/api/auth/google/callback",
    scope: [
      'profile',
      'email',
      'https://www.googleapis.com/auth/documents.readonly',
      'https://www.googleapis.com/auth/drive.file'
    ]
  }, async (
    accessToken: string, 
    refreshToken: string, 
    profile: any, 
    done: (error: any, user?: any) => void
  ) => {
    try {
      console.log('Google OAuth Success:', {
        name: profile.displayName,
        email: profile.emails?.[0]?.value,
        hasRefreshToken: !!refreshToken
      });
      
      const user = createUserSession(profile, accessToken, 'google');
      
      try {
        await UserModel.create({
          id: user.id,
          googleId: profile.id,
          name: user.name,
          email: user.email,
          profileData: profile,
          googleToken: accessToken,
          googleRefreshToken: refreshToken || undefined
        });
        
        console.log('Google user saved/updated with tokens');
      } catch (dbError) {
        console.log('Google database save failed, continuing...');
        try {
          const existingUser = await UserModel.findByEmail(user.email);
          if (existingUser) {
            console.log('Updating Google tokens for existing user');
          }
        } catch (updateError) {
          console.error('Failed to update Google tokens:', updateError);
        }
      }
      
      return done(null, user);
    } catch (error: any) {
      console.error('Google auth error:', error);
      return done(error, false);
    }
  }));
};