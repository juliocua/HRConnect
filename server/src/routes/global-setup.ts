import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { prisma } from '../lib/prisma';
import { requireRole } from '../middleware/authenticate';

// ── Logo upload storage ───────────────────────────────────────────────────────
const uploadsBase = process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads');
const logosDir = path.join(uploadsBase, 'logos');
if (!fs.existsSync(logosDir)) fs.mkdirSync(logosDir, { recursive: true });

const logoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, logosDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.png';
    cb(null, `company-logo${ext}`);
  },
});
const logoUpload = multer({
  storage: logoStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|gif|webp|svg\+xml)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

const router = Router();

// ── Cut-Off Periods ───────────────────────────────────────────────────────────

const CutOffPeriodSchema = z.object({
  name: z.string().min(1),
  cutOffFromDay: z.number().int().min(1).max(31),
  cutOffFromIsPrevMonth: z.boolean().default(false),
  cutOffToDay: z.number().int().min(1).max(31),
  payDay: z.number().int().min(1).max(31),
  payDayIsNextMonth: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
});

// GET /api/global-setup/cutoff-periods
router.get('/cutoff-periods', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const periods = await (prisma as any).cutOffPeriod.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    res.json(periods);
  } catch (err) {
    next(err);
  }
});

// POST /api/global-setup/cutoff-periods
router.post('/cutoff-periods', requireRole('HR_MANAGER', 'SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = CutOffPeriodSchema.parse(req.body);
    const period = await (prisma as any).cutOffPeriod.create({ data });
    res.status(201).json(period);
  } catch (err) {
    next(err);
  }
});

// PUT /api/global-setup/cutoff-periods/:id
router.put('/cutoff-periods/:id', requireRole('HR_MANAGER', 'SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = CutOffPeriodSchema.partial().parse(req.body);
    const period = await (prisma as any).cutOffPeriod.update({
      where: { id: req.params.id },
      data,
    });
    res.json(period);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/global-setup/cutoff-periods/:id
router.delete('/cutoff-periods/:id', requireRole('HR_MANAGER', 'SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Check if in use by any GlobalPayrollPolicy
    const inUse = await (prisma as any).globalPayrollPolicy.findFirst({
      where: { cutOffPeriodId: req.params.id },
    });
    if (inUse) {
      return res.status(422).json({ error: 'This cut-off period is in use by a global payroll policy and cannot be deleted.' });
    }
    await (prisma as any).cutOffPeriod.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── Global Payroll Policies ───────────────────────────────────────────────────

const POLICY_TYPES = ['SSS_DEDUCTION', 'PHIC_DEDUCTION', 'HDMF_DEDUCTION', 'TAX_DEDUCTION'] as const;

// GET /api/global-setup/payroll-policies
router.get('/payroll-policies', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const policies = await (prisma as any).globalPayrollPolicy.findMany({
      include: { cutOffPeriod: true },
    });
    res.json(policies);
  } catch (err) {
    next(err);
  }
});

// PUT /api/global-setup/payroll-policies — upsert all 4 policy types
router.put('/payroll-policies', requireRole('HR_MANAGER', 'SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      type: z.enum(POLICY_TYPES),
      cutOffPeriodId: z.string().nullable().optional(),
      splitHalf: z.boolean().optional(),
    });
    const payload = schema.parse(req.body);

    const policy = await (prisma as any).globalPayrollPolicy.upsert({
      where: { type: payload.type },
      create: {
        type: payload.type,
        cutOffPeriodId: payload.splitHalf ? null : (payload.cutOffPeriodId ?? null),
        splitHalf: payload.splitHalf ?? false,
      },
      update: {
        cutOffPeriodId: payload.splitHalf ? null : (payload.cutOffPeriodId ?? null),
        splitHalf: payload.splitHalf ?? false,
      },
      include: { cutOffPeriod: true },
    });
    res.json(policy);
  } catch (err) {
    next(err);
  }
});

