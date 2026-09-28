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
      include: {
        employee: {
          select: {
            id: true, firstName: true, lastName: true, position: true, avatarColor: true,
            client: { select: { id: true, name: true } },
          },
        },
      },
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

    const { branchId } = req.body as { branchId?: string | null };

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const existing = await prisma.attendance.findUnique({
      where: { employeeId_date: { employeeId, date: today } },
    });
    if (existing?.clockInAt) {
      return res.status(409).json({ error: 'Already clocked in today' });
    }

    // Determine late status + lateMinutes from shift start policy (default 08:00 PHT)
    const { status, lateMinutes } = await computeStatusFromTimeIn(employeeId, now, 'PRESENT');

    // Resolve branchId: use provided override, or fall back to employee's default branch
    let resolvedBranchId: string | null = branchId ?? null;
    if (!resolvedBranchId) {
      const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { branchId: true } });
      resolvedBranchId = emp?.branchId ?? null;
    }

    const record = await prisma.attendance.upsert({
      where: { employeeId_date: { employeeId, date: today } },
      update: { clockInAt: now, status: status as any, lateMinutes, isManualEntry: false, branchId: resolvedBranchId },
      create: {
        employeeId,
        date: today,
        clockInAt: now,
        status: status as any,
        lateMinutes,
        isManualEntry: false,
        branchId: resolvedBranchId,
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
    // Auto-detect LATE and store lateMinutes when timeIn is provided
    if (timeInDt && (data.status === 'PRESENT' || data.status === 'LATE')) {
      const result = await computeStatusFromTimeIn(employeeId, timeInDt, data.status);
      data.status = result.status;
      data.lateMinutes = result.lateMinutes;
    }
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
    // Auto-detect LATE and store lateMinutes when timeIn is being applied
    if (editReq.requestedTimeIn) {
      const effectiveStatus = ((updateData.status as string | undefined) ?? 'PRESENT');
      if (effectiveStatus === 'PRESENT' || effectiveStatus === 'LATE') {
        const result = await computeStatusFromTimeIn(editReq.employeeId, new Date(editReq.requestedTimeIn), effectiveStatus);
        updateData.status = result.status;
        updateData.lateMinutes = result.lateMinutes;
      }
    }
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
  branchId: z.string().nullable().optional(),
});

/** Convert a "YYYY-MM-DD" date string + "HH:MM" time string to a Date (PST = UTC+8). */
function toDateTime(dateStr: string, timeStr: string): Date {
  return new Date(`${dateStr.slice(0, 10)}T${timeStr}:00+08:00`);
}

/** Return the shift-end hour as a decimal for an employee based on their client's WORK_HOURS policy.
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
      where: { clientId: emp.clientId, type: 'WORK_HOURS' },
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

/** Compute overtime hours: max(0, timeOut_decimal_hour - shiftEnd_hour).
 *  Always uses UTC+8 (PHT) — Railway server runs UTC so getHours() would return
 *  the UTC hour, not the Philippine local hour. */
async function computeOvertimeHrs(employeeId: string, timeOut: Date): Promise<number> {
  const shiftEnd = await getShiftEndHours(employeeId);
  const outHours = ((timeOut.getUTCHours() + 8) % 24) + timeOut.getUTCMinutes() / 60;
  return Math.max(0, parseFloat((outHours - shiftEnd).toFixed(2)));
}

/** Auto-determine PRESENT vs LATE from timeIn vs client shift start (WORK_HOURS policy, default 08:00 PHT).
 *  Returns the computed status AND the lateMinutes so callers can store both in one shot.
 *  Leaves non-time statuses (ABSENT, HALF_DAY, ON_LEAVE, etc.) unchanged (lateMinutes = 0). */
async function computeStatusFromTimeIn(
  employeeId: string, timeIn: Date, currentStatus: string,
): Promise<{ status: string; lateMinutes: number }> {
  if (currentStatus !== 'PRESENT' && currentStatus !== 'LATE') return { status: currentStatus, lateMinutes: 0 };
  try {
    const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { clientId: true } });
    let shiftHour = 8, shiftMin = 0;
    if (emp?.clientId) {
      const policy = await prisma.clientPolicy.findFirst({
        where: { clientId: emp.clientId, type: 'WORK_HOURS' },
        select: { value: true },
      });
      if (policy?.value) {
        const parsed = JSON.parse(policy.value) as { shiftStart?: string };
        if (parsed.shiftStart) [shiftHour, shiftMin] = parsed.shiftStart.split(':').map(Number);
      }
    }
    // Compare in PHT (UTC+8)
    const inDecimal = ((timeIn.getUTCHours() + 8) % 24) + timeIn.getUTCMinutes() / 60;
    const shiftDecimal = shiftHour + shiftMin / 60;
    const lateMinutes = Math.max(0, parseFloat(((inDecimal - shiftDecimal) * 60).toFixed(2)));
    const status = inDecimal > shiftDecimal ? 'LATE' : 'PRESENT';
    return { status, lateMinutes };
  } catch {
    return { status: currentStatus, lateMinutes: 0 };
  }
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
    ...(body.branchId !== undefined ? { branchId: body.branchId } : {}),
    ...(timeIn ? { timeIn, clockInAt: timeIn } : {}),
    ...(timeOut ? { timeOut, clockOutAt: timeOut } : {}),
  };
}

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = AttendanceSchema.parse(req.body);
    const data = buildAttendanceData(body) as any;
    // Auto-detect LATE vs PRESENT from timeIn vs shift start; store lateMinutes on the record
    if (body.timeIn && (body.status === 'PRESENT' || body.status === 'LATE')) {
      const timeInDt = toDateTime(body.date.slice(0, 10), body.timeIn);
      const result = await computeStatusFromTimeIn(body.employeeId, timeInDt, body.status);
      data.status = result.status;
      data.lateMinutes = result.lateMinutes;
    }
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
    // Always fetch the existing record for date, employeeId, and status fallbacks
    const existingRecord = await prisma.attendance.findUnique({
      where: { id: req.params.id },
      select: { date: true, employeeId: true, status: true },
    });
    let dateStr = (body.date ?? '').slice(0, 10);
    if (!dateStr && existingRecord?.date) dateStr = existingRecord.date.toISOString().slice(0, 10);
    const timeIn  = body.timeIn  && dateStr ? toDateTime(dateStr, body.timeIn)  : undefined;
    const timeOut = body.timeOut && dateStr ? toDateTime(dateStr, body.timeOut) : undefined;
    const data: Record<string, unknown> = {
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
      ...(body.branchId !== undefined ? { branchId: body.branchId } : {}),
      ...(timeIn ? { timeIn, clockInAt: timeIn } : {}),
      ...(timeOut ? { timeOut, clockOutAt: timeOut } : {}),
    };
    // Auto-detect LATE vs PRESENT if timeIn is being updated; store lateMinutes on the record
    if (timeIn) {
      const empId = body.employeeId ?? existingRecord?.employeeId;
      if (empId) {
        const effectiveStatus = (data.status as string | undefined) ?? existingRecord?.status ?? 'PRESENT';
        if (effectiveStatus === 'PRESENT' || effectiveStatus === 'LATE') {
          const result = await computeStatusFromTimeIn(empId, timeIn, effectiveStatus);
          data.status = result.status;
          data.lateMinutes = result.lateMinutes;
        }
      }
    }
    // Auto-compute OT from shift policy if timeOut is being updated; otherwise use manual value
    if (timeOut) {
      const empId = body.employeeId ?? existingRecord?.employeeId;
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

// ── DTR CSV export ────────────────────────────────────────────────────────────
// GET /api/attendance/export?start=YYYY-MM-DD&end=YYYY-MM-DD&clientId=
router.get('/export', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { start, end, clientId, employeeId } = req.query as Record<string, string>;
    if (!start || !end) return res.status(400).json({ error: 'start and end dates are required' });

    const startDate = new Date(start + 'T00:00:00');
    const endDate   = new Date(end   + 'T23:59:59');

    const where: Record<string, unknown> = { date: { gte: startDate, lte: endDate } };
    if (employeeId) where.employeeId = employeeId;
    if (clientId) where.employee = { clientId };

    const records = await prisma.attendance.findMany({
      where: where as any,
      orderBy: [{ date: 'asc' }, { employee: { lastName: 'asc' } }],
      include: {
        employee: {
          select: {
            id: true, employeeNo: true, firstName: true, lastName: true,
            client: { select: { name: true } },
          },
        },
      },
    });

    const fmt = (dt: Date | null | undefined) =>
      dt ? dt.toISOString().slice(11, 16) : '';

    const header = 'EmployeeID,EmployeeNo,LastName,FirstName,Client,Date,Status,TimeIn,TimeOut,OvertimeHrs,LateMinutes,Notes';
    const rows = records.map(r =>
      [
        r.employee.id,
        r.employee.employeeNo,
        r.employee.lastName,
        r.employee.firstName,
        r.employee.client?.name ?? '',
        r.date.toISOString().slice(0, 10),
        r.status,
        fmt(r.timeIn),
        fmt(r.timeOut),
        r.overtimeHrs ?? 0,
        r.lateMinutes ?? 0,
        (r.notes ?? '').replace(/,/g, ';'),
      ].join(',')
    );

    const csv = [header, ...rows].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="dtr-${start}-to-${end}.csv"`);
    res.send(csv);
  } catch (err) { next(err); }
});

// ── DTR CSV template download ─────────────────────────────────────────────────
// GET /api/attendance/export/template
router.get('/export/template', (_req: Request, res: Response) => {
  const header = 'EmployeeID,EmployeeNo,LastName,FirstName,Client,Date,Status,TimeIn,TimeOut,OvertimeHrs,LateMinutes,Notes';
  const example = ',EMP-001,Dela Cruz,Juan,Acme Corp,2026-09-01,PRESENT,08:00,17:00,0,0,';
  const csv = [header, example].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="dtr-template.csv"');
  res.send(csv);
});

// ── DTR CSV import ────────────────────────────────────────────────────────────
// POST /api/attendance/import  — multipart: file field "csv"
const csvUploadStorage = multer.memoryStorage();
const csvUpload = multer({
  storage: csvUploadStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) cb(null, true);
    else cb(new Error('Only CSV files are allowed'));
  },
});

const VALID_STATUSES = ['PRESENT','LATE','ABSENT','HALF_DAY','ON_LEAVE','HOLIDAY','WEEKEND'] as const;

router.post('/import', csvUpload.single('csv'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No CSV file uploaded' });

    const text = req.file.buffer.toString('utf-8');
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return res.status(400).json({ error: 'CSV has no data rows' });

    // Parse header (case-insensitive)
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    const col = (name: string) => headers.indexOf(name);

    const idxEmpId     = col('employeeid');
    const idxEmpNo     = col('employeeno');
    const idxDate      = col('date');
    const idxStatus    = col('status');
    const idxTimeIn    = col('timein');
    const idxTimeOut   = col('timeout');
    const idxOTHrs     = col('overtimehrs');
    const idxLate      = col('lateminutes');
    const idxNotes     = col('notes');

    if (idxDate < 0 || idxStatus < 0) {
      return res.status(400).json({ error: 'CSV must have Date and Status columns' });
    }
    if (idxEmpId < 0 && idxEmpNo < 0) {
      return res.status(400).json({ error: 'CSV must have EmployeeID or EmployeeNo column' });
    }

    // Load all active employees for lookup
    const allEmployees = await prisma.employee.findMany({
      where: { status: { in: ['ACTIVE', 'ON_LEAVE'] } },
      select: { id: true, employeeNo: true },
    });
    const byId  = new Map(allEmployees.map(e => [e.id, e.id]));
    const byNo  = new Map(allEmployees.map(e => [e.employeeNo.toLowerCase(), e.id]));

    const errors: string[] = [];
    const toUpsert: Array<{
      employeeId: string; date: Date; status: string;
      timeIn?: Date; timeOut?: Date;
      overtimeHrs: number; lateMinutes: number; notes?: string;
    }> = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      const get = (idx: number) => (idx >= 0 ? (cols[idx] ?? '').trim() : '');

      const rawEmpId = get(idxEmpId);
      const rawEmpNo = get(idxEmpNo);
      const rawDate  = get(idxDate);
      const rawStatus = get(idxStatus).toUpperCase();

      // Resolve employee
      let resolvedId: string | undefined;
      if (rawEmpId) resolvedId = byId.get(rawEmpId);
      if (!resolvedId && rawEmpNo) resolvedId = byNo.get(rawEmpNo.toLowerCase());
      if (!resolvedId) { errors.push(`Row ${i + 1}: employee not found (ID="${rawEmpId}", No="${rawEmpNo}")`); continue; }

      // Validate date
      if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) { errors.push(`Row ${i + 1}: invalid date "${rawDate}"`); continue; }
      const date = new Date(rawDate + 'T00:00:00');
      if (isNaN(date.getTime())) { errors.push(`Row ${i + 1}: invalid date "${rawDate}"`); continue; }

      // Validate status
      if (!VALID_STATUSES.includes(rawStatus as any)) {
        errors.push(`Row ${i + 1}: unknown status "${rawStatus}"`); continue;
      }

      const toDateTime = (dateStr: string, timeStr: string) => {
        if (!timeStr || !/^\d{1,2}:\d{2}$/.test(timeStr)) return undefined;
        const dt = new Date(`${dateStr}T${timeStr}:00`);
        return isNaN(dt.getTime()) ? undefined : dt;
      };

      toUpsert.push({
        employeeId: resolvedId,
        date,
        status: rawStatus,
        timeIn:  toDateTime(rawDate, get(idxTimeIn)),
        timeOut: toDateTime(rawDate, get(idxTimeOut)),
        overtimeHrs: parseFloat(get(idxOTHrs)) || 0,
        lateMinutes: parseFloat(get(idxLate))  || 0,
        notes: get(idxNotes) || undefined,
      });
    }

    if (errors.length > 0 && toUpsert.length === 0) {
      return res.status(422).json({ error: 'No valid rows found', details: errors });
    }

    // Upsert all valid rows
    let upserted = 0;
    for (const row of toUpsert) {
      await prisma.attendance.upsert({
        where: { employeeId_date: { employeeId: row.employeeId, date: row.date } },
        update: {
          status: row.status as any,
          timeIn: row.timeIn ?? null,
          timeOut: row.timeOut ?? null,
          overtimeHrs: row.overtimeHrs,
          lateMinutes: row.lateMinutes,
          notes: row.notes ?? null,
          isManualEntry: true,
        },
        create: {
          employeeId: row.employeeId,
          date: row.date,
          status: row.status as any,
          timeIn: row.timeIn ?? null,
          timeOut: row.timeOut ?? null,
          overtimeHrs: row.overtimeHrs,
          lateMinutes: row.lateMinutes,
          notes: row.notes ?? null,
          isManualEntry: true,
        },
      });
      upserted++;
    }

    res.json({ upserted, skipped: errors.length, errors: errors.slice(0, 20) });
  } catch (err) { next(err); }
});

// POST /api/attendance/bulk  — bulk upsert for a pay period
router.post('/bulk', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { records } = z.object({ records: z.array(AttendanceSchema) }).parse(req.body);
    const results = await Promise.all(
      records.map(async r => {
        const data = buildAttendanceData(r) as any;
        if (r.timeIn && (r.status === 'PRESENT' || r.status === 'LATE')) {
          const timeInDt = toDateTime(r.date.slice(0, 10), r.timeIn);
          const result = await computeStatusFromTimeIn(r.employeeId, timeInDt, r.status);
          data.status = result.status;
          data.lateMinutes = result.lateMinutes;
        }
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
