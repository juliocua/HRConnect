import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticate, requireRole } from '../middleware/authenticate';

const router = Router();
router.use(authenticate);

// ── Employee self-service ─────────────────────────────────────────────────────

// GET /api/overtime/me — employee sees their own OT requests
router.get('/me', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { employeeId } = req.user!;
    if (!employeeId) return res.status(403).json({ error: 'No linked employee record' });

    const requests = await prisma.overtimeRequest.findMany({
      where: { employeeId },
      orderBy: { date: 'desc' },
    });
    res.json(requests);
  } catch (err) { next(err); }
});

// POST /api/overtime/me — employee files an OT request
router.post('/me', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { employeeId } = req.user!;
    if (!employeeId) return res.status(403).json({ error: 'No linked employee record' });

    const body = z.object({
      date: z.string(),
      hours: z.number().positive().max(24),
      reason: z.string().optional(),
    }).parse(req.body);

    const date = new Date(body.date);

    // Check there isn't already a pending/approved request for the same date
    const existing = await prisma.overtimeRequest.findFirst({
      where: { employeeId, date, status: { in: ['PENDING', 'APPROVED'] } },
    });
    if (existing) {
      return res.status(422).json({ error: 'An overtime request already exists for this date.' });
    }

    // Find the attendance record for that day (to link if it exists)
    const attendance = await prisma.attendance.findUnique({
      where: { employeeId_date: { employeeId, date } },
    });

    const request = await prisma.overtimeRequest.create({
      data: {
        employeeId,
        date,
        hours: body.hours,
        reason: body.reason,
        attendanceId: attendance?.id ?? null,
      },
    });
    res.status(201).json(request);
  } catch (err) { next(err); }
});

// ── HR routes ─────────────────────────────────────────────────────────────────

// GET /api/overtime — HR sees all requests (filter by status, employeeId)
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { employeeId, status } = req.query as Record<string, string>;
    const requests = await prisma.overtimeRequest.findMany({
      where: {
        ...(employeeId ? { employeeId } : {}),
        ...(status ? { status: status as any } : {}),
      },
      include: {
        employee: {
          select: { id: true, firstName: true, lastName: true, position: true, avatarColor: true },
        },
      },
      orderBy: { date: 'desc' },
    });
    res.json(requests);
  } catch (err) { next(err); }
});

// POST /api/overtime — HR files OT on behalf of employee
router.post('/', requireRole('HR_MANAGER', 'SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      employeeId: z.string(),
      date: z.string(),
      hours: z.number().positive().max(24),
      reason: z.string().optional(),
    }).parse(req.body);

    const date = new Date(body.date);

    const existing = await prisma.overtimeRequest.findFirst({
      where: { employeeId: body.employeeId, date, status: { in: ['PENDING', 'APPROVED'] } },
    });
    if (existing) {
      return res.status(422).json({ error: 'An overtime request already exists for this date.' });
    }

    const attendance = await prisma.attendance.findUnique({
      where: { employeeId_date: { employeeId: body.employeeId, date } },
    });

    const request = await prisma.overtimeRequest.create({
      data: {
        employeeId: body.employeeId,
        date,
        hours: body.hours,
        reason: body.reason,
        attendanceId: attendance?.id ?? null,
      },
      include: {
        employee: {
          select: { id: true, firstName: true, lastName: true, position: true, avatarColor: true },
        },
      },
    });
    res.status(201).json(request);
  } catch (err) { next(err); }
});

// PUT /api/overtime/:id/approve — approve and write-back attendance
router.put('/:id/approve', requireRole('HR_MANAGER', 'SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const otReq = await prisma.overtimeRequest.findUnique({ where: { id: req.params.id } });
    if (!otReq) return res.status(404).json({ error: 'Overtime request not found' });
    if (otReq.status !== 'PENDING') return res.status(422).json({ error: 'Only pending requests can be approved' });

    const [updated] = await prisma.$transaction([
      // Approve the request
      prisma.overtimeRequest.update({
        where: { id: req.params.id },
        data: { status: 'APPROVED', approvedById: req.user!.userId, approvedAt: new Date() },
        include: {
          employee: {
            select: { id: true, firstName: true, lastName: true, position: true, avatarColor: true },
          },
        },
      }),
      // Write back overtimeHrs on the linked attendance record if it exists
      ...(otReq.attendanceId
        ? [prisma.attendance.update({
            where: { id: otReq.attendanceId },
            data: { overtimeHrs: { increment: otReq.hours } },
          })]
        : []
      ),
    ]);

    res.json(updated);
  } catch (err) { next(err); }
});

// PUT /api/overtime/:id/reject
router.put('/:id/reject', requireRole('HR_MANAGER', 'SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { note } = z.object({ note: z.string().optional() }).parse(req.body);
    const otReq = await prisma.overtimeRequest.findUnique({ where: { id: req.params.id } });
    if (!otReq) return res.status(404).json({ error: 'Overtime request not found' });
    if (otReq.status !== 'PENDING') return res.status(422).json({ error: 'Only pending requests can be rejected' });

    const updated = await prisma.overtimeRequest.update({
      where: { id: req.params.id },
      data: { status: 'REJECTED', rejectedAt: new Date(), rejectionNote: note },
      include: {
        employee: {
          select: { id: true, firstName: true, lastName: true, position: true, avatarColor: true },
        },
      },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

export default router;
