import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticate, requireRole } from '../middleware/authenticate';

const router = Router();
router.use(authenticate);

// ── Employee self-service routes ───────────────────────────────────────────

// GET /api/attendance/me?startDate=2026-09-01&endDate=2026-09-30  — employee sees only their records
router.get('/me', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { employeeId } = req.user!;
    if (!employeeId) return res.status(403).json({ error: 'No linked employee record' });

    const { month, startDate, endDate } = req.query as Record<string, string>;
    let dateFilter = {};
    if (startDate || endDate) {
      const start = startDate ? new Date(startDate) : undefined;
      const end = endDate ? (() => { const d = new Date(endDate); d.setHours(23, 59, 59, 999); return d; })() : undefined;
      dateFilter = { date: { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) } };
    } else if (month) {
      const [year, m] = month.split('-').map(Number);
      const start = new Date(year, m - 1, 1);
      const end = new Date(year, m, 0, 23, 59, 59);
      dateFilter = { date: { gte: start, lte: end } };
    }

    const records = await prisma.attendance.findMany({
      where: { employeeId, ...dateFilter },
      orderBy: { date: 'desc' },
    });
    res.json(records);
  } catch (err) {
    next(err);
  }
});

// GET /api/attendance/me/today  — get today's clock status for the employee
router.get('/me/today', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { employeeId } = req.user!;
    if (!employeeId) return res.status(403).json({ error: 'No linked employee record' });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const record = await prisma.attendance.findUnique({
      where: { employeeId_date: { employeeId, date: today } },
    });
    res.json(record ?? null);
  } catch (err) {
    next(err);
  }
});

// POST /api/attendance/clock-in  — employee clocks in (real-time timestamp)
router.post('/clock-in', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { employeeId } = req.user!;
    if (!employeeId) return res.status(403).json({ error: 'No linked employee record' });

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const existing = await prisma.attendance.findUnique({
      where: { employeeId_date: { employeeId, date: today } },
    });
    if (existing?.clockInAt) {
      return res.status(409).json({ error: 'Already clocked in today' });
    }

    // Determine late status — after 09:00
    const cutoff = new Date(today);
    cutoff.setHours(9, 0, 0, 0);
    const status = now > cutoff ? 'LATE' : 'PRESENT';

    const record = await prisma.attendance.upsert({
      where: { employeeId_date: { employeeId, date: today } },
      update: { clockInAt: now, status, isManualEntry: false },
      create: {
        employeeId,
        date: today,
        clockInAt: now,
        status,
        isManualEntry: false,
      },
    });
    res.json(record);
  } catch (err) {
    next(err);
  }
});

// POST /api/attendance/clock-out  — employee clocks out
router.post('/clock-out', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { employeeId } = req.user!;
    if (!employeeId) return res.status(403).json({ error: 'No linked employee record' });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const existing = await prisma.attendance.findUnique({
      where: { employeeId_date: { employeeId, date: today } },
    });
    if (!existing?.clockInAt) {
      return res.status(409).json({ error: 'No clock-in found for today' });
    }
    if (existing.clockOutAt) {
      return res.status(409).json({ error: 'Already clocked out today' });
    }

    const now = new Date();
    const hoursWorked = (now.getTime() - existing.clockInAt.getTime()) / 3_600_000;
    const overtimeHrs = Math.max(0, parseFloat((hoursWorked - 8).toFixed(2)));

    const record = await prisma.attendance.update({
      where: { id: existing.id },
      data: { clockOutAt: now, overtimeHrs },
    });
    res.json(record);
  } catch (err) {
    next(err);
  }
});

// POST /api/attendance/manual  — employee submits manual time entry (reason required)
router.post('/manual', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { employeeId } = req.user!;
    if (!employeeId) return res.status(403).json({ error: 'No linked employee record' });

    const rawDate = (req.body as any).date as string; // keep for datetime construction
    const body = z.object({
      date: z.string().transform(d => new Date(d)),
      timeIn: z.string().optional(),
      timeOut: z.string().optional(),
      status: z.enum(['PRESENT', 'LATE', 'ABSENT', 'HALF_DAY']).default('PRESENT'),
      overtimeHrs: z.number().min(0).max(12).optional(),
      manualReason: z.string().min(10, 'Reason must be at least 10 characters'),
      notes: z.string().optional(),
    }).parse(req.body);

    // Combine date + HH:mm into proper ISO-8601 DateTime for Prisma
    const dateStr = rawDate.slice(0, 10);
    const timeInDt = body.timeIn ? new Date(`${dateStr}T${body.timeIn}:00+08:00`) : undefined;
    const timeOutDt = body.timeOut ? new Date(`${dateStr}T${body.timeOut}:00+08:00`) : undefined;
    const { timeIn: _ti, timeOut: _to, ...rest } = body;
    // Write to both timeIn/timeOut (HR attendance view) and clockInAt/clockOutAt (Hub clock view)
    const data = {
      ...rest,
      ...(timeInDt ? { timeIn: timeInDt, clockInAt: timeInDt } : {}),
      ...(timeOutDt ? { timeOut: timeOutDt, clockOutAt: timeOutDt } : {}),
    };

    const record = await prisma.attendance.upsert({
      where: { employeeId_date: { employeeId, date: body.date } },
      update: { ...data as any, isManualEntry: true },
      create: { ...data as any, employeeId, isManualEntry: true },
    });
    res.status(201).json(record);
  } catch (err) {
    next(err);
  }
});

