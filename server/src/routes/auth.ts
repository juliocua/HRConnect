import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { signToken } from '../lib/jwt';
import { authenticate } from '../middleware/authenticate';

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  const last4 = digits.slice(-4);
  return `•••• ••• ${last4}`;
}

async function sendOtpSms(to: string, code: string): Promise<void> {
  const apiKey = process.env.SEMAPHORE_API_KEY;
  if (!apiKey) throw new Error('SEMAPHORE_API_KEY not configured');

  // Normalize: +639XXXXXXXXX → 09XXXXXXXXX (Semaphore accepts PH format)
  const number = to.startsWith('+63') ? '0' + to.slice(3) : to;

  const res = await fetch('https://api.semaphore.co/api/v4/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apikey: apiKey,
      number,
      message: `Your HRConnect login code is: ${code}. It expires in 5 minutes. Do not share this with anyone.`,
      sendername: process.env.SEMAPHORE_SENDER_NAME ?? 'SEMAPHORE',
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Semaphore SMS failed (${res.status}): ${text}`);
  }
}

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
// Accepts email OR employee code (e.g. EMP-0000000001) as the identifier.
// Employees get a 2-step OTP flow; HR/admin roles get a JWT immediately.
router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const raw = z.object({
      identifier: z.string().optional(),
      email: z.string().optional(), // legacy alias — AuthContext may still send email
      password: z.string().min(1),
    }).parse(req.body);
    const identifier = raw.identifier ?? raw.email ?? '';
    const { password } = raw;
    if (!identifier) return res.status(400).json({ error: 'identifier or email is required' });

    // Find user by email or by linked employee code
    let user = await prisma.user.findUnique({
      where: { email: identifier },
      include: { employee: { select: { id: true, phone: true, employeeNo: true } } },
    });

    if (!user) {
      // Try employee code lookup
      const emp = await prisma.employee.findFirst({
        where: { employeeNo: { equals: identifier, mode: 'insensitive' } },
        include: { user: { include: { employee: { select: { id: true, phone: true, employeeNo: true } } } } },
      });
      if (emp?.user) user = emp.user as any;
    }

    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    if (!user.isActive) return res.status(401).json({ error: 'Account is deactivated. Contact HR.' });
    if (!user.password) return res.status(401).json({ error: 'Password login not available for this account' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    // Non-employees: return JWT immediately
    if (user.role !== 'EMPLOYEE') {
      const token = signToken({
        userId: user.id,
        email: user.email,
        role: user.role,
        employeeId: user.employeeId ?? undefined,
      });
      return res.json({
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
    }

    // EMPLOYEE role: 2-step OTP via SMS (Semaphore)
    const phone = (user as any).employee?.phone;
    if (!phone) {
      return res.status(422).json({ error: 'No mobile number on file. Contact HR to update your employee record.' });
    }

    const code = generateOtp();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    await (prisma as any).otpCode.upsert({
      where: { userId: user.id },
      update: { code, expiresAt },
      create: { userId: user.id, code, expiresAt },
    });

    try {
      await sendOtpSms(phone, code);
    } catch (smsErr: any) {
      console.error('OTP SMS failed:', smsErr?.message ?? smsErr);
      return res.status(500).json({ error: 'Failed to send OTP SMS. Please try again or contact HR.' });
    }

    return res.json({ requiresOtp: true, userId: user.id, maskedPhone: maskPhone(phone) });
  } catch (err) {
    next(err);
  }
});

// ── Verify OTP ────────────────────────────────────────────────────────────────
router.post('/verify-otp', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId, code } = z.object({
      userId: z.string().min(1),
      code: z.string().length(6),
    }).parse(req.body);

    const otp = await (prisma as any).otpCode.findUnique({ where: { userId } });
    if (!otp) return res.status(401).json({ error: 'No OTP found. Please log in again.' });
    if (new Date() > otp.expiresAt) {
      await (prisma as any).otpCode.delete({ where: { userId } });
      return res.status(401).json({ error: 'OTP has expired. Please log in again.' });
    }
    if (otp.code !== code) return res.status(401).json({ error: 'Incorrect OTP' });

    // Consume the OTP
    await (prisma as any).otpCode.delete({ where: { userId } });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) return res.status(401).json({ error: 'User not found or inactive' });

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
  } catch (err) {
    next(err);
  }
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

export default router;
