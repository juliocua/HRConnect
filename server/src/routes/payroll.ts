import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import PDFDocument from 'pdfkit';
import { prisma } from '../lib/prisma';
import { computeSSS, computePhilHealth, computePagIBIG, computeWithholdingTax } from '../lib/payroll';
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

// GET /api/payroll/audit  — audit log for payroll runs (manager only)
router.get('/audit', requireRole('HR_MANAGER', 'SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { entityId, limit = '50' } = req.query as Record<string, string>;
    const logs = await (prisma as any).auditLog.findMany({
      where: {
        entityType: 'PayrollRun',
        ...(entityId ? { entityId } : {}),
      },
      orderBy: { performedAt: 'desc' },
      take: parseInt(limit, 10),
    });
    res.json(logs);
  } catch (err) {
    next(err);
  }
});

// GET /api/payroll/record/:recordId/pdf  — download a payslip as PDF
router.get('/record/:recordId/pdf', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const record = await prisma.payrollRecord.findUnique({
      where: { id: req.params.recordId },
      include: {
        employee: {
          select: {
            firstName: true, lastName: true, position: true,
            department: { select: { name: true } },
            client: { select: { name: true } },
          },
        },
        payrollRun: {
          select: {
            period: true, periodStart: true, periodEnd: true,
            payPeriodType: true,
          },
        },
      },
    });

    if (!record) return res.status(404).json({ error: 'Record not found' });

    // Employees may only download their own payslip
    if (req.user!.role === 'EMPLOYEE' && req.user!.employeeId !== record.employeeId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const emp = record.employee;
    const run = record.payrollRun;
    const is13th = run.payPeriodType === 9;
    const otherDed = record.otherDeductions ?? 0;
    const lateDed = (record as any).lateDeduction ?? 0;
    const holidayPay = (record as any).holidayPay ?? 0;
    const nightDiff = (record as any).nightDifferential ?? 0;

    const phpFmt = (n: number) =>
      `PHP ${Math.abs(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const fmtDate = (d: Date | string) =>
      new Date(d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
    const safeFilename = (s: string) => s.replace(/[^a-zA-Z0-9_\-]/g, '_');

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="Payslip_${safeFilename(emp.lastName)}_${safeFilename(run.period ?? '')}.pdf"`
    );
    doc.pipe(res);

    // ── Helpers ────────────────────────────────────────────────────────────────
    const lineRow = (label: string, value: string, bold = false, valueColor = '#111111') => {
      const y = doc.y;
      doc.fontSize(10)
        .font(bold ? 'Helvetica-Bold' : 'Helvetica')
        .fillColor('#111111')
        .text(label, 50, y, { width: 340, lineBreak: false });
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica')
        .fillColor(valueColor)
        .text(value, 390, y, { width: 155, align: 'right', lineBreak: false });
      doc.fillColor('#111111').moveDown(0.4);
    };

    const separator = (dash = false) => {
      doc.moveDown(0.2);
      const line = doc.moveTo(50, doc.y).lineTo(545, doc.y);
      if (dash) line.dash(3, { space: 3 }).stroke().undash();
      else line.stroke();
      doc.moveDown(0.4);
    };

    const sectionLabel = (text: string) => {
      doc.fontSize(9).font('Helvetica-Bold')
        .fillColor('#666666')
        .text(text.toUpperCase(), 50, doc.y, { characterSpacing: 0.8 });
      doc.fillColor('#111111').moveDown(0.3);
    };

    // ── Header ─────────────────────────────────────────────────────────────────
    doc.fontSize(16).font('Helvetica-Bold').fillColor('#111111')
      .text('NUAGE CONSULTING GROUP', { align: 'center' });
    doc.fontSize(11).font('Helvetica').fillColor('#444444')
      .text('PAYSLIP', { align: 'center' });
    doc.fillColor('#111111');
    separator();

    // ── Employee & period info ─────────────────────────────────────────────────
    const infoY = doc.y;
    // Left column
    doc.fontSize(10).font('Helvetica-Bold').text('Employee', 50, infoY);
    doc.font('Helvetica').text(`${emp.firstName} ${emp.lastName}`, 50, doc.y);
    doc.font('Helvetica-Bold').text('Position', 50, doc.y);
    doc.font('Helvetica').text(emp.position, 50, doc.y);
    if (emp.department?.name) {
      doc.font('Helvetica-Bold').text('Department', 50, doc.y);
      doc.font('Helvetica').text(emp.department.name, 50, doc.y);
    }
    if (emp.client?.name) {
      doc.font('Helvetica-Bold').text('Client', 50, doc.y);
      doc.font('Helvetica').text(emp.client.name, 50, doc.y);
    }
    // Right column
    doc.fontSize(10).font('Helvetica-Bold').text('Pay Period', 310, infoY, { width: 235 });
    doc.font('Helvetica').text(run.period ?? '', 310, doc.y, { width: 235 });
    if (run.periodStart && run.periodEnd) {
      doc.font('Helvetica-Bold').text('Coverage', 310, doc.y, { width: 235 });
      doc.font('Helvetica').text(`${fmtDate(run.periodStart)} — ${fmtDate(run.periodEnd)}`, 310, doc.y, { width: 235 });
    }
    doc.y = Math.max(doc.y, infoY + 80);
    separator();

    // ── Earnings / Computation ─────────────────────────────────────────────────
    if (is13th) {
      sectionLabel('13th Month Pay Computation');
      lineRow('Basic Salary (Monthly)', phpFmt(record.basicSalary));
      lineRow('Daily Rate (÷ 22 working days)', phpFmt(record.basicSalary / 22));
      const pd = record.daysWorked;
      lineRow('Paid Days (present + approved leaves)', `${Number.isInteger(pd) ? pd : (pd as number).toFixed(2)} days`);
      lineRow('Gross Pay  (Daily Rate × Paid Days ÷ 12)', phpFmt(record.grossPay), true);
      separator(true);
      sectionLabel('Tax');
      lineRow('Tax-Exempt (first PHP 90,000)', phpFmt(Math.min(record.grossPay, 90000)), false, '#16a34a');
      if (record.taxableIncome > 0) {
        lineRow('Taxable Excess (above PHP 90,000)', phpFmt(record.taxableIncome));
        lineRow('Withholding Tax  (TRAIN Law — annual bracket)', `(${phpFmt(record.withholdingTax)})`, false, '#dc2626');
      } else {
        lineRow('Withholding Tax', '—');
      }
    } else {
      sectionLabel('Earnings');
      lineRow('Basic Salary (Monthly)', phpFmt(record.basicSalary));
      lineRow(`Days Worked  (${record.daysWorked} of 22)`, phpFmt((record.basicSalary / 22) * record.daysWorked));
      if (record.overtimePay > 0) lineRow('Overtime Pay', phpFmt(record.overtimePay));
      if (holidayPay > 0) lineRow('Holiday Pay', phpFmt(holidayPay));
      if (nightDiff > 0) lineRow('Night Differential', phpFmt(nightDiff));
      if (record.allowances > 0) lineRow('Allowances', phpFmt(record.allowances));
      lineRow('Gross Pay', phpFmt(record.grossPay), true);
      separator(true);
      sectionLabel('Deductions');
      lineRow('SSS Contribution', `(${phpFmt(record.sssContrib)})`, false, '#dc2626');
      lineRow('PhilHealth Contribution', `(${phpFmt(record.philhealthContrib)})`, false, '#dc2626');
      lineRow('Pag-IBIG Contribution', `(${phpFmt(record.pagibigContrib)})`, false, '#dc2626');
      lineRow('Taxable Income', phpFmt(record.taxableIncome));
      lineRow('Withholding Tax  (TRAIN Law)', `(${phpFmt(record.withholdingTax)})`, false, '#dc2626');
      if (lateDed > 0) lineRow('Late Deduction', `(${phpFmt(lateDed)})`, false, '#dc2626');
      if (otherDed > 0) lineRow('Other Deductions', `(${phpFmt(otherDed)})`, false, '#dc2626');
      lineRow('Total Deductions', `(${phpFmt(record.totalDeductions + otherDed + lateDed)})`, true, '#dc2626');
    }

    separator();

    // ── Net Pay ────────────────────────────────────────────────────────────────
    const netY = doc.y;
    doc.fontSize(13).font('Helvetica-Bold').fillColor('#111111')
      .text('NET PAY', 50, netY, { width: 340, lineBreak: false });
    doc.fontSize(13).font('Helvetica-Bold').fillColor('#1d4ed8')
      .text(phpFmt(record.netPay), 390, netY, { width: 155, align: 'right', lineBreak: false });
    doc.fillColor('#111111').moveDown(2);
    separator();

    // ── Footer ─────────────────────────────────────────────────────────────────
    doc.fontSize(8.5).font('Helvetica').fillColor('#888888')
      .text(
        `Generated on ${fmtDate(new Date())}  ·  This is a system-generated payslip. No signature required.`,
        50, doc.y, { align: 'center', width: 495 }
      );

    doc.end();
  } catch (err) {
    next(err);
  }
});