// ── HR / Admin routes ──────────────────────────────────────────────────────

// GET /api/attendance?startDate=2026-09-01&endDate=2026-09-30&employeeId=xxx&clientId=yyy
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { employeeId, date, month, startDate, endDate, clientId } = req.query as Record<string, string>;

    let dateFilter = {};
    if (startDate || endDate) {
      const start = startDate ? new Date(startDate) : undefined;
      const end = endDate ? (() => { const d = new Date(endDate); d.setHours(23, 59, 59, 999); return d; })() : undefined;
      dateFilter = { date: { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) } };
    } else if (date) {
      const d = new Date(date);
      d.setHours(0, 0, 0, 0);
      const end = new Date(date);
      end.setHours(23, 59, 59, 999);
      dateFilter = { date: { gte: d, lte: end } };
    } else if (month) {
      const [year, m] = month.split('-').map(Number);
      const start = new Date(year, m - 1, 1);
      const end = new Date(year, m, 0, 23, 59, 59);
      dateFilter = { date: { gte: start, lte: end } };
    }

    const records = await prisma.attendance.findMany({
      where: {
        ...(employeeId ? { employeeId } : {}),
        ...(clientId ? { employee: { clientId } } : {}),
        ...dateFilter,
      },
      include: {
        employee: {
          select: {
            id: true, firstName: true, lastName: true, position: true, avatarColor: true,
            client: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: [{ date: 'desc' }, { employee: { lastName: 'asc' } }],
    });
    res.json(records);
  } catch (err) {
    next(err);
  }
});

// POST /api/attendance  (HR logs a single record)
const AttendanceSchema = z.object({
  employeeId: z.string(),
  date: z.string(),
  // timeIn / timeOut come in as "HH:MM" (from <input type="time">); kept as strings here,
  // combined with the date into a proper UTC datetime in the route handler.
  timeIn: z.string().optional(),
  timeOut: z.string().optional(),
  status: z.enum(['PRESENT', 'LATE', 'ABSENT', 'HALF_DAY', 'ON_LEAVE', 'HOLIDAY', 'WEEKEND']),
  overtimeHrs: z.number().optional(),
  notes: z.string().optional(),
});

/** Convert a "YYYY-MM-DD" date string + "HH:MM" time string to a Date (PST = UTC+8). */
function toDateTime(dateStr: string, timeStr: string): Date {
  return new Date(`${dateStr.slice(0, 10)}T${timeStr}:00+08:00`);
}

function buildAttendanceData(body: z.infer<typeof AttendanceSchema>) {
  const dateStr = body.date.slice(0, 10);
  const date = new Date(body.date);
  const timeIn = body.timeIn ? toDateTime(dateStr, body.timeIn) : undefined;
  const timeOut = body.timeOut ? toDateTime(dateStr, body.timeOut) : undefined;
  return {
    employeeId: body.employeeId,
    date,
    status: body.status,
    overtimeHrs: body.overtimeHrs,
    notes: body.notes ?? '',
    ...(timeIn ? { timeIn, clockInAt: timeIn } : {}),
    ...(timeOut ? { timeOut, clockOutAt: timeOut } : {}),
  };
}

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = AttendanceSchema.parse(req.body);
    const data = buildAttendanceData(body);
    const record = await prisma.attendance.upsert({
      where: { employeeId_date: { employeeId: data.employeeId, date: data.date } },
      update: data as any,
      create: { ...data as any, isManualEntry: true },
    });
    res.status(201).json(record);
  } catch (err) {
    next(err);
  }
});

// PUT /api/attendance/:id
router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = AttendanceSchema.partial().parse(req.body);
    const dateStr = (body.date ?? '').slice(0, 10);
    const timeIn = body.timeIn && dateStr ? toDateTime(dateStr, body.timeIn) : undefined;
    const timeOut = body.timeOut && dateStr ? toDateTime(dateStr, body.timeOut) : undefined;
    const data = {
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.overtimeHrs !== undefined ? { overtimeHrs: body.overtimeHrs } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
      ...(timeIn ? { timeIn, clockInAt: timeIn } : {}),
      ...(timeOut ? { timeOut, clockOutAt: timeOut } : {}),
    };
    const record = await prisma.attendance.update({
      where: { id: req.params.id },
      data: data as any,
    });
    res.json(record);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/attendance/:id
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.attendance.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/attendance/bulk  — bulk upsert for a pay period
router.post('/bulk', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { records } = z.object({ records: z.array(AttendanceSchema) }).parse(req.body);
    const results = await Promise.all(
      records.map(r =>
        prisma.attendance.upsert({
          where: { employeeId_date: { employeeId: r.employeeId, date: r.date } },
          update: r as any,
          create: r as any,
        })
      )
    );
    res.json({ count: results.length, records: results });
  } catch (err) {
    next(err);
  }
});

export default router;
