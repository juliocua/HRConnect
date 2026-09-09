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
      where: { employeeId, payrollRun: { status: 'PAID' } },
      include: {
        payrollRun: { select: { period: true, year: true, month: true, payPeriodType: true, description: true, periodStart: true, periodEnd: true, runAt: true, status: true } },
        employee: { select: { client: { select: { id: true, name: true } } } },
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function computePeriodDates(
  year: number, month: number, payPeriodType: number,
  periodStart?: string, periodEnd?: string
): { periodStart: Date; periodEnd: Date } {
  if (payPeriodType === 9) {
    // 13th month: always Jan 1 – Dec 31 of the given year
    return { periodStart: new Date(year, 0, 1), periodEnd: new Date(year, 11, 31) };
  }
  if (payPeriodType === 1) {
    return { periodStart: new Date(year, month - 2, 26), periodEnd: new Date(year, month - 1, 10) };
  }
  if (payPeriodType === 2) {
    return { periodStart: new Date(year, month - 1, 11), periodEnd: new Date(year, month - 1, 25) };
  }
  if (!periodStart || !periodEnd) {
    throw new Error('periodStart and periodEnd are required for payPeriodType 7');
  }
  return { periodStart: new Date(periodStart), periodEnd: new Date(periodEnd) };
}

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function buildPeriodLabel(year: number, month: number, payPeriodType: number, description?: string): string {
  const monthStr = MONTH_NAMES[month - 1];
  if (payPeriodType === 1) return `${monthStr} ${year} · Type 1 (1st Half)`;
  if (payPeriodType === 2) return `${monthStr} ${year} · Type 2 (2nd Half)`;
  if (payPeriodType === 7) return description || `Special Pay ${monthStr} ${year}`;
  if (payPeriodType === 9) return `13th Month Pay ${year}`;
  return `${monthStr} ${year}`;
}

// ── 13th month pay helpers ────────────────────────────────────────────────────

/** Annual TRAIN Law brackets applied to excess over ₱90,000 exemption */
function computeAnnualWithholdingTax(taxableExcess: number): number {
  if (taxableExcess <= 250000) return 0;
  if (taxableExcess <= 400000) return Math.round((taxableExcess - 250000) * 0.20);
  if (taxableExcess <= 800000) return Math.round(30000 + (taxableExcess - 400000) * 0.25);
  if (taxableExcess <= 2000000) return Math.round(130000 + (taxableExcess - 800000) * 0.30);
  if (taxableExcess <= 8000000) return Math.round(490000 + (taxableExcess - 2000000) * 0.32);
  return Math.round(2410000 + (taxableExcess - 8000000) * 0.35);
}

function compute13thMonthRecord(basicSalary: number, paidDays: number) {
  // PH formula: (daily rate × paid days) / 12
  const dailyRate = basicSalary / 22;
  const grossPay = (dailyRate * paidDays) / 12;
  // Exempt up to ₱90,000 (TRAIN Law); tax applied to annual excess
  const taxableExcess = Math.max(0, grossPay - 90000);
  const withholdingTax = computeAnnualWithholdingTax(taxableExcess);
  return {
    basicSalary,
    grossPay,
    sssContrib: 0,
    philhealthContrib: 0,
    pagibigContrib: 0,
    taxableIncome: taxableExcess,
    withholdingTax,
    totalDeductions: withholdingTax,
    netPay: grossPay - withholdingTax,
    overtimePay: 0,
    allowances: 0,
    otherDeductions: 0,
  };
}

// POST /api/payroll/run  — compute and save payroll for a period
const RunSchema = z.object({
  year: z.number().int(),
  month: z.number().int().min(1).max(12).optional(), // optional for type 9
  payPeriodType: z.number().int().refine(v => [1, 2, 7, 9].includes(v), {
    message: 'payPeriodType must be 1, 2, 7, or 9',
  }),
  description: z.string().optional(), // optional for type 9 (auto-filled)
  periodStart: z.string().optional(),
  periodEnd: z.string().optional(),
});

router.post('/run', requireRole('HR_MANAGER', 'SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = RunSchema.parse(req.body);
    const { year, payPeriodType } = body;
    const is13th = payPeriodType === 9;

    // Auto-fill for type 9
    const month = is13th ? 12 : body.month;
    const description = is13th ? `13th Month Pay ${year}` : body.description;

    // Validation for non-13th types
    if (!is13th) {
      if (!month) return res.status(422).json({ error: 'month is required for this pay period type' });
      if (payPeriodType === 7 && !description) {
        return res.status(422).json({ error: 'description is required for payPeriodType 7' });
      }
    }

    let dates: { periodStart: Date; periodEnd: Date };
    try {
      dates = computePeriodDates(year, month ?? 12, payPeriodType, body.periodStart, body.periodEnd);
    } catch (e: any) {
      return res.status(422).json({ error: e.message });
    }
    const { periodStart, periodEnd } = dates;
    const period = buildPeriodLabel(year, month ?? 12, payPeriodType, description);

    const existing = await prisma.payrollRun.findFirst({
      where: { year, month: month ?? 12, payPeriodType },
    });
    if (existing?.status === 'PAID') {
      return res.status(422).json({ error: 'A payroll run for this period and type is already paid' });
    }

    // ── Employee filter ───────────────────────────────────────────────────────
    const employeeWhere: any = { status: { in: ['ACTIVE', 'ON_LEAVE'] } };
    if (payPeriodType === 1 || payPeriodType === 2) {
      const payFrequencies = payPeriodType === 1 ? ['SEMI_MONTHLY'] : ['SEMI_MONTHLY', 'MONTHLY'];
      const matchingPolicies = await prisma.clientPolicy.findMany({
        where: { type: 'EMPLOYEE_PAY_PERIOD', value: { in: payFrequencies } },
        select: { clientId: true },
      });
      const clientIds = [...new Set(matchingPolicies.map((p: any) => p.clientId))];
      employeeWhere.clientId = clientIds.length > 0 ? { in: clientIds } : { in: [] };
    }
    // Types 7 and 9: all active/on-leave employees

    const employees = await prisma.employee.findMany({ where: employeeWhere });

    const payrollRun = existing
      ? await prisma.payrollRun.update({
          where: { id: existing.id },
          data: { period, description, periodStart, periodEnd, status: 'DRAFT', runById: req.user!.userId, runAt: new Date() },
        })
      : await prisma.payrollRun.create({
          data: { period, year, month: month ?? 12, payPeriodType, description, periodStart, periodEnd, status: 'DRAFT', runById: req.user!.userId },
        });

    await prisma.payrollRecord.deleteMany({ where: { payrollRunId: payrollRun.id } });

    let records: any[];

    if (is13th) {
      // ── 13th month: full-year paid days computation ───────────────────────
      const allAttendance = await prisma.attendance.findMany({
        where: {
          employeeId: { in: employees.map((e: any) => e.id) },
          date: { gte: periodStart, lte: periodEnd },
          status: { in: ['PRESENT', 'LATE', 'HALF_DAY', 'ON_LEAVE'] },
        },
        select: { employeeId: true, status: true, clockInAt: true, date: true },
      });

      // Build set of (employeeId_YYYY-MM-DD) for approved paid leaves
      const approvedPaidLeaves = await prisma.leaveRequest.findMany({
        where: {
          employeeId: { in: employees.map((e: any) => e.id) },
          status: 'APPROVED',
          startDate: { lte: periodEnd },
          endDate: { gte: periodStart },
          leaveType: { isPaid: true },
        },
        select: { employeeId: true, startDate: true, endDate: true },
      });

      const paidLeaveSet = new Set<string>();
      for (const lr of approvedPaidLeaves) {
        const cur = new Date(lr.startDate);
        const end = new Date(lr.endDate);
        while (cur <= end) {
          paidLeaveSet.add(`${lr.employeeId}_${cur.toISOString().split('T')[0]}`);
          cur.setDate(cur.getDate() + 1);
        }
      }

      // Compute paid day fractions per employee
      const paidDaysMap = new Map<string, number>();
      for (const att of allAttendance) {
        const current = paidDaysMap.get(att.employeeId) ?? 0;
        const d = att.date instanceof Date ? att.date : new Date(att.date);
        const dateStr = d.toISOString().split('T')[0];
        const key = `${att.employeeId}_${dateStr}`;
        let frac = 0;

        if (att.status === 'PRESENT') {
          frac = 1;
        } else if (att.status === 'LATE') {
          if (att.clockInAt) {
            const clockIn = new Date(att.clockInAt);
            const shiftStart = new Date(clockIn);
            shiftStart.setHours(8, 0, 0, 0);
            const lateHrs = Math.max(0, clockIn.getTime() - shiftStart.getTime()) / 3_600_000;
            frac = Math.max(0, (8 - lateHrs) / 8);
          } else {
            frac = 1; // no clock-in data — treat as full day
          }
        } else if (att.status === 'HALF_DAY') {
          // 0.5 work + 0.5 if the other half is a paid leave
          frac = paidLeaveSet.has(key) ? 1 : 0.5;
        } else if (att.status === 'ON_LEAVE') {
          frac = paidLeaveSet.has(key) ? 1 : 0;
        }

        paidDaysMap.set(att.employeeId, current + frac);
      }

      records = employees.map((emp: any) => {
        const paidDays = Math.round((paidDaysMap.get(emp.id) ?? 0) * 100) / 100;
        return {
          payrollRunId: payrollRun.id,
          employeeId: emp.id,
          daysWorked: paidDays,
          ...compute13thMonthRecord(emp.basicSalary, paidDays),
        };
      });
    } else {
      // ── Regular payroll (types 1, 2, 7) ──────────────────────────────────
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

      records = employees.map((emp: any) => {
        const computed = computePayroll(emp.basicSalary);
        return {
          payrollRunId: payrollRun.id,
          employeeId: emp.id,
          ...computed,
          daysWorked: attendanceMap.get(emp.id) ?? 0,
        };
      });
    }

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
        netPay: { decrement: 0 }, // trigger override below
      },
    });

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
