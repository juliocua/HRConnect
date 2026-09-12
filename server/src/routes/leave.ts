import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticate, requireRole } from '../middleware/authenticate';

const router = Router();
router.use(authenticate);

// ── Leave Type admin CRUD ─────────────────────────────────────────────────────

const LeaveTypeSchema = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1),
  daysPerYear: z.number().int().min(0),
  isPaid: z.boolean().default(true),
  legalBasis: z.string().optional().nullable(),
  applicableGender: z.enum(['ALL', 'MALE', 'FEMALE']).default('ALL'),
  resetsAnnually: z.boolean().default(true),
  accruesMonthly: z.boolean().default(false),
  isManual: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

// GET /api/leave/types?employeeId= — list active leave types (optionally filtered by gender)
router.get('/types', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { employeeId } = req.query as Record<string, string>;
    let employeeGender: string | null = null;

    if (employeeId) {
      const emp = await prisma.employee.findUnique({
        where: { id: employeeId },
        select: { gender: true },
      });
      employeeGender = emp?.gender ?? null;
    }

    const types = await prisma.leaveType.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
    });

    // Filter by gender if we know the employee's gender
    const filtered = employeeGender
      ? types.filter(t =>
          t.applicableGender === 'ALL' || t.applicableGender === employeeGender
        )
      : types;

    res.json(filtered);
  } catch (err) {
    next(err);
  }
});

// GET /api/leave/types/all — all leave types including inactive (admin)
router.get('/types/all', requireRole('HR_MANAGER', 'SUPER_ADMIN'), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const types = await prisma.leaveType.findMany({ orderBy: { code: 'asc' } });
    res.json(types);
  } catch (err) {
    next(err);
  }
});

// POST /api/leave/types — create leave type (admin)
router.post('/types', requireRole('HR_MANAGER', 'SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = LeaveTypeSchema.parse(req.body);
    const leaveType = await prisma.leaveType.create({ data: body });
    res.status(201).json(leaveType);
  } catch (err) {
    next(err);
  }
});

// PUT /api/leave/types/:id — update leave type (admin)
router.put('/types/:id', requireRole('HR_MANAGER', 'SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = LeaveTypeSchema.partial().parse(req.body);
    const leaveType = await prisma.leaveType.update({
      where: { id: req.params.id },
      data: body,
    });
    res.json(leaveType);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/leave/types/:id — soft delete (deactivate) leave type (admin)
router.delete('/types/:id', requireRole('HR_MANAGER', 'SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.leaveType.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── Employee self-service ─────────────────────────────────────────────────────

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

// ── HR routes ─────────────────────────────────────────────────────────────────

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

// POST /api/leave/balances/:employeeId/initialize — create leave balances for the current year
// Pro-rates accruing leave types based on the employee's hire date
router.post('/balances/:employeeId/initialize', requireRole('HR_MANAGER', 'SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { employeeId } = req.params;
    const year = parseInt(req.query.year as string) || new Date().getFullYear();

    const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee) return res.status(404).json({ error: 'Employee not found' });

    const leaveTypes = await prisma.leaveType.findMany({ where: { isActive: true } });

    const hireDate = new Date(employee.hireDate);
    const hireYear = hireDate.getFullYear();
    const hireMonth = hireDate.getMonth(); // 0-indexed

    const results = [];
    for (const lt of leaveTypes) {
      // Skip gender-restricted types that don't apply
      if (lt.applicableGender !== 'ALL') {
        if (employee.gender && lt.applicableGender !== employee.gender) continue;
      }
      // Skip manual types (SIL) — those are set individually
      if (lt.isManual) continue;

      let totalDays: number;
      if (lt.accruesMonthly && hireYear === year) {
        // Pro-rate: count months from hire month to Dec (0-indexed: hireMonth to 11)
        const monthsWorked = 12 - hireMonth;
        const monthlyRate = lt.daysPerYear / 12;
        totalDays = Math.floor(monthlyRate * monthsWorked * 10) / 10; // round to 1 decimal
      } else {
        totalDays = lt.daysPerYear;
      }

      const balance = await prisma.leaveBalance.upsert({
        where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId: lt.id, year } },
        update: {}, // don't overwrite if already exists
        create: { employeeId, leaveTypeId: lt.id, year, totalDays, usedDays: 0, pendingDays: 0 },
      });
      results.push(balance);
    }

    const balances = await prisma.leaveBalance.findMany({
      where: { employeeId, year },
      include: { leaveType: true },
    });
    res.json(balances);
  } catch (err) {
    next(err);
  }
});

// PUT /api/leave/balances/:employeeId/:leaveTypeId — manually set SIL balance
router.put('/balances/:employeeId/:leaveTypeId', requireRole('HR_MANAGER', 'SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { employeeId, leaveTypeId } = req.params;
    const { totalDays, year: yearParam } = z.object({
      totalDays: z.number().min(0),
      year: z.number().int().optional(),
    }).parse(req.body);
    const year = yearParam ?? new Date().getFullYear();

    const balance = await prisma.leaveBalance.upsert({
      where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId, year } },
      update: { totalDays },
      create: { employeeId, leaveTypeId, year, totalDays, usedDays: 0, pendingDays: 0 },
    });
    res.json(balance);
  } catch (err) {
    next(err);
  }
});

// POST /api/leave — HR files leave for an employee
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
    const request = await prisma.leaveRequest.findUnique({
      where: { id: req.params.id },
      include: { leaveType: true, employee: true },
    });
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

    // ── SIL billing hook ──────────────────────────────────────────────────────
    // If this is a Service Incentive Leave and the employee belongs to a client,
    // append a line item to the client's current PENDING billing record.
    if (request.leaveType.code === 'SIL' && request.employee.clientId) {
      try {
        const employee = request.employee;
        const dailyRate = employee.basicSalary / 26;
        const silCharge = parseFloat((dailyRate * request.totalDays).toFixed(2));
        const periodLabel = `SIL — ${employee.firstName} ${employee.lastName} (${request.startDate.toISOString().slice(0, 10)} to ${request.endDate.toISOString().slice(0, 10)}, ${request.totalDays}d)`;

        // Find the current PENDING billing for this client, or create one
        const now = new Date();
        let billing = await prisma.billing.findFirst({
          where: { clientId: employee.clientId!, status: 'PENDING' },
          orderBy: { billingDate: 'desc' },
        });

        if (billing) {
          const existing = (billing.lineItems as Array<{ label: string; amount: number }> | null) ?? [];
          existing.push({ label: periodLabel, amount: silCharge });
          await prisma.billing.update({
            where: { id: billing.id },
            data: {
              lineItems: existing,
              amount: billing.amount + silCharge,
            },
          });
        } else {
          // No pending billing — create one
          const dueDate = new Date(now);
          dueDate.setDate(dueDate.getDate() + 30);
          await prisma.billing.create({
            data: {
              clientId: employee.clientId!,
              billingDate: now,
              dueDate,
              amount: silCharge,
              status: 'PENDING',
              notes: 'Auto-generated for SIL consumption',
              lineItems: [{ label: periodLabel, amount: silCharge }],
            },
          });
        }
      } catch (billingErr) {
        // Non-fatal: log but don't fail the approval
        console.error('[SIL billing] Failed to create billing line item:', billingErr);
      }
    }

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
