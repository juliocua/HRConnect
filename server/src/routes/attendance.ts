import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { prisma } from '../lib/prisma';
import { authenticate, requireRole } from '../middleware/authenticate';

// ── Attachment upload config ──────────────────────────────────────────────────
const attachmentsDir = process.env.UPLOADS_DIR
  ? path.join(process.env.UPLOADS_DIR, 'attachments')
  : path.join(process.cwd(), 'uploads', 'attachments');
if (!fs.existsSync(attachmentsDir)) fs.mkdirSync(attachmentsDir, { recursive: true });

const attachmentStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, attachmentsDir),
  filename: (req, _file, cb) => {
    const ext = path.extname(_file.originalname) || '.jpg';
    cb(null, `att-edit-${req.user?.userId ?? 'anon'}-${Date.now()}${ext}`);
  },
});
const attachmentUpload = multer({
  storage: attachmentStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/', 'application/pdf'];
    if (allowed.some(t => file.mimetype.startsWith(t))) cb(null, true);
    else cb(new Error('Only images and PDFs are allowed'));
  },
});

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
    const overtimeHrs = await computeOvertimeHrs(employeeId, now);

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
    const data: any = {
      ...rest,
      ...(timeInDt ? { timeIn: timeInDt, clockInAt: timeInDt } : {}),
      ...(timeOutDt ? { timeOut: timeOutDt, clockOutAt: timeOutDt } : {}),
    };
    // Auto-compute OT from shift policy if timeOut is provided
    if (timeOutDt) {
      data.overtimeHrs = await computeOvertimeHrs(employeeId, timeOutDt);
    }

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

// POST /api/attendance/edit-request  — employee submits a time-edit request (with optional attachment)
router.post('/edit-request', attachmentUpload.single('attachment'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { employeeId } = req.user!;
    if (!employeeId) return res.status(403).json({ error: 'No linked employee record' });

    const body = z.object({
      attendanceDate: z.string(),
      requestedTimeIn: z.string().optional(),
      requestedTimeOut: z.string().optional(),
      requestedStatus: z.string().optional(),
      reason: z.string().min(10, 'Reason must be at least 10 characters'),
    }).parse(typeof req.body === 'string' ? JSON.parse(req.body) : req.body);

    const dateStr = body.attendanceDate.slice(0, 10);
    const timeInDt = body.requestedTimeIn ? new Date(`${dateStr}T${body.requestedTimeIn}:00+08:00`) : undefined;
    const timeOutDt = body.requestedTimeOut ? new Date(`${dateStr}T${body.requestedTimeOut}:00+08:00`) : undefined;

    let attachmentUrl: string | undefined;
    if (req.file) {
      const baseUrl = process.env.SERVER_URL || `http://localhost:${process.env.PORT || 3001}`;
      attachmentUrl = `${baseUrl}/uploads/attachments/${req.file.filename}`;
    }

    const request = await (prisma as any).attendanceEditRequest.create({
      data: {
        employeeId,
        attendanceDate: new Date(body.attendanceDate),
        requestedTimeIn: timeInDt ?? null,
        requestedTimeOut: timeOutDt ?? null,
        requestedStatus: body.requestedStatus ?? null,
        reason: body.reason,
        attachmentUrl: attachmentUrl ?? null,
      },
      include: {
        employee: { select: { firstName: true, lastName: true } },
      },
    });
    res.status(201).json(request);
  } catch (err) { next(err); }
});