// GET /api/payroll/:runId/disbursement  — download salary disbursement CSV for bank crediting
router.get('/:runId/disbursement', requireRole('HR_MANAGER', 'SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const run = await prisma.payrollRun.findUnique({
      where: { id: req.params.runId },
      select: { id: true, period: true, status: true, periodStart: true, periodEnd: true },
    });
    if (!run) return res.status(404).json({ error: 'Payroll run not found' });
    if (run.status === 'DRAFT') return res.status(400).json({ error: 'Cannot generate disbursement file for a DRAFT payroll run' });

    const records = await prisma.payrollRecord.findMany({
      where: { payrollRunId: req.params.runId },
      include: {
        employee: {
          select: {
            firstName: true, lastName: true,
            bankName: true, bankAccountNo: true, bankAccountName: true,
          },
        },
      },
      orderBy: { employee: { lastName: 'asc' } },
    });

    // Build CSV
    const safeVal = (v: string | null | undefined) => {
      if (!v) return '';
      const s = String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const fmt2 = (n: number) => n.toFixed(2);

    const header = ['Employee Name', 'Bank Name', 'Account Number', 'Account Name', 'Net Pay'].join(',');
    const rows = records.map(r => {
      const name = `${r.employee.lastName}, ${r.employee.firstName}`;
      return [
        safeVal(name),
        safeVal(r.employee.bankName),
        safeVal(r.employee.bankAccountNo),
        safeVal(r.employee.bankAccountName),
        fmt2(r.netPay),
      ].join(',');
    });

    const totalNetPay = records.reduce((sum, r) => sum + r.netPay, 0);
    const footerRow = ['TOTAL', '', '', '', fmt2(totalNetPay)].join(',');

    const csv = [header, ...rows, footerRow].join('\r\n');
    const safeRunPeriod = (run.period ?? req.params.runId).replace(/[^a-zA-Z0-9_\-·]/g, '_');
    const filename = `Disbursement_${safeRunPeriod}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('﻿' + csv); // BOM for Excel compatibility
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

function computeAnnualWithholdingTax(taxableExcess: number): number {
  if (taxableExcess <= 250000) return 0;
  if (taxableExcess <= 400000) return Math.round((taxableExcess - 250000) * 0.20);
  if (taxableExcess <= 800000) return Math.round(30000 + (taxableExcess - 400000) * 0.25);
  if (taxableExcess <= 2000000) return Math.round(130000 + (taxableExcess - 800000) * 0.30);
  if (taxableExcess <= 8000000) return Math.round(490000 + (taxableExcess - 2000000) * 0.32);
  return Math.round(2410000 + (taxableExcess - 8000000) * 0.35);
}

function compute13thMonthRecord(basicSalary: number, paidDays: number) {
  const dailyRate = basicSalary / 22;
  const grossPay = (dailyRate * paidDays) / 12;
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
  month: z.number().int().min(1).max(12).optional(),
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
    const { year, payPeriodType } = body;
    const is13th = payPeriodType === 9;

    const month = is13th ? 12 : body.month;
    const description = is13th ? `13th Month Pay ${year}` : body.description;

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
      const allAttendance = await prisma.attendance.findMany({
        where: {
          employeeId: { in: employees.map((e: any) => e.id) },
          date: { gte: periodStart, lte: periodEnd },
          status: { in: ['PRESENT', 'LATE', 'HALF_DAY', 'ON_LEAVE'] },
        },
        select: { employeeId: true, status: true, clockInAt: true, date: true },
      });

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
            frac = 1;
          }
        } else if (att.status === 'HALF_DAY') {
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

      // Exclude employees with no attendance in this period
      records = employees
        .filter((emp: any) => (attendanceMap.get(emp.id) ?? 0) > 0)
        .map((emp: any) => {
          const daysWorked = attendanceMap.get(emp.id)!;
          // Gross = prorated daily rate × days actually worked
          const grossPay = (emp.basicSalary / 22) * daysWorked;
          // Statutory contributions are based on full monthly salary bracket
          const sssContrib = computeSSS(emp.basicSalary);
          const philhealthContrib = computePhilHealth(emp.basicSalary);
          const pagibigContrib = computePagIBIG(emp.basicSalary);
          const taxableIncome = Math.max(0, grossPay - sssContrib - philhealthContrib - pagibigContrib);
          const withholdingTax = computeWithholdingTax(taxableIncome);
          const totalDeductions = sssContrib + philhealthContrib + pagibigContrib + withholdingTax;
          const netPay = grossPay - totalDeductions;
          return {
            payrollRunId: payrollRun.id,
            employeeId: emp.id,
            basicSalary: emp.basicSalary,
            daysWorked,
            grossPay,
            overtimePay: 0,
            allowances: 0,
            otherDeductions: 0,
            lateDeduction: 0,
            holidayPay: 0,
            nightDifferential: 0,
            sssContrib,
            philhealthContrib,
            pagibigContrib,
            taxableIncome,
            withholdingTax,
            totalDeductions,
            netPay,
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

// PUT /api/payroll/:runId/post  — DRAFT → POSTED (with audit log)
router.put('/:runId/post', requireRole('HR_MANAGER', 'SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const run = await prisma.payrollRun.findUnique({ where: { id: req.params.runId } });
    if (!run) return res.status(404).json({ error: 'Payroll run not found' });
    if (run.status !== 'DRAFT') {
      return res.status(422).json({ error: `Cannot post a payroll run that is already ${run.status}` });
    }

    const updated = await prisma.payrollRun.update({
      where: { id: req.params.runId },
      data: { status: 'POSTED' },
    });

    await (prisma as any).auditLog.create({
      data: {
        entityType: 'PayrollRun',
        entityId: run.id,
        action: 'POST',
        performedById: req.user!.userId,
        before: { status: 'DRAFT' },
        after: { status: 'POSTED' },
      },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// PUT /api/payroll/:runId/paid  — POSTED → PAID (with audit log)
router.put('/:runId/paid', requireRole('HR_MANAGER', 'SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const run = await prisma.payrollRun.findUnique({ where: { id: req.params.runId } });
    if (!run) return res.status(404).json({ error: 'Payroll run not found' });
    if (run.status !== 'POSTED') {
      return res.status(422).json({ error: `Only POSTED payroll runs can be marked as PAID. Current status: ${run.status}` });
    }

    const updated = await prisma.payrollRun.update({
      where: { id: req.params.runId },
      data: { status: 'PAID' },
    });

    await (prisma as any).auditLog.create({
      data: {
        entityType: 'PayrollRun',
        entityId: run.id,
        action: 'PAID',
        performedById: req.user!.userId,
        before: { status: 'POSTED' },
        after: { status: 'PAID' },
      },
    });

    res.json(updated);
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

// PUT /api/payroll/run/:runId/record/:recordId — update HR-editable fields (DRAFT only)
router.put('/run/:runId/record/:recordId', requireRole('HR_MANAGER', 'SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const run = await prisma.payrollRun.findUnique({ where: { id: req.params.runId } });
    if (!run) return res.status(404).json({ error: 'Payroll run not found' });
    if (run.status !== 'DRAFT') {
      return res.status(422).json({ error: `Cannot edit a ${run.status} payroll run. Only DRAFT runs are editable.` });
    }

    const body = z.object({
      otherDeductions:   z.number().min(0).optional(),
      lateDeduction:     z.number().min(0).optional(),
      holidayPay:        z.number().min(0).optional(),
      nightDifferential: z.number().min(0).optional(),
    }).parse(req.body);

    const updateData: Record<string, number> = {};
    if (body.otherDeductions   !== undefined) updateData.otherDeductions   = body.otherDeductions;
    if (body.lateDeduction     !== undefined) updateData.lateDeduction     = body.lateDeduction;
    if (body.holidayPay        !== undefined) updateData.holidayPay        = body.holidayPay;
    if (body.nightDifferential !== undefined) updateData.nightDifferential = body.nightDifferential;

    // Read record BEFORE applying partial update — needed for delta-based recompute
    const prev = await prisma.payrollRecord.findUnique({ where: { id: req.params.recordId } });
    if (!prev) return res.status(404).json({ error: 'Record not found' });

    await prisma.payrollRecord.update({ where: { id: req.params.recordId }, data: updateData });

    // Delta-based recompute — preserves original run-time grossPay regardless of daysWorked
    const prevHoliday   = (prev as any).holidayPay        ?? 0;
    const prevNightDiff = (prev as any).nightDifferential ?? 0;
    const grossDelta    = ((body.holidayPay        ?? prevHoliday)   - prevHoliday)
                        + ((body.nightDifferential ?? prevNightDiff) - prevNightDiff);
    const newGrossPay   = prev.grossPay + grossDelta;
    const newOtherDed   = body.otherDeductions ?? (prev.otherDeductions ?? 0);
    const newLateDed    = body.lateDeduction   ?? ((prev as any).lateDeduction ?? 0);
    const newNetPay     = newGrossPay - prev.totalDeductions - newOtherDed - newLateDed;

    await prisma.payrollRecord.update({
      where: { id: req.params.recordId },
      data:  { grossPay: newGrossPay, netPay: newNetPay },
    });

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
