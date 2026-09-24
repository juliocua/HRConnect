import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireRole } from '../middleware/authenticate';

const router = Router();

const HOLIDAY_TYPES = ['REGULAR', 'SPECIAL_NON_WORKING', 'SPECIAL_WORKING'] as const;

const HolidaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  name: z.string().min(1),
  type: z.enum(HOLIDAY_TYPES),
  year: z.number().int(),
});

// GET /api/holidays?year=YYYY
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const year = req.query.year ? parseInt(req.query.year as string, 10) : new Date().getFullYear();
    if (isNaN(year)) return res.status(422).json({ error: 'year must be a number' });

    const holidays = await (prisma as any).holiday.findMany({
      where: { year },
      orderBy: { date: 'asc' },
    });
    res.json(holidays);
  } catch (err) {
    next(err);
  }
});

// GET /api/holidays/range?start=YYYY-MM-DD&end=YYYY-MM-DD  — used by payroll
router.get('/range', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { start, end } = req.query as { start?: string; end?: string };
    if (!start || !end) return res.status(422).json({ error: 'start and end are required' });

    const holidays = await (prisma as any).holiday.findMany({
      where: {
        date: {
          gte: new Date(start),
          lte: new Date(end),
        },
      },
      orderBy: { date: 'asc' },
    });
    res.json(holidays);
  } catch (err) {
    next(err);
  }
});

// POST /api/holidays
router.post('/', requireRole('HR_MANAGER', 'SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = HolidaySchema.parse(req.body);
    const dateObj = new Date(body.date + 'T00:00:00.000Z');
    const holiday = await (prisma as any).holiday.create({
      data: {
        date: dateObj,
        name: body.name,
        type: body.type,
        year: body.year,
      },
    });
    res.status(201).json(holiday);
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return res.status(409).json({ error: 'A holiday already exists on this date. Edit the existing one.' });
    }
    next(err);
  }
});

// PUT /api/holidays/:id
router.put('/:id', requireRole('HR_MANAGER', 'SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = HolidaySchema.partial().parse(req.body);
    const data: any = { ...body };
    if (body.date) {
      data.date = new Date(body.date + 'T00:00:00.000Z');
    }
    const holiday = await (prisma as any).holiday.update({
      where: { id: req.params.id },
      data,
    });
    res.json(holiday);
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return res.status(409).json({ error: 'A holiday already exists on this date.' });
    }
    next(err);
  }
});

// DELETE /api/holidays/:id
router.delete('/:id', requireRole('HR_MANAGER', 'SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await (prisma as any).holiday.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
