import { Router, Request, Response, NextFunction } from 'express';
import passport from 'passport';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { signToken } from '../lib/jwt';
import { authenticate } from '../middleware/authenticate';

const router = Router();
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

// ── Register ──────────────────────────────────────────────────────────────────
const RegisterSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
});

router.post('/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = RegisterSchema.parse(req.body);
    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const hashed = await bcrypt.hash(body.password, 12);
    const user = await prisma.user.create({
      data: { name: body.name, email: body.email, password: hashed },
    });

    const token = signToken({ userId: user.id, email: user.email, role: user.role });
    res.status(201).json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    next(err);
  }
});

// ── Login ─────────────────────────────────────────────────────────────────────
router.post('/login', (req: Request, res: Response, next: NextFunction) => {
  passport.authenticate('local', { session: false }, (err: any, user: any, info: any) => {
    if (err) return next(err);
    if (!user) return res.status(401).json({ error: info?.message || 'Invalid credentials' });

    const token = signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      employeeId: user.employeeId ?? undefined,
    });
    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatarUrl: user.avatarUrl,
        employeeId: user.employeeId ?? null,
      },
    });
  })(req, res, next);
});

// ── Me ────────────────────────────────────────────────────────────────────────
router.get('/me', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { id: true, name: true, email: true, role: true, avatarUrl: true, provider: true, employeeId: true },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    next(err);
  }
});

// ── Change Password ───────────────────────────────────────────────────────────
router.post('/change-password', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { currentPassword, newPassword } = z.object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(8, 'New password must be at least 8 characters'),
    }).parse(req.body);

    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.password) return res.status(422).json({ error: 'Password change is not available for OAuth accounts' });

    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });

    const hashed = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: user.id }, data: { password: hashed } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── Google OAuth ──────────────────────────────────────────────────────────────
router.get('/google', (req: Request, res: Response, next: NextFunction) => {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.redirect(`${CLIENT_URL}/login?error=oauth_not_configured`);
  }
  passport.authenticate('google', { scope: ['profile', 'email'], session: false })(req, res, next);
});

router.get(
  '/google/callback',
  (req: Request, res: Response, next: NextFunction) => {
    if (!process.env.GOOGLE_CLIENT_ID) {
      return res.redirect(`${CLIENT_URL}/login?error=oauth_not_configured`);
    }
    passport.authenticate('google', {
      session: false,
      failureRedirect: `${CLIENT_URL}/login?error=oauth`,
    })(req, res, next);
  },
  (req: Request, res: Response) => {
    const user = req.user as any;
    const token = signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      employeeId: user.employeeId ?? undefined,
    });
    res.redirect(`${CLIENT_URL}/auth/callback?token=${token}`);
  }
);

// ── Microsoft OAuth ───────────────────────────────────────────────────────────
router.get('/microsoft', (req: Request, res: Response, next: NextFunction) => {
  if (!process.env.MICROSOFT_CLIENT_ID) {
    return res.redirect(`${CLIENT_URL}/login?error=oauth_not_configured`);
  }
  passport.authenticate('microsoft', { session: false })(req, res, next);
});

router.get(
  '/microsoft/callback',
  (req: Request, res: Response, next: NextFunction) => {
    if (!process.env.MICROSOFT_CLIENT_ID) {
      return res.redirect(`${CLIENT_URL}/login?error=oauth_not_configured`);
    }
    passport.authenticate('microsoft', {
      session: false,
      failureRedirect: `${CLIENT_URL}/login?error=oauth`,
    })(req, res, next);
  },
  (req: Request, res: Response) => {
    const user = req.user as any;
    const token = signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      employeeId: user.employeeId ?? undefined,
    });
    res.redirect(`${CLIENT_URL}/auth/callback?token=${token}`);
  }
);

export default router;