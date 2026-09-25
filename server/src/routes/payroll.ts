import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import path from 'path';
import fs from 'fs';
import PDFDocument from 'pdfkit';
import { prisma } from '../lib/prisma';
import { computeSSS, computePhilHealth, computePagIBIG, computeWithholdingTax } from '../lib/payroll';
import { authenticate, requireRole } from '../middleware/authenticate';

const uploadsBase = process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads');

// ── Night differential helper ─────────────────────────────────────────────────
// Computes hours worked within the ND window (10PM–5AM) for a given shift.
function computeNightDiffHours(clockIn: Date | null, clockOut: Date | null): number {
  if (!clockIn || !clockOut) return 0;
  const shiftStart = clockIn.getTime();
  const shiftEnd = clockOut.getTime();
  if (shiftEnd <= shiftStart) return 0;

  let ndMs = 0;
  // Check ND window relative to the clock-in day: 22:00 → next-day 05:00
  const base = new Date(clockIn);
  base.setHours(0, 0, 0, 0);

  // Window A: [base+22h, base+24h)
  const wA_start = base.getTime() + 22 * 3_600_000;
  const wA_end   = base.getTime() + 24 * 3_600_000;
  // Window B: [base+24h, base+29h) — i.e. next day 00:00–05:00
  const wB_start = base.getTime() + 24 * 3_600_000;
  const wB_end   = base.getTime() + 29 * 3_600_000;

  const overlapA = Math.max(0, Math.min(shiftEnd, wA_end) - Math.max(shiftStart, wA_start));
  const overlapB = Math.max(0, Math.min(shiftEnd, wB_end) - Math.max(shiftStart, wB_start));
  ndMs = overlapA + overlapB;

  return Math.round((ndMs / 3_600_000) * 100) / 100;
}

const router = Router();
router.use(authenticate);

// Shared employee select — includes client name for the payroll table column
const EMPLOYEE_SELECT = {
  id: true, employeeNo: true, firstName: true, lastName: true, position: true,
  avatarColor: true, useDailyRate: true, dailyRate: true,
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
        expenses: { select: { amount: true } },
      },
      orderBy: [{ payrollRun: { year: 'desc' } }, { payrollRun: { month: 'desc' } }],
    });
    const result = records.map(({ expenses, ...r }) => ({
      ...r,
      expenseReimbursement: expenses.reduce((s: number, e: { amount: number }) => s + e.amount, 0),
    }));
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/payroll/history
router.get('/history', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const runs = await prisma.payrollRun.findMany({
      orderBy: [{ year: 'desc' }, { month: 'desc' }, { payPeriodType: 'asc' }],
      include: {
        _count: { select: { records: true } },
        records: { select: { netPay: true } },
      },
    });
    const result = runs.map(({ records, ...run }) => ({
      ...run,
      totalNetPay: records.reduce((s: number, r: { netPay: number }) => s + r.netPay, 0),
    }));
    res.json(result);
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

    // Resolve user names for audit trail display
    const userIds = [...new Set(logs.map((l: any) => l.performedById))] as string[];
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true },
    });
    const userMap = Object.fromEntries(users.map(u => [u.id, u.name || u.email]));
    const enriched = logs.map((l: any) => ({ ...l, performedByName: userMap[l.performedById] ?? l.performedById }));
    res.json(enriched);
  } catch (err) {
    next(err);
  }
});

