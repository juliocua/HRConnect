import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
// @ts-ignore — no types for passport-microsoft
import MicrosoftStrategy from 'passport-microsoft';
import bcrypt from 'bcryptjs';
import { prisma } from './prisma';

export function setupPassport() {
  // ── Serialize / Deserialize ────────────────────────────────────────────────
  passport.serializeUser((user: any, done) => done(null, user.id));
  passport.deserializeUser(async (id: string, done) => {
    try {
      const user = await prisma.user.findUnique({ where: { id } });
      done(null, user as unknown as Express.User);
    } catch (err) {
      done(err);
    }
  });

  // ── Local (email + password) ───────────────────────────────────────────────
  passport.use(
    new LocalStrategy({ usernameField: 'email' }, async (email, password, done) => {
      try {
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.password) return done(null, false, { message: 'Invalid credentials' });
        const valid = await bcrypt.compare(password, user.password);
        if (!valid) return done(null, false, { message: 'Invalid credentials' });
        if (!user.isActive) return done(null, false, { message: 'Account is disabled' });
        return done(null, user as unknown as Express.User);
      } catch (err) {
        return done(err);
      }
    })
  );

  // ── Google OAuth ───────────────────────────────────────────────────────────
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    passport.use(
      new GoogleStrategy(
        {
          clientID: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          callbackURL: `${process.env.SERVER_URL || 'http://localhost:3001'}/api/auth/google/callback`,
        },
        async (_accessToken, _refreshToken, profile, done) => {
          try {
            const email = profile.emails?.[0]?.value;
            if (!email) return done(new Error('No email returned from Google'));

            let user = await prisma.user.findFirst({
              where: { OR: [{ email }, { provider: 'GOOGLE', providerId: profile.id }] },
            });

            if (!user) {
              user = await prisma.user.create({
                data: {
                  email,
                  name: profile.displayName,
                  provider: 'GOOGLE',
                  providerId: profile.id,
                  avatarUrl: profile.photos?.[0]?.value,
                },
              });
            } else if (user.provider === 'LOCAL') {
              // Merge: existing local user signs in with Google
              user = await prisma.user.update({
                where: { id: user.id },
                data: { provider: 'GOOGLE', providerId: profile.id },
              });
            }

            return done(null, user as unknown as Express.User);
          } catch (err) {
            return done(err as Error);
          }
        }
      )
    );
  }

  // ── Microsoft OAuth ────────────────────────────────────────────────────────
  if (process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET) {
    passport.use(
      new MicrosoftStrategy(
        {
          clientID: process.env.MICROSOFT_CLIENT_ID,
          clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
          callbackURL: `${process.env.SERVER_URL || 'http://localhost:3001'}/api/auth/microsoft/callback`,
          scope: ['user.read'],
          tenant: process.env.MICROSOFT_TENANT_ID || 'common',
        },
        async (_accessToken: string, _refreshToken: string, profile: any, done: any) => {
          try {
            const email = profile.emails?.[0]?.value || profile._json?.mail;
            if (!email) return done(new Error('No email returned from Microsoft'));

            let user = await prisma.user.findFirst({
              where: { OR: [{ email }, { provider: 'MICROSOFT', providerId: profile.id }] },
            });

            if (!user) {
              user = await prisma.user.create({
                data: {
                  email,
                  name: profile.displayName,
                  provider: 'MICROSOFT',
                  providerId: profile.id,
                },
              });
            }

            return done(null, user as unknown as Express.User);
          } catch (err) {
            return done(err);
          }
        }
      )
    );
  }
}