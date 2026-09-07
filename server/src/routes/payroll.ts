import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { computePayroll } from '../lib/payroll';
import { authenticate, requireRole } from '../middleware/authenticate';

const router = Router();
router.use(authenticate);

// GET /api/payroll/me  — employee views their own payslips
router.get('/me', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { employeeId } = req.user!;
    if (!employeeId) return res.status(403).json({ error: 'No linked employee record' });

    const records = await prisma.payrollRecord.findMany({
      where: { employeeId },
      include: {
        payrollRun: { select: { period: true, year: true, month: true, status: true } },
      },
      orderBy: [{ payrollRun: { year: 'desc' } }, { payrollRun: { month: 'desc' } }],
    });
    res.json(records);
  } catch (err) {
    next(err);
  }
});

// GET /api/payroll?year=2026&month=9
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const year = parseInt(req.query.year as string) || new Date().getFullYear();
    const month = parseInt(req.query.month as string) || new Date().getMonth() + 1;

    const run = await prisma.payrollRun.findUnique({
      where: { year_month: { year, month } },
      include: {
        records: {
          include: {
            employee: {
              select: {
                id: true, firstName: true, lastName: true, position: true,
                avatarColor: true, department: { select: { name: true } },
              },
            },
          },
          orderBy: { employee: { lastName: 'asc' } },
        },
      },
    });

    res.json(run);
  } catch (err) {
    next(err);
  }
});

// GET /api/payroll/history
router.get('/history', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const runs = await prisma.payrollRun.findMany({
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      include: { _count: { select: { records: true } } },
    });
    res.json(runs);
  } catch (err) {
    next(err);
  }
});

// POST /api/payroll/run  — compute and save payroll for a period
const RunSchema = z.object({
  year: z.number().int(),
  month: z.number().int().min(1).max(12),
});

router.post('/run', requireRole('HR_MANAGER', 'SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { year, month } = RunSchema.parse(req.body);
    const period = `${year}-${String(month).padStart(2, '0')}`;

    // Check if already run
    const existing = await prisma.payrollRun.findUnique({ where: { year_month: { year, month } } });
    if (existing?.status === 'PAID') {
      return res.status(422).json({ error: 'Payroll for this period is already paid' });
    }

    // Fetch all active employees
    const employees = await prisma.employee.findMany({
      where: { status: { in: ['ACTIVE', 'ON_LEAVE'] } },
    });

    const payrollRun = await prisma.payrollRun.upsert({
      where: { year_month: { year, month } },
      update: { status: 'DRAFT', runById: req.user!.userId, runAt: new Date() },
      create: { period, year, month, status: 'DRAFT', runById: req.user!.userId },
    });

    // Delete existing draft records and recompute
    await prisma.payrollRecord.deleteMany({ where: { payrollRunId: payrollRun.id } });

    const records = employees.map(emp => {
      const computed = computePayroll(emp.basicSalary);
      return {
        payrollRunId: payrollRun.id,
        employeeId: emp.id,
        ...computed,
        daysWorked: 22, // default working days in a month — refine with actual attendance
      };
    });

    await prisma.payrollRecord.createMany({ data: records });

    const result = await prisma.payrollRun.findUnique({
      where: { id: payrollRun.id },
      include: {
        records: {
          include: {
            employee: {
              select: {
                id: true, firstName: true, lastName: true, position: true,
                avatarColor: true, department: { select: { name: true } },
              },
            },
          },
          orderBy: { employee: { lastName: 'asc' } },
        },
      },
    });

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

// PUT /api/payroll/:runId/post
router.put('/:runId/post', requireRole('HR_MANAGER', 'SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const run = await prisma.payrollRun.update({
      where: { id: req.params.runId },
      data: { status: 'POSTED' },
    });
    res.json(run);
  } catch (err) {
    next(err);
  }
});

// GET /api/payroll/employee/:employeeId  — history for one employee
router.get('/employee/:employeeId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const records = await prisma.payrollRecord.findMany({
      where: { employeeId: req.params.employeeId },
      include: { payrollRun: { select: { period: true, year: true, month: true, status: true } } },
      orderBy: { payrollRun: { year: 'desc' } },
      take: 12,
    });
    res.json(records);
  } catch (err) {
    next(err);
  }
});

export default router;