// GET /api/payroll/record/:recordId/pdf  — download a payslip as PDF
router.get('/record/:recordId/pdf', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const [record, companySettings] = await Promise.all([
      prisma.payrollRecord.findUnique({
        where: { id: req.params.recordId },
        include: {
          employee: {
            select: {
              firstName: true, lastName: true, position: true,
              useDailyRate: true, dailyRate: true,
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
      }),
      (prisma as any).companySettings.findUnique({ where: { id: 'singleton' } }),
    ]);

    if (!record) return res.status(404).json({ error: 'Record not found' });

    // Employees may only download their own payslip
    if (req.user!.role === 'EMPLOYEE' && req.user!.employeeId !== record.employeeId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const emp = record.employee;
    const run = record.payrollRun;
    const is13th = run.payPeriodType === 9;
    const otherDed = record.otherDeductions ?? 0;
    const otherDedNote = (record as any).otherDeductionsNote ?? null;
    const lateDed = (record as any).lateDeduction ?? 0;
    const holidayPay = (record as any).holidayPay ?? 0;
    const nightDiff = (record as any).nightDifferential ?? 0;

    // Company settings
    const companyName = companySettings?.companyName || 'NUAGE CONSULTING GROUP';
    const companyAddress = companySettings?.address ?? null;
    const companyContact = companySettings?.contactNumber ?? null;

    // Load logo from disk if set
    let logoBuffer: Buffer | undefined;
    if (companySettings?.logoUrl) {
      try {
        const logoFilename = path.basename(new URL(companySettings.logoUrl).pathname);
        const logoPath = path.join(uploadsBase, 'logos', logoFilename);
        if (fs.existsSync(logoPath)) logoBuffer = fs.readFileSync(logoPath);
      } catch { /* ignore */ }
    }

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
    if (logoBuffer) {
      const logoY = doc.y;
      doc.image(logoBuffer, 50, logoY, { fit: [56, 56], valign: 'center' });
      doc.fontSize(16).font('Helvetica-Bold').fillColor('#111111')
        .text(companyName.toUpperCase(), 120, logoY + 4, { width: 375, lineBreak: false });
      doc.fontSize(10).font('Helvetica').fillColor('#444444')
        .text('PAYSLIP', 120, doc.y + 2, { width: 375 });
      doc.y = Math.max(doc.y, logoY + 62);
    } else {
      doc.fontSize(16).font('Helvetica-Bold').fillColor('#111111')
        .text(companyName.toUpperCase(), { align: 'center' });
      doc.fontSize(11).font('Helvetica').fillColor('#444444')
        .text('PAYSLIP', { align: 'center' });
    }
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
    const leftColEndY = doc.y; // save left-column bottom before right column resets cursor
    // Right column
    doc.fontSize(10).font('Helvetica-Bold').text('Pay Period', 310, infoY, { width: 235 });
    doc.font('Helvetica').text(run.period ?? '', 310, doc.y, { width: 235 });
    if (run.periodStart && run.periodEnd) {
      doc.font('Helvetica-Bold').text('Coverage', 310, doc.y, { width: 235 });
      doc.font('Helvetica').text(`${fmtDate(run.periodStart)} — ${fmtDate(run.periodEnd)}`, 310, doc.y, { width: 235 });
    }
    // Use whichever column is taller so the separator never overlaps left-column text
    doc.y = Math.max(leftColEndY, doc.y) + 10;
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
      if ((emp as any).useDailyRate && (emp as any).dailyRate) {
        lineRow('Daily Rate', phpFmt((emp as any).dailyRate));
        lineRow(`Days Worked`, `${record.daysWorked} day${record.daysWorked !== 1 ? 's' : ''}`);
        lineRow('Daily Rate Pay  (Daily Rate × Days Worked)', phpFmt((emp as any).dailyRate * record.daysWorked));
      } else {
        lineRow('Basic Salary (Monthly)', phpFmt(record.basicSalary));
        lineRow(`Days Worked  (${record.daysWorked} of 22)`, phpFmt((record.basicSalary / 22) * record.daysWorked));
      }
      if (record.overtimePay > 0) lineRow('Overtime Pay', phpFmt(record.overtimePay));
      if (holidayPay > 0) lineRow('Holiday Pay', phpFmt(holidayPay));
      if (nightDiff > 0) lineRow('Night Differential', phpFmt(nightDiff));
      if (record.allowances > 0) lineRow('Allowances', phpFmt(record.allowances));
      const silPay = (record as any).silPay ?? 0;
      if (silPay > 0) lineRow('SIL Pay', phpFmt(silPay));
      lineRow('Gross Pay', phpFmt(record.grossPay), true);
      separator(true);
      sectionLabel('Deductions');
      lineRow('SSS Contribution', `(${phpFmt(record.sssContrib)})`, false, '#dc2626');
      lineRow('PhilHealth Contribution', `(${phpFmt(record.philhealthContrib)})`, false, '#dc2626');
      lineRow('Pag-IBIG Contribution', `(${phpFmt(record.pagibigContrib)})`, false, '#dc2626');
      lineRow('Taxable Income', phpFmt(record.taxableIncome));
      lineRow('Withholding Tax  (TRAIN Law)', `(${phpFmt(record.withholdingTax)})`, false, '#dc2626');
      if (lateDed > 0) lineRow('Late Deduction', `(${phpFmt(lateDed)})`, false, '#dc2626');
      if (otherDed > 0) {
        const otherLabel = otherDedNote ? `Other Deductions  (${otherDedNote})` : 'Other Deductions';
        lineRow(otherLabel, `(${phpFmt(otherDed)})`, false, '#dc2626');
      }
      lineRow('Total Deductions', `(${phpFmt(record.totalDeductions + otherDed + lateDed)})`, true, '#dc2626');
    }

    separator();

    // ── Net Pay ────────────────────────────────────────────────────────────────
    const netY = doc.y;
    doc.fontSize(13).font('Helvetica-Bold').fillColor('#111111')
      .text('NET PAY', 50, netY, { width: 340, lineBreak: false });
    doc.fontSize(13).font('Helvetica-Bold').fillColor('#1d4ed8')
      .text(phpFmt(record.netPay), 390, netY, { width: 155, align: 'right', lineBreak: false });
    doc.fillColor('#111111');

    // ── Footer at bottom of page ───────────────────────────────────────────────
    const footerY = doc.page.height - doc.page.margins.bottom - 24;
    doc.moveTo(50, footerY - 10).lineTo(545, footerY - 10).stroke();
    doc.fontSize(8.5).font('Helvetica').fillColor('#888888')
      .text(
        `Generated on ${fmtDate(new Date())}  ·  This is a system-generated payslip. No signature required.`,
        50, footerY, { align: 'center', width: 495 }
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

    // ── Grouped JSON mode — one entry per bank ─────────────────────────────────
    if (req.query.grouped === 'true') {
      const bankMap = new Map<string, typeof records>();
      for (const r of records) {
        const key = r.employee.bankName?.trim() || 'Unknown';
        if (!bankMap.has(key)) bankMap.set(key, []);
        bankMap.get(key)!.push(r);
      }
      const banks = Array.from(bankMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([bankName, recs]) => ({
          bankName,
          totalNetPay: recs.reduce((s, r) => s + r.netPay, 0),
          records: recs,
        }));
      return res.json({ period: run.period, banks });
    }

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

// GET /api/payroll/record/:recordId/attendance  — attendance, approved OT, approved leaves for a payroll record's period
router.get('/record/:recordId/attendance', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const record = await prisma.payrollRecord.findUnique({
      where: { id: req.params.recordId },
      include: { payrollRun: { select: { periodStart: true, periodEnd: true } } },
    });
    if (!record) return res.status(404).json({ error: 'Record not found' });
    const { periodStart, periodEnd } = record.payrollRun;
    const [attendance, overtime, leaves] = await Promise.all([
      prisma.attendance.findMany({
        where: { employeeId: record.employeeId, date: { gte: periodStart, lte: periodEnd } },
        orderBy: { date: 'asc' },
      }),
      prisma.overtimeRequest.findMany({
        where: { employeeId: record.employeeId, status: 'APPROVED', date: { gte: periodStart, lte: periodEnd } },
        orderBy: { date: 'asc' },
      }),
      prisma.leaveRequest.findMany({
        where: {
          employeeId: record.employeeId,
          status: 'APPROVED',
          startDate: { lte: periodEnd },
          endDate: { gte: periodStart },
        },
        include: { leaveType: { select: { name: true, code: true } } },
        orderBy: { startDate: 'asc' },
      }),
    ]);
    res.json({ periodStart, periodEnd, attendance, overtime, leaves });
  } catch (err) { next(err); }
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
            expenses: { select: { amount: true } },
          },
          orderBy: { employee: { lastName: 'asc' } },
        },
      },
    });
    if (!run) return res.status(404).json({ error: 'Payroll run not found' });
    const processedRun = {
      ...run,
      records: run.records.map(({ expenses, ...r }) => ({
        ...r,
        expenseReimbursement: expenses.reduce((s: number, e: { amount: number }) => s + e.amount, 0),
      })),
    };
    res.json(processedRun);
  } catch (err) {
    next(err);
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

interface CutOffPeriodData {
  cutOffFromDay: number;
  cutOffFromIsPrevMonth: boolean;
  cutOffToDay: number;
  name: string;
}

function computePeriodDates(
  year: number, month: number, payPeriodType: number,
  periodStart?: string, periodEnd?: string,
  cutOffPeriod?: CutOffPeriodData
): { periodStart: Date; periodEnd: Date } {
  if (payPeriodType === 9) {
    return { periodStart: new Date(year, 0, 1), periodEnd: new Date(year, 11, 31) };
  }
  // Use configured cut-off period dates if provided
  if (cutOffPeriod && (payPeriodType === 1 || payPeriodType === 2)) {
    let fromYear = year;
    let fromMonthIdx = month - 1; // 0-indexed
    if (cutOffPeriod.cutOffFromIsPrevMonth) {
      if (month === 1) { fromYear = year - 1; fromMonthIdx = 11; }
      else { fromMonthIdx = month - 2; }
    }
    return {
      periodStart: new Date(fromYear, fromMonthIdx, cutOffPeriod.cutOffFromDay),
      periodEnd: new Date(year, month - 1, cutOffPeriod.cutOffToDay),
    };
  }
  // Fallback to hardcoded ranges (for runs not linked to a cut-off period)
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
function buildPeriodLabel(year: number, month: number, payPeriodType: number, description?: string, cutOffName?: string): string {
  const monthStr = MONTH_NAMES[month - 1];
  if (payPeriodType === 1) return cutOffName ? `${monthStr} ${year} · ${cutOffName}` : `${monthStr} ${year} · Type 1 (1st Half)`;
  if (payPeriodType === 2) return cutOffName ? `${monthStr} ${year} · ${cutOffName}` : `${monthStr} ${year} · Type 2 (2nd Half)`;
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
  cutOffPeriodId: z.string().optional(), // links to GlobalSetup CutOffPeriod for date computation
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

    // Fetch cut-off period config from Global Setup if provided
    let cutOffPeriodData: CutOffPeriodData | undefined;
    if (body.cutOffPeriodId) {
      const cop = await (prisma as any).cutOffPeriod.findUnique({ where: { id: body.cutOffPeriodId } });
      if (!cop) return res.status(422).json({ error: 'Cut-off period not found' });
      cutOffPeriodData = cop as CutOffPeriodData;
    }

    let dates: { periodStart: Date; periodEnd: Date };
    try {
      dates = computePeriodDates(year, month ?? 12, payPeriodType, body.periodStart, body.periodEnd, cutOffPeriodData);
    } catch (e: any) {
      return res.status(422).json({ error: e.message });
    }
    const { periodStart, periodEnd } = dates;
    const period = buildPeriodLabel(year, month ?? 12, payPeriodType, description, cutOffPeriodData?.name);

    const existing = await prisma.payrollRun.findFirst({
      where: { year, month: month ?? 12, payPeriodType },
    });
    if (existing?.status === 'PAID') {
      return res.status(422).json({ error: 'A payroll run for this period and type is already paid' });
    }

    // ── Company settings (OT rate, ND rate) ─────────────────────────────────
    const companySettings = await (prisma as any).companySettings.findUnique({ where: { id: 'singleton' } });
    const OT_RATE  = companySettings?.overtimeRate          ?? 1.25;
    const ND_RATE  = companySettings?.nightDifferentialRate ?? 0.10;

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

    // ── Expense reimbursements (regular runs only) ─────────────────────────────
    let pendingExpensesForStamp: Array<{ id: string; employeeId: string }> = [];
    const expenseMap = new Map<string, { ids: string[]; total: number }>();
    if (!is13th) {
      const rawExpenses = await (prisma as any).expenseRequest.findMany({
        where: {
          employeeId: { in: employees.map((e: any) => e.id) },
          status: 'APPROVED',
          payrollRecordId: null,
        },
        select: { id: true, employeeId: true, amount: true },
      });
      pendingExpensesForStamp = rawExpenses;
      for (const exp of rawExpenses) {
        const cur = expenseMap.get(exp.employeeId) ?? { ids: [], total: 0 };
        cur.ids.push(exp.id);
        cur.total += exp.amount;
        expenseMap.set(exp.employeeId, cur);
      }
    }

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
      // Fetch all attendance in the period (including ABSENT so holiday pay for absent-on-regular-holiday works)
      const allAttendanceRaw = await prisma.attendance.findMany({
        where: {
          employeeId: { in: employees.map((e: any) => e.id) },
          date: { gte: periodStart, lte: periodEnd },
        },
        select: { employeeId: true, status: true, overtimeHrs: true, lateMinutes: true, clockInAt: true, clockOutAt: true, date: true },
      });

      // Separate worked records (for days/ot/nd) and all records (for holiday pay lookup)
      const allAttendance = allAttendanceRaw.filter((a: any) => ['PRESENT', 'LATE', 'HALF_DAY'].includes(a.status));

      // Build a map of employeeId+dateStr → status for holiday pay lookups
      const attByEmpDate = new Map<string, string>();
      for (const att of allAttendanceRaw) {
        const d = att.date instanceof Date ? att.date : new Date(att.date);
        const dateStr = d.toISOString().split('T')[0];
        attByEmpDate.set(`${att.employeeId}_${dateStr}`, att.status);
      }

      interface AttTotals { daysWorked: number; minutesLate: number; otHours: number; ndHours: number; }
      const attendanceMap = new Map<string, AttTotals>();
      for (const att of allAttendance) {
        const cur = attendanceMap.get(att.employeeId) ?? { daysWorked: 0, minutesLate: 0, otHours: 0, ndHours: 0 };
        cur.daysWorked += att.status === 'HALF_DAY' ? 0.5 : 1;
        // lateMinutes is stored on the attendance record by attendance.ts at the time of LATE detection
        cur.minutesLate += (att as any).lateMinutes ?? 0;
        // OT hours stored on the attendance record (HR-set or auto-computed from clock-out)
        cur.otHours += (att as any).overtimeHrs ?? 0;
        // Night differential hours computed from actual clock in/out times
        const clockIn  = (att as any).clockInAt  ? new Date((att as any).clockInAt)  : null;
        const clockOut = (att as any).clockOutAt ? new Date((att as any).clockOutAt) : null;
        cur.ndHours += computeNightDiffHours(clockIn, clockOut);
        attendanceMap.set(att.employeeId, cur);
      }

      // ── Holidays in this pay period ────────────────────────────────────────
      const holidaysInPeriod = await (prisma as any).holiday.findMany({
        where: { date: { gte: periodStart, lte: periodEnd } },
        select: { date: true, type: true },
      });
      // Map dateStr → holiday type
      const holidayMap = new Map<string, string>();
      for (const h of holidaysInPeriod) {
        const d = h.date instanceof Date ? h.date : new Date(h.date);
        holidayMap.set(d.toISOString().split('T')[0], h.type);
      }

      // SIL pay: approved SIL leave requests overlapping this period (separate payslip line)
      const silRequests = await prisma.leaveRequest.findMany({
        where: {
          employeeId: { in: employees.map((e: any) => e.id) },
          status: 'APPROVED',
          leaveType: { code: 'SIL', isPaid: true },
          startDate: { lte: periodEnd },
          endDate: { gte: periodStart },
        },
        select: { employeeId: true, startDate: true, endDate: true },
      });

      const silDaysMap = new Map<string, number>();
      for (const req of silRequests) {
        const reqStart = new Date(Math.max(new Date(req.startDate).getTime(), periodStart.getTime()));
        const reqEnd   = new Date(Math.min(new Date(req.endDate).getTime(),   periodEnd.getTime()));
        let days = 0;
        const cur = new Date(reqStart);
        while (cur <= reqEnd) {
          const dow = cur.getDay();
          if (dow !== 0 && dow !== 6) days++; // skip weekends
          cur.setDate(cur.getDate() + 1);
        }
        silDaysMap.set(req.employeeId, (silDaysMap.get(req.employeeId) ?? 0) + days);
      }

      // OT hours are taken directly from attendance.overtimeHrs (HR-set or auto-computed from clock-out)

      // ── 50/50 govt deduction split — fetch global + per-client settings ─────
      const globalPolicies = await (prisma as any).globalPayrollPolicy.findMany({
        where: { type: { in: ['SSS_DEDUCTION', 'PHIC_DEDUCTION', 'HDMF_DEDUCTION'] } },
        select: { type: true, splitHalf: true },
      });
      const globalSplit = {
        sss: globalPolicies.find((p: any) => p.type === 'SSS_DEDUCTION')?.splitHalf ?? false,
        phic: globalPolicies.find((p: any) => p.type === 'PHIC_DEDUCTION')?.splitHalf ?? false,
        hdmf: globalPolicies.find((p: any) => p.type === 'HDMF_DEDUCTION')?.splitHalf ?? false,
      };

      const uniqueClientIds = [...new Set(employees.map((e: any) => e.clientId).filter(Boolean))];
      const deductionPols = uniqueClientIds.length > 0
        ? await prisma.clientPolicy.findMany({
            where: { clientId: { in: uniqueClientIds as string[] }, type: { in: ['SSS_DEDUCTION', 'PHIC_DEDUCTION', 'HDMF_DEDUCTION'] } },
            select: { clientId: true, type: true, value: true },
          })
        : [];
      const clientSplitMap = new Map<string, { sss: boolean; phic: boolean; hdmf: boolean }>();
      for (const pol of deductionPols) {
        const cur = clientSplitMap.get(pol.clientId) ?? { sss: false, phic: false, hdmf: false };
        let isSplit = false;
        try { isSplit = JSON.parse(pol.value ?? '{}')?.split5050 === true; } catch { /* not JSON */ }
        if (pol.type === 'SSS_DEDUCTION') cur.sss = isSplit;
        if (pol.type === 'PHIC_DEDUCTION') cur.phic = isSplit;
        if (pol.type === 'HDMF_DEDUCTION') cur.hdmf = isSplit;
        clientSplitMap.set(pol.clientId, cur);
      }
      const isSemiMonthly = payPeriodType === 1 || payPeriodType === 2;

      // Include employees with attendance OR SIL leave in this period
      records = employees
        .filter((emp: any) => (attendanceMap.get(emp.id)?.daysWorked ?? 0) > 0 || (silDaysMap.get(emp.id) ?? 0) > 0)
        .map((emp: any) => {
          const totals  = attendanceMap.get(emp.id) ?? { daysWorked: 0, minutesLate: 0, otHours: 0, ndHours: 0 };
          const daysWorked = totals.daysWorked;
          const silDays = silDaysMap.get(emp.id) ?? 0;
          const silPay  = silDays > 0 ? (emp.basicSalary / 22) * silDays : 0;

          // Daily-rate employees: gross = dailyRate × daysWorked; monthly: basicSalary/22 × daysWorked
          const useDailyRate = emp.useDailyRate && emp.dailyRate > 0;
          const dailyEquiv   = useDailyRate ? (emp.dailyRate as number) : (emp.basicSalary / 22);
          const hourlyEquiv  = dailyEquiv / 8;
          const otHours      = totals.otHours;
          const overtimePay  = Math.round(otHours * hourlyEquiv * OT_RATE * 100) / 100;

          // ── Holiday pay (Philippine labor law) ──────────────────────────────
          let holidayPay = 0;
          for (const [dateStr, hType] of holidayMap) {
            const attStatus = attByEmpDate.get(`${emp.id}_${dateStr}`) ?? 'ABSENT';
            const worked = ['PRESENT', 'LATE', 'HALF_DAY'].includes(attStatus);
            if (hType === 'REGULAR') {
              // Worked: 200% (already counted 100% in daysWorked → add 100% extra)
              // Absent: 100% (they were not counted in daysWorked → add 100%)
              holidayPay += dailyEquiv; // always add 100% for regular holidays
            } else if (hType === 'SPECIAL_NON_WORKING' || hType === 'SPECIAL_WORKING') {
              // Worked: 130% (already counted 100% → add 30% extra)
              // Absent: 0%
              if (worked) {
                holidayPay += dailyEquiv * 0.30;
              }
            }
          }
          holidayPay = Math.round(holidayPay * 100) / 100;

          // ── Night differential ──────────────────────────────────────────────
          const nightDiffHours = Math.round(totals.ndHours * 100) / 100;
          const nightDifferential = Math.round(nightDiffHours * hourlyEquiv * ND_RATE * 100) / 100;

          const grossPay = dailyEquiv * daysWorked + silPay + overtimePay + holidayPay + nightDifferential;
          // Late deduction: (minutes late / 480) × daily equivalent rate
          const lateDeduction = Math.round((totals.minutesLate / 480) * dailyEquiv * 100) / 100;

          // Statutory contributions — optionally split 50/50 across semi-monthly cutoffs
          // Per-client override takes priority; falls back to global splitHalf setting
          const clientSplit = clientSplitMap.get(emp.clientId) ?? globalSplit;
          const sssContrib = Math.round(computeSSS(emp.basicSalary) * (clientSplit.sss && isSemiMonthly ? 0.5 : 1));
          const philhealthContrib = Math.round(computePhilHealth(emp.basicSalary) * (clientSplit.phic && isSemiMonthly ? 0.5 : 1));
          const pagibigContrib = Math.round(computePagIBIG(emp.basicSalary) * (clientSplit.hdmf && isSemiMonthly ? 0.5 : 1));
          const taxableIncome = Math.max(0, grossPay - sssContrib - philhealthContrib - pagibigContrib);
          const withholdingTax = computeWithholdingTax(taxableIncome);
          const totalDeductions = sssContrib + philhealthContrib + pagibigContrib + withholdingTax;
          const expenseTotal = expenseMap.get(emp.id)?.total ?? 0;
          const netPay = grossPay - totalDeductions - lateDeduction + expenseTotal;
          return {
            payrollRunId: payrollRun.id,
            employeeId: emp.id,
            basicSalary: emp.basicSalary,
            daysWorked,
            grossPay,
            silPay,
            overtimePay,
            allowances: 0,
            otherDeductions: 0,
            lateDeduction,
            holidayPay,
            nightDifferential,
            nightDiffHours,
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

    // Stamp approved expenses with their newly created payroll record IDs
    if (pendingExpensesForStamp.length > 0) {
      const createdRecords = await prisma.payrollRecord.findMany({
        where: { payrollRunId: payrollRun.id },
        select: { id: true, employeeId: true },
      });
      for (const rec of createdRecords) {
        const expInfo = expenseMap.get(rec.employeeId);
        if (expInfo && expInfo.ids.length > 0) {
          await (prisma as any).expenseRequest.updateMany({
            where: { id: { in: expInfo.ids } },
            data: { payrollRecordId: rec.id },
          });
        }
      }
    }

    const rawResult = await prisma.payrollRun.findUnique({
      where: { id: payrollRun.id },
      include: {
        records: {
          include: { employee: { select: EMPLOYEE_SELECT }, expenses: { select: { amount: true } } },
          orderBy: { employee: { lastName: 'asc' } },
        },
      },
    });
    const result = rawResult ? {
      ...rawResult,
      records: rawResult.records.map(({ expenses, ...r }) => ({
        ...r,
        expenseReimbursement: expenses.reduce((s: number, e: { amount: number }) => s + e.amount, 0),
      })),
    } : rawResult;
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

    // Null out expense references before deleting records so expenses revert to "not added to payroll"
    await (prisma as any).expenseRequest.updateMany({
      where: { payrollRecord: { payrollRunId: run.id } },
      data: { payrollRecordId: null },
    });
    await prisma.payrollRecord.deleteMany({ where: { payrollRunId: run.id } });
    await prisma.payrollRun.delete({ where: { id: run.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// PUT /api/payroll/:runId/record/:recordId — update HR-editable fields (DRAFT only)
router.put('/:runId/record/:recordId', requireRole('HR_MANAGER', 'SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const run = await prisma.payrollRun.findUnique({ where: { id: req.params.runId } });
    if (!run) return res.status(404).json({ error: 'Payroll run not found' });
    if (run.status !== 'DRAFT') {
      return res.status(422).json({ error: `Cannot edit a ${run.status} payroll run. Only DRAFT runs are editable.` });
    }

    const body = z.object({
      otherDeductions:     z.number().min(0).optional(),
      otherDeductionsNote: z.string().nullable().optional(),
      lateDeduction:       z.number().min(0).optional(),
      holidayPay:          z.number().min(0).optional(),
      nightDifferential:   z.number().min(0).optional(),
    }).parse(req.body);

    const updateData: Record<string, any> = {};
    if (body.otherDeductions     !== undefined) updateData.otherDeductions     = body.otherDeductions;
    if (body.otherDeductionsNote !== undefined) updateData.otherDeductionsNote = body.otherDeductionsNote;
    if (body.lateDeduction       !== undefined) updateData.lateDeduction       = body.lateDeduction;
    if (body.holidayPay          !== undefined) updateData.holidayPay          = body.holidayPay;
    if (body.nightDifferential   !== undefined) updateData.nightDifferential   = body.nightDifferential;

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