// GET /api/attendance/edit-requests  — HR: list PENDING edit requests
router.get('/edit-requests', requireRole('HR_MANAGER', 'HR_STAFF', 'SUPER_ADMIN'), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const requests = await (prisma as any).attendanceEditRequest.findMany({
      where: { status: 'PENDING' },
      include: {
        employee: {
          select: { id: true, firstName: true, lastName: true, position: true, avatarColor: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    res.json(requests);
  } catch (err) { next(err); }
});

// GET /api/attendance/edit-requests/me  — employee: view their own edit request history
router.get('/edit-requests/me', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { employeeId } = req.user!;
    if (!employeeId) return res.status(403).json({ error: 'No linked employee record' });
    const requests = await (prisma as any).attendanceEditRequest.findMany({
      where: { employeeId },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
    res.json(requests);
  } catch (err) { next(err); }
});

// PUT /api/attendance/edit-requests/:id/approve  — HR: apply and approve
router.put('/edit-requests/:id/approve', requireRole('HR_MANAGER', 'HR_STAFF', 'SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const editReq = await (prisma as any).attendanceEditRequest.findUnique({ where: { id: req.params.id } });
    if (!editReq) return res.status(404).json({ error: 'Edit request not found' });
    if (editReq.status !== 'PENDING') return res.status(422).json({ error: 'Request is not pending' });

    const dateStr = editReq.attendanceDate.toISOString().slice(0, 10);
    const updateData: Record<string, unknown> = {};
    if (editReq.requestedTimeIn) { updateData.timeIn = editReq.requestedTimeIn; updateData.clockInAt = editReq.requestedTimeIn; }
    if (editReq.requestedTimeOut) { updateData.timeOut = editReq.requestedTimeOut; updateData.clockOutAt = editReq.requestedTimeOut; }
    if (editReq.requestedStatus) updateData.status = editReq.requestedStatus;
    updateData.isManualEntry = true;
    updateData.manualReason = editReq.reason;
    // Auto-compute OT from shift policy when timeOut is being applied
    if (editReq.requestedTimeOut) {
      updateData.overtimeHrs = await computeOvertimeHrs(editReq.employeeId, editReq.requestedTimeOut);
    }

    await prisma.attendance.upsert({
      where: { employeeId_date: { employeeId: editReq.employeeId, date: editReq.attendanceDate } },
      update: updateData as any,
      create: { employeeId: editReq.employeeId, date: editReq.attendanceDate, status: (editReq.requestedStatus ?? 'PRESENT') as any, ...updateData as any },
    });

    const updated = await (prisma as any).attendanceEditRequest.update({
      where: { id: req.params.id },
      data: { status: 'APPROVED', reviewedById: req.user!.userId, reviewedAt: new Date() },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

// PUT /api/attendance/edit-requests/:id/reject  — HR: reject with note
router.put('/edit-requests/:id/reject', requireRole('HR_MANAGER', 'HR_STAFF', 'SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rejectionNote } = z.object({ rejectionNote: z.string().optional() }).parse(req.body);
    const editReq = await (prisma as any).attendanceEditRequest.findUnique({ where: { id: req.params.id } });
    if (!editReq) return res.status(404).json({ error: 'Edit request not found' });
    if (editReq.status !== 'PENDING') return res.status(422).json({ error: 'Request is not pending' });

    const updated = await (prisma as any).attendanceEditRequest.update({
      where: { id: req.params.id },
      data: { status: 'REJECTED', reviewedById: req.user!.userId, reviewedAt: new Date(), rejectionNote: rejectionNote ?? null },
    });
    res.json(updated);
  } catch (err) { next(err); }
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

    // Backfill overtimeHrs for legacy records where timeOut exists but overtimeHrs was never computed
    const needsBackfill = records.filter(r => r.timeOut && r.overtimeHrs == null);
    if (needsBackfill.length > 0) {
      await Promise.all(
        needsBackfill.map(async r => {
          const ot = await computeOvertimeHrs(r.employee.id, r.timeOut!);
          await prisma.attendance.update({ where: { id: r.id }, data: { overtimeHrs: ot } });
          (r as any).overtimeHrs = ot;
        })
      );
    }

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

/** Return the shift-end hour as a decimal for an employee based on their client's EMPLOYEE_SHIFT policy.
 *  Defaults to 17.0 (5:00 PM) if no policy is found. */
async function getShiftEndHours(employeeId: string): Promise<number> {
  const DEFAULT = 17.0;
  try {
    const emp = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { clientId: true },
    });
    if (!emp?.clientId) return DEFAULT;
    const policy = await prisma.clientPolicy.findFirst({
      where: { clientId: emp.clientId, type: 'EMPLOYEE_SHIFT' },
    });
    if (!policy?.value) return DEFAULT;
    const parsed = JSON.parse(policy.value) as { shiftEnd?: string };
    if (!parsed.shiftEnd) return DEFAULT;
    const [h, m] = parsed.shiftEnd.split(':').map(Number);
    return h + (m ?? 0) / 60;
  } catch {
    return DEFAULT;
  }
}

/** Compute overtime hours: max(0, timeOut_decimal_hour - shiftEnd_hour). */
async function computeOvertimeHrs(employeeId: string, timeOut: Date): Promise<number> {
  const shiftEnd = await getShiftEndHours(employeeId);
  const outHours = timeOut.getHours() + timeOut.getMinutes() / 60;
  return Math.max(0, parseFloat((outHours - shiftEnd).toFixed(2)));
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
    const data = buildAttendanceData(body) as any;
    // Auto-compute OT from shift policy if timeOut is provided
    if (body.timeOut) {
      const timeOutDt = toDateTime(body.date.slice(0, 10), body.timeOut);
      data.overtimeHrs = await computeOvertimeHrs(body.employeeId, timeOutDt);
    }
    const record = await prisma.attendance.upsert({
      where: { employeeId_date: { employeeId: data.employeeId, date: data.date } },
      update: data,
      create: { ...data, isManualEntry: true },
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
    const data: Record<string, unknown> = {
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
      ...(timeIn ? { timeIn, clockInAt: timeIn } : {}),
      ...(timeOut ? { timeOut, clockOutAt: timeOut } : {}),
    };
    // Auto-compute OT from shift policy if timeOut is being updated; otherwise use manual value
    if (timeOut) {
      const empId = body.employeeId
        ?? (await prisma.attendance.findUnique({ where: { id: req.params.id }, select: { employeeId: true } }))?.employeeId;
      if (empId) data.overtimeHrs = await computeOvertimeHrs(empId, timeOut);
    } else if (body.overtimeHrs !== undefined) {
      data.overtimeHrs = body.overtimeHrs;
    }
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
      records.map(async r => {
        const data = buildAttendanceData(r) as any;
        if (r.timeOut) {
          const timeOutDt = toDateTime(r.date.slice(0, 10), r.timeOut);
          data.overtimeHrs = await computeOvertimeHrs(r.employeeId, timeOutDt);
        }
        return prisma.attendance.upsert({
          where: { employeeId_date: { employeeId: data.employeeId, date: data.date } },
          update: data,
          create: { ...data, isManualEntry: true },
        });
      })
    );
    res.json({ count: results.length, records: results });
  } catch (err) {
    next(err);
  }
});

export default router;
