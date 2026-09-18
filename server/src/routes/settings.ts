import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/authenticate';

const router = Router();

// All settings routes require authentication + SUPER_ADMIN
router.use(authenticate);
router.use((req: Request, res: Response, next: NextFunction) => {
  if (req.user?.role !== 'SUPER_ADMIN') {
    return res.status(403).json({ error: 'Forbidden: Super Admin only' });
  }
  next();
});

// ── GET /api/settings ─────────────────────────────────────────────────────────
router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await (prisma as any).appSetting.findMany();
    // Convert [{key, value}, …] → {key: value, …}
    const settings: Record<string, string> = {};
    for (const row of rows) settings[row.key] = row.value;
    res.json(settings);
  } catch (err) {
    next(err);
  }
});

// ── PUT /api/settings ─────────────────────────────────────────────────────────
const SettingsSchema = z.object({
  requireOtp: z.boolean().optional(),
});

router.put('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = SettingsSchema.parse(req.body);
    const ops: Promise<unknown>[] = [];

    if (body.requireOtp !== undefined) {
      ops.push(
        (prisma as any).appSetting.upsert({
          where: { key: 'requireOtp' },
          update: { value: String(body.requireOtp) },
          create: { key: 'requireOtp', value: String(body.requireOtp) },
        })
      );
    }

    await Promise.all(ops);

    // Return updated settings
    const rows = await (prisma as any).appSetting.findMany();
    const settings: Record<string, string> = {};
    for (const row of rows) settings[row.key] = row.value;
    res.json(settings);
  } catch (err) {
    next(err);
  }
});

export default router;
