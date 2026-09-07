import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/authenticate';

const router = Router();
router.use(authenticate);

// GET /api/leave/types
router.get('/types', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const types = await prisma.leaveType.findMany({ orderBy: { code: 'asc' } });
    res.json(types);
  } catch (err) {
    next(err);
  }
});

// GET /api/leave/me  — employee sees their own leave requests
router.get('/me', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { employeeId } = req.user!;
    if (!employeeId) return res.status(403).json({ error: 'No linked employee record' });

    const requests = await prisma.leaveRequest.findMany({
      where: { employeeId },
      include: { leaveType: true },
      orderBy: { filedAt: 'desc' },
    });
    res.json(requests);
  } catch (err) {
    next(err);
  }
});

// GET /api/leave/me/balances  — employee sees their own balances
router.get('/me/balances', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { employeeId } = req.user!;
    if (!employeeId) return res.status(403).json({ error: 'No linked employee record' });

    const year = parseInt(req.query.year as string) || new Date().getFullYear();
    const balances = await prisma.leaveBalance.findMany({
      where: { employeeId, year },
      include: { leaveType: true },
    });
    res.json(balances);
  } catch (err) {
    next(err);
  }
});

// POST /api/leave/me  — employee files a leave request for themselves
router.post('/me', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { employeeId } = req.user!;
    if (!employeeId) return res.status(403).json({ error: 'No linked employee record' });

    const body = z.object({
      leaveTypeId: z.string(),
      startDate: z.string().transform(d => new Date(d)),
      endDate: z.string().transform(d => new Date(d)),
      totalDays: z.number().int().positive(),
      reason: z.string().optional(),
    }).parse(req.body);

    // Check leave balance
    const year = body.startDate.getFullYear();
    const balance = await prisma.leaveBalance.findUnique({
      where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId: body.leaveTypeId, year } },
    });
    if (balance) {
      const available = balance.totalDays - balance.usedDays - balance.pendingDays;
      if (body.totalDays > available) {
        return res.status(422).json({ error: `Insufficient leave balance. Available: ${available} days.` });
      }
      await prisma.leaveBalance.update({
        where: { id: balance.id },
        data: { pendingDays: { increment: body.totalDays } },
      });
    }

    const request = await prisma.leaveRequest.create({
      data: { ...body as any, employeeId },
      include: { leaveType: true },
    });
    res.status(201).json(request);
  } catch (err) {
    next(err);
  }
});

// GET /api/leave?employeeId=&status=PENDING
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { employeeId, status } = req.query as Record<string, string>;
    const requests = await prisma.leaveRequest.findMany({
      where: {
        ...(employeeId ? { employeeId } : {}),
        ...(status ? { status: status as any } : {}),
      },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, position: true, avatarColor: true } },
        leaveType: true,
      },
      orderBy: { filedAt: 'desc' },
    });
    res.json(requests);
  } catch (err) {
    next(err);
  }
});

// GET /api/leave/balances/:employeeId
router.get('/balances/:employeeId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const year = parseInt(req.query.year as string) || new Date().getFullYear();
    const balances = await prisma.leaveBalance.findMany({
      where: { employeeId: req.params.employeeId, year },
      include: { leaveType: true },
    });
    res.json(balances);
  } catch (err) {
    next(err);
  }
});

// POST /api/leave
const LeaveRequestSchema = z.object({
  employeeId: z.string(),
  leaveTypeId: z.string(),
  startDate: z.string().transform(d => new Date(d)),
  endDate: z.string().transform(d => new Date(d)),
  totalDays: z.number().int().positive(),
  reason: z.string().optional(),
});

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = LeaveRequestSchema.parse(req.body);

    // Check leave balance
    const year = body.startDate.getFullYear();
    const balance = await prisma.leaveBalance.findUnique({
      where: { employeeId_leaveTypeId_year: { employeeId: body.employeeId, leaveTypeId: body.leaveTypeId, year } },
    });
    if (balance) {
      const available = balance.totalDays - balance.usedDays - balance.pendingDays;
      if (body.totalDays > available) {
        return res.status(422).json({ error: `Insufficient leave balance. Available: ${available} days.` });
      }
      // Reserve pending days
      await prisma.leaveBalance.update({
        where: { id: balance.id },
        data: { pendingDays: { increment: body.totalDays } },
      });
    }

    const request = await prisma.leaveRequest.create({
      data: body as any,
      include: { employee: true, leaveType: true },
    });
    res.status(201).json(request);
  } catch (err) {
    next(err);
  }
});

// PUT /api/leave/:id/approve
router.put('/:id/approve', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const request = await prisma.leaveRequest.findUnique({ where: { id: req.params.id } });
    if (!request) return res.status(404).json({ error: 'Leave request not found' });
    if (request.status !== 'PENDING') return res.status(422).json({ error: 'Can only approve pending requests' });

    const year = request.startDate.getFullYear();

    const [updated] = await prisma.$transaction([
      prisma.leaveRequest.update({
        where: { id: req.params.id },
        data: { status: 'APPROVED', approvedById: req.user!.userId, approvedAt: new Date() },
        include: { employee: true, leaveType: true },
      }),
      prisma.leaveBalance.updateMany({
        where: { employeeId: request.employeeId, leaveTypeId: request.leaveTypeId, year },
        data: {
          usedDays: { increment: request.totalDays },
          pendingDays: { decrement: request.totalDays },
        },
      }),
    ]);

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// PUT /api/leave/:id/reject
router.put('/:id/reject', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({ note: z.string().optional(), rejectionNote: z.string().optional() }).parse(req.body);
    const note = body.rejectionNote ?? body.note;
    const request = await prisma.leaveRequest.findUnique({ where: { id: req.params.id } });
    if (!request) return res.status(404).json({ error: 'Leave request not found' });
    if (request.status !== 'PENDING') return res.status(422).json({ error: 'Can only reject pending requests' });

    const year = request.startDate.getFullYear();

    const [updated] = await prisma.$transaction([
      prisma.leaveRequest.update({
        where: { id: req.params.id },
        data: { status: 'REJECTED', rejectedAt: new Date(), rejectionNote: note },
        include: { employee: true, leaveType: true },
      }),
      prisma.leaveBalance.updateMany({
        where: { employeeId: request.employeeId, leaveTypeId: request.leaveTypeId, year },
        data: { pendingDays: { decrement: request.totalDays } },
      }),
    ]);

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

export default router;
