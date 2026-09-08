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
        payrollRun: { select: { period: true, year: true, month: true, payPeriodType: true, status: true } },
      },
      orderBy: [{ payrollRun: { year: 'desc' } }, { payrollRun: { month: 'desc' } }],
    });
    res.json(records);
  } catch (err) {
    next(err);
  }
});

// GET /api/payroll/history
router.get('/history', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const runs = await prisma.payrollRun.findMany({
      orderBy: [{ year: 'desc' }, { month: 'desc' }, { payPeriodType: 'asc' }],
      include: { _count: { select: { records: true } } },
    });
    res.json(runs);
  } catch (err) {
    next(err);
  }
});

// GET /api/payroll/employee/:employeeId  — history for one employee
router.get('/employee/:employeeId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const records = await prisma.payrollRecord.findMany({
      where: { employeeId: req.params.employeeId },
      include: { payrollRun: { select: { period: true, year: true, month: true, payPeriodType: true, status: true } } },
      orderBy: { payrollRun: { year: 'desc' } },
      take: 12,
    });
    res.json(records);
  } catch (err) {
    next(err);
  }
});

// GET /api/payroll/:runId  — single run with records
router.get('/:runId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const run = await prisma.payrollRun.findUnique({
      where: { id: req.params.runId },
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
    if (!run) return res.status(404).json({ error: 'Payroll run not found' });
    res.json(run);
  } catch (err) {
    next(err);
  }
});

// ── Helper: compute period dates ───────────────────────────────────────────────
function computePeriodDates(
  year: number, month: number, payPeriodType: number,
  periodStart?: string, periodEnd?: string
): { periodStart: Date; periodEnd: Date } {
  if (payPeriodType === 1) {
    // Semi-monthly 1st half: previous month 26th → current month 10th
    const start = new Date(year, month - 2, 26); // prev month 26
    const end = new Date(year, month - 1, 10);   // current month 10
    return { periodStart: start, periodEnd: end };
  }
  if (payPeriodType === 2) {
    // Semi-monthly 2nd half: current month 11th → current month 25th
    const start = new Date(year, month - 1, 11);
    const end = new Date(year, month - 1, 25);
    return { periodStart: start, periodEnd: end };
  }
  // Types 7 and 9: caller must supply dates
  if (!periodStart || !periodEnd) {
    throw new Error('periodStart and periodEnd are required for payPeriodType 7 and 9');
  }
  return { periodStart: new Date(periodStart), periodEnd: new Date(periodEnd) };
}

// ── Helper: period label ───────────────────────────────────────────────────────
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function buildPeriodLabel(year: number, month: number, payPeriodType: number, description?: string): string {
  const monthStr = MONTH_NAMES[month - 1];
  if (payPeriodType === 1) return `${monthStr} ${year} · Type 1 (1st Half)`;
  if (payPeriodType === 2) return `${monthStr} ${year} · Type 2 (2nd Half)`;
  if (payPeriodType === 7) return description || `Special Pay ${monthStr} ${year}`;
  if (payPeriodType === 9) return description || `13th Month Pay ${year}`;
  return `${monthStr} ${year}`;
}

// POST /api/payroll/run  — compute and save payroll for a period
const RunSchema = z.object({
  year: z.number().int(),
  month: z.number().int().min(1).max(12),
  payPeriodType: z.number().int().refine(v => [1, 2, 7, 9].includes(v), {
    message: 'payPeriodType must be 1, 2, 7, or 9',
  }),
  description: z.string().optional(), // required for types 7 and 9
  periodStart: z.string().optional(), // ISO date string, required for types 7 and 9
  periodEnd: z.string().optional(),
});

router.post('/run', requireRole('HR_MANAGER', 'SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = RunSchema.parse(req.body);
    const { year, month, payPeriodType, description } = body;

    // Validate description for special types
    if ([7, 9].includes(payPeriodType) && !description) {
      return res.status(422).json({ error: 'description is required for payPeriodType 7 and 9' });
    }

    // Compute period dates
    let dates: { periodStart: Date; periodEnd: Date };
    try {
      dates = computePeriodDates(year, month, payPeriodType, body.periodStart, body.periodEnd);
    } catch (e: any) {
      return res.status(422).json({ error: e.message });
    }
    const { periodStart, periodEnd } = dates;

    const period = buildPeriodLabel(year, month, payPeriodType, description);

    // Check if already run for this type + period
    const existing = await prisma.payrollRun.findFirst({
      where: { year, month, payPeriodType },
    });
    if (existing?.status === 'PAID') {
      return res.status(422).json({ error: 'A payroll run for this period and type is already paid' });
    }

    // Fetch employees filtered by payPeriodType
    // Types 1 and 2: only employees whose client has an EMPLOYEE_PAY_PERIOD policy matching the type
    // Types 7 and 9: all active employees (special / 13th month)
    const employeeWhere: any = { status: { in: ['ACTIVE', 'ON_LEAVE'] } };
    if (payPeriodType === 1 || payPeriodType === 2) {
      const clientPolicies = await prisma.clientPolicy.findMany({
        where: { type: 'EMPLOYEE_PAY_PERIOD', value: String(payPeriodType) },
        select: { clientId: true },
      });
      const clientIds = clientPolicies.map((p: any) => p.clientId);
      if (clientIds.length > 0) {
        employeeWhere.clientId = { in: clientIds };
      } else {
        // No clients have this pay period type configured — return empty run
        employeeWhere.clientId = { in: [] };
      }
    }

    const employees = await prisma.employee.findMany({
      where: employeeWhere,
    });

    const payrollRun = existing
      ? await prisma.payrollRun.update({
          where: { id: existing.id },
          data: { period, description, periodStart, periodEnd, status: 'DRAFT', runById: req.user!.userId, runAt: new Date() },
        })
      : await prisma.payrollRun.create({
          data: { period, year, month, payPeriodType, description, periodStart, periodEnd, status: 'DRAFT', runById: req.user!.userId },
        });

    // Delete existing draft records and recompute
    await prisma.payrollRecord.deleteMany({ where: { payrollRunId: payrollRun.id } });

    // Fetch attendance for each employee within the period
    const attendanceMap = new Map<string, number>();
    const allAttendance = await prisma.attendance.findMany({
      where: {
        employeeId: { in: employees.map((e: any) => e.id) },
        date: { gte: periodStart, lte: periodEnd },
        status: { in: ['PRESENT', 'LATE', 'HALF_DAY'] },
      },
      select: { employeeId: true, status: true },
    });

    for (const att of allAttendance) {
      const current = attendanceMap.get(att.employeeId) ?? 0;
      const increment = att.status === 'HALF_DAY' ? 0.5 : 1;
      attendanceMap.set(att.employeeId, current + increment);
    }

    const records = employees.map((emp: any) => {
      const computed = computePayroll(emp.basicSalary);
      const daysWorked = attendanceMap.get(emp.id) ?? 0;
      return {
        payrollRunId: payrollRun.id,
        employeeId: emp.id,
        ...computed,
        daysWorked,
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

export default router;