// ── Company Settings ──────────────────────────────────────────────────────────

const ADMIN_FEE_TYPES = ['PERCENT_GROSS', 'FLAT_PER_EMPLOYEE', 'TIERED', 'FIXED_LUMP'] as const;

const CompanySettingsSchema = z.object({
  companyName: z.string().default(''),
  address: z.string().nullable().optional(),
  taxNumber: z.string().nullable().optional(),
  contactNumber: z.string().nullable().optional(),
  defaultShiftStart: z.string().nullable().optional(),
  defaultShiftEnd: z.string().nullable().optional(),
  // Admin fee (global)
  adminFeeType: z.enum(ADMIN_FEE_TYPES).nullable().optional(),
  adminFeeValue: z.number().min(0).nullable().optional(),
  adminFeeTiers: z.any().optional(),
  // SOA signatories (company side)
  signatoryName: z.string().nullable().optional(),
  signatoryTitle: z.string().nullable().optional(),
  // Pay computation rates
  overtimeRate: z.number().min(0).nullable().optional(),
  nightDifferentialRate: z.number().min(0).max(1).nullable().optional(),
});

// GET /api/global-setup/company-settings
router.get('/company-settings', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    let settings = await (prisma as any).companySettings.findUnique({ where: { id: 'singleton' } });
    if (!settings) {
      settings = await (prisma as any).companySettings.create({
        data: { id: 'singleton', companyName: '' },
      });
    }
    res.json(settings);
  } catch (err) {
    next(err);
  }
});

// PUT /api/global-setup/company-settings
router.put('/company-settings', requireRole('HR_MANAGER', 'SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = CompanySettingsSchema.parse(req.body);
    const settings = await (prisma as any).companySettings.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', ...data },
      update: data,
    });
    res.json(settings);
  } catch (err) {
    next(err);
  }
});

// POST /api/global-setup/company-settings/logo
router.post(
  '/company-settings/logo',
  requireRole('HR_MANAGER', 'SUPER_ADMIN'),
  logoUpload.single('logo'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      const serverUrl = process.env.SERVER_URL || '';
      const logoUrl = `${serverUrl}/uploads/logos/${req.file.filename}`;
      const settings = await (prisma as any).companySettings.upsert({
        where: { id: 'singleton' },
        create: { id: 'singleton', companyName: '', logoUrl },
        update: { logoUrl },
      });
      res.json(settings);
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /api/global-setup/company-settings/logo
router.delete('/company-settings/logo', requireRole('HR_MANAGER', 'SUPER_ADMIN'), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    // Remove file from disk
    const existing = await (prisma as any).companySettings.findUnique({ where: { id: 'singleton' } });
    if (existing?.logoUrl) {
      const filename = path.basename(existing.logoUrl);
      const filePath = path.join(logosDir, filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    const settings = await (prisma as any).companySettings.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', companyName: '' },
      update: { logoUrl: null },
    });
    res.json(settings);
  } catch (err) {
    next(err);
  }
});

// GET /api/global-setup/current-period — auto-detect current cut-off period by today's date
router.get('/current-period', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const periods = await (prisma as any).cutOffPeriod.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    const today = new Date();
    const todayDay = today.getDate();
    const todayMonth = today.getMonth(); // 0-indexed
    const todayYear = today.getFullYear();

    // Find the period whose cutOff range includes today
    const matched = periods.find((p: any) => {
      // Build cutOff from date
      const fromDate = p.cutOffFromIsPrevMonth
        ? new Date(todayMonth === 0 ? todayYear - 1 : todayYear, todayMonth === 0 ? 11 : todayMonth - 1, p.cutOffFromDay)
        : new Date(todayYear, todayMonth, p.cutOffFromDay);
      const toDate = new Date(todayYear, todayMonth, p.cutOffToDay);
      return today >= fromDate && today <= toDate;
    });

    res.json(matched ?? null);
  } catch (err) {
    next(err);
  }
});

export default router;
