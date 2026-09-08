import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { computePayroll } from '../lib/payroll';
import { authenticate, requireRole } from '../middleware/authenticate';

const router = Router();
router.use(authenticate);

// Shared employee select — includes client name for the payroll table column
const EMPLOYEE_SELECT = {
  id: true, firstName: true, lastName: true, position: true,
  avatarColor: true,
  department: { select: { name: true } },
  client: { select: { id: true, name: true } },
};

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

// GET /api/payroll/:runId  — single run with records (includes client column)
router.get('/:runId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const run = await prisma.payrollRun.findUnique({
      where: { id: req.params.runId },
      include: {
        records: {
          include: {
            employee: { select: EMPLOYEE_SELECT },
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
    const start = new Date(year, month - 2, 26);
    const end = new Date(year, month - 1, 10);
    return { periodStart: start, periodEnd: end };
  }
  if (payPeriodType === 2) {
    const start = new Date(year, month - 1, 11);
    const end = new Date(year, month - 1, 25);
    return { periodStart: start, periodEnd: end };
  }
  if (!periodStart || !periodEnd) {
    throw new Error('periodStart and periodEnd are required for payPeriodType 7 and 9');
  }
  return { periodStart: new Date(periodStart), periodEnd: new Date(periodEnd) };
}

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
  description: z.string().optional(),
  periodStart: z.string().optional(),
  periodEnd: z.string().optional(),
});

router.post('/run', requireRole('HR_MANAGER', 'SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = RunSchema.parse(req.body);
    const { year, month, payPeriodType, description } = body;

    if ([7, 9].includes(payPeriodType) && !description) {
      return res.status(422).json({ error: 'description is required for payPeriodType 7 and 9' });
    }

    let dates: { periodStart: Date; periodEnd: Date };
    try {
      dates = computePeriodDates(year, month, payPeriodType, body.periodStart, body.periodEnd);
    } catch (e: any) {
      return res.status(422).json({ error: e.message });
    }
    const { periodStart, periodEnd } = dates;
    const period = buildPeriodLabel(year, month, payPeriodType, description);

    const existing = await prisma.payrollRun.findFirst({
      where: { year, month, payPeriodType },
    });
    if (existing?.status === 'PAID') {
      return res.status(422).json({ error: 'A payroll run for this period and type is already paid' });
    }

    const employeeWhere: any = { status: { in: ['ACTIVE', 'ON_LEAVE'] } };
    if (payPeriodType === 1 || payPeriodType === 2) {
      const clientPolicies = await prisma.clientPolicy.findMany({
        where: { type: 'EMPLOYEE_PAY_PERIOD', value: String(payPeriodType) },
        select: { clientId: true },
      });
      const clientIds = clientPolicies.map((p: any) => p.clientId);
      employeeWhere.clientId = clientIds.length > 0 ? { in: clientIds } : { in: [] };
    }

    const employees = await prisma.employee.findMany({ where: employeeWhere });

    const payrollRun = existing
      ? await prisma.payrollRun.update({
          where: { id: existing.id },
          data: { period, description, periodStart, periodEnd, status: 'DRAFT', runById: req.user!.userId, runAt: new Date() },
        })
      : await prisma.payrollRun.create({
          data: { period, year, month, payPeriodType, description, periodStart, periodEnd, status: 'DRAFT', runById: req.user!.userId },
        });

    await prisma.payrollRecord.deleteMany({ where: { payrollRunId: payrollRun.id } });

    const allAttendance = await prisma.attendance.findMany({
      where: {
        employeeId: { in: employees.map((e: any) => e.id) },
        date: { gte: periodStart, lte: periodEnd },
        status: { in: ['PRESENT', 'LATE', 'HALF_DAY'] },
      },
      select: { employeeId: true, status: true },
    });

    const attendanceMap = new Map<string, number>();
    for (const att of allAttendance) {
      const current = attendanceMap.get(att.employeeId) ?? 0;
      attendanceMap.set(att.employeeId, current + (att.status === 'HALF_DAY' ? 0.5 : 1));
    }

    const records = employees.map((emp: any) => {
      const computed = computePayroll(emp.basicSalary);
      return {
        payrollRunId: payrollRun.id,
        employeeId: emp.id,
        ...computed,
        daysWorked: attendanceMap.get(emp.id) ?? 0,
      };
    });

    await prisma.payrollRecord.createMany({ data: records });

    const result = await prisma.payrollRun.findUnique({
      where: { id: payrollRun.id },
      include: {
        records: {
          include: { employee: { select: EMPLOYEE_SELECT } },
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

// DELETE /api/payroll/run/:runId — delete a DRAFT payroll run
router.delete('/run/:runId', requireRole('HR_MANAGER', 'SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const run = await prisma.payrollRun.findUnique({ where: { id: req.params.runId } });
    if (!run) return res.status(404).json({ error: 'Payroll run not found' });
    if (run.status !== 'DRAFT') return res.status(422).json({ error: 'Only DRAFT payroll runs can be deleted' });

    await prisma.payrollRecord.deleteMany({ where: { payrollRunId: run.id } });
    await prisma.payrollRun.delete({ where: { id: run.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// PUT /api/payroll/run/:runId/record/:recordId — update otherDeductions on a single record
router.put('/run/:runId/record/:recordId', requireRole('HR_MANAGER', 'SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const run = await prisma.payrollRun.findUnique({ where: { id: req.params.runId } });
    if (!run) return res.status(404).json({ error: 'Payroll run not found' });
    if (run.status === 'PAID') return res.status(422).json({ error: 'Cannot edit a PAID payroll run' });

    const { otherDeductions } = z.object({
      otherDeductions: z.number().min(0),
    }).parse(req.body);

    const record = await prisma.payrollRecord.update({
      where: { id: req.params.recordId },
      data: {
        otherDeductions,
        // Recompute netPay: netPay = grossPay - totalDeductions(statutory) - otherDeductions
        netPay: { decrement: 0 }, // trigger override below
      },
    });

    // Fetch full record to recompute netPay correctly
    const fresh = await prisma.payrollRecord.findUnique({ where: { id: record.id } });
    if (fresh) {
      const newNetPay = fresh.grossPay - fresh.totalDeductions - fresh.otherDeductions;
      await prisma.payrollRecord.update({
        where: { id: record.id },
        data: { netPay: newNetPay },
      });
    }

    const updated = await prisma.payrollRecord.findUnique({
      where: { id: req.params.recordId },
      include: { employee: { select: EMPLOYEE_SELECT } },
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

export default router;
