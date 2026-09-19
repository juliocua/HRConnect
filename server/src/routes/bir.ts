import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/authenticate';

const router = Router();

// All BIR routes require authentication
router.use(authenticate);

/**
 * GET /api/bir?year=2025
 * Returns aggregated payroll data for BIR forms (HR roles only)
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const role = req.user?.role;
    if (!['SUPER_ADMIN', 'HR_MANAGER', 'HR_STAFF'].includes(role || '')) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const year = parseInt(req.query.year as string) || new Date().getFullYear();

    // Fetch company settings
    const company = await (prisma as any).companySettings.findFirst();

    // Get all payroll runs for the year
    const runs = await (prisma as any).payrollRun.findMany({
      where: { year },
      select: { id: true, month: true, payPeriodType: true, periodStart: true, periodEnd: true },
    });

    const runIds = runs.map((r: any) => r.id);

    // Get all payroll records for these runs
    const records = await (prisma as any).payrollRecord.findMany({
      where: { payrollRunId: { in: runIds } },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            middleName: true,
            tinNo: true,
            sssNo: true,
            philhealthNo: true,
            pagibigNo: true,
            position: true,
            basicSalary: true,
          },
        },
        payrollRun: {
          select: { month: true, year: true, payPeriodType: true, periodStart: true, periodEnd: true },
        },
      },
    });

    // Build per-employee annual summary
    const employeeMap: Record<number, any> = {};
    for (const rec of records) {
      const emp = rec.employee;
      if (!employeeMap[emp.id]) {
        employeeMap[emp.id] = {
          employeeId: emp.id,
          name: [emp.lastName, emp.firstName, emp.middleName].filter(Boolean).join(', '),
          firstName: emp.firstName,
          lastName: emp.lastName,
          middleName: emp.middleName || '',
          position: emp.position || '',
          tinNo: emp.tinNo || '',
          sssNo: emp.sssNo || '',
          philhealthNo: emp.philhealthNo || '',
          pagibigNo: emp.pagibigNo || '',
          basicSalary: emp.basicSalary || 0,
          grossPay: 0,
          netPay: 0,
          withholdingTax: 0,
          sssContrib: 0,
          philhealthContrib: 0,
          pagibigContrib: 0,
          monthlyBreakdown: {} as Record<number, any>,
        };
      }

      const entry = employeeMap[emp.id];
      entry.grossPay += rec.grossPay || 0;
      entry.netPay += rec.netPay || 0;
      entry.withholdingTax += rec.withholdingTax || 0;
      entry.sssContrib += rec.sssContrib || 0;
      entry.philhealthContrib += rec.philhealthContrib || 0;
      entry.pagibigContrib += rec.pagibigContrib || 0;

      const month = rec.payrollRun.month;
      if (!entry.monthlyBreakdown[month]) {
        entry.monthlyBreakdown[month] = {
          grossPay: 0,
          withholdingTax: 0,
          sssContrib: 0,
          philhealthContrib: 0,
          pagibigContrib: 0,
        };
      }
      entry.monthlyBreakdown[month].grossPay += rec.grossPay || 0;
      entry.monthlyBreakdown[month].withholdingTax += rec.withholdingTax || 0;
      entry.monthlyBreakdown[month].sssContrib += rec.sssContrib || 0;
      entry.monthlyBreakdown[month].philhealthContrib += rec.philhealthContrib || 0;
      entry.monthlyBreakdown[month].pagibigContrib += rec.pagibigContrib || 0;
    }

    // Monthly totals for 1601-C (per month remittance)
    const monthlyTotals: Record<number, any> = {};
    for (let m = 1; m <= 12; m++) {
      monthlyTotals[m] = { month: m, withholdingTax: 0, sssContrib: 0, philhealthContrib: 0, pagibigContrib: 0, grossPay: 0 };
    }
    for (const emp of Object.values(employeeMap)) {
      for (const [monthStr, bd] of Object.entries(emp.monthlyBreakdown as Record<string, any>)) {
        const m = parseInt(monthStr);
        monthlyTotals[m].withholdingTax += bd.withholdingTax;
        monthlyTotals[m].sssContrib += bd.sssContrib;
        monthlyTotals[m].philhealthContrib += bd.philhealthContrib;
        monthlyTotals[m].pagibigContrib += bd.pagibigContrib;
        monthlyTotals[m].grossPay += bd.grossPay;
      }
    }

    res.json({
      year,
      company: company
        ? {
            name: company.companyName || '',
            taxNumber: company.taxNumber || '',
            address: company.address || '',
          }
        : { name: '', taxNumber: '', address: '' },
      employees: Object.values(employeeMap),
      monthlyTotals: Object.values(monthlyTotals),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/bir/my?year=2025
 * Returns BIR data for the currently authenticated employee
 */
router.get('/my', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const year = parseInt(req.query.year as string) || new Date().getFullYear();

    const employee = await (prisma as any).employee.findFirst({
      where: { userId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        middleName: true,
        tinNo: true,
        sssNo: true,
        philhealthNo: true,
        pagibigNo: true,
        position: true,
        basicSalary: true,
      },
    });

    if (!employee) return res.status(404).json({ error: 'Employee record not found' });

    const company = await (prisma as any).companySettings.findFirst();

    const runs = await (prisma as any).payrollRun.findMany({
      where: { year },
      select: { id: true, month: true, payPeriodType: true, periodStart: true, periodEnd: true },
    });

    const runIds = runs.map((r: any) => r.id);

    const records = await (prisma as any).payrollRecord.findMany({
      where: { payrollRunId: { in: runIds }, employeeId: employee.id },
      include: {
        payrollRun: {
          select: { month: true, year: true, payPeriodType: true, periodStart: true, periodEnd: true },
        },
      },
    });

    let grossPay = 0, netPay = 0, withholdingTax = 0, sssContrib = 0, philhealthContrib = 0, pagibigContrib = 0;
    const monthlyBreakdown: Record<number, any> = {};

    for (const rec of records) {
      grossPay += rec.grossPay || 0;
      netPay += rec.netPay || 0;
      withholdingTax += rec.withholdingTax || 0;
      sssContrib += rec.sssContrib || 0;
      philhealthContrib += rec.philhealthContrib || 0;
      pagibigContrib += rec.pagibigContrib || 0;

      const month = rec.payrollRun.month;
      if (!monthlyBreakdown[month]) {
        monthlyBreakdown[month] = { grossPay: 0, withholdingTax: 0, sssContrib: 0, philhealthContrib: 0, pagibigContrib: 0 };
      }
      monthlyBreakdown[month].grossPay += rec.grossPay || 0;
      monthlyBreakdown[month].withholdingTax += rec.withholdingTax || 0;
      monthlyBreakdown[month].sssContrib += rec.sssContrib || 0;
      monthlyBreakdown[month].philhealthContrib += rec.philhealthContrib || 0;
      monthlyBreakdown[month].pagibigContrib += rec.pagibigContrib || 0;
    }

    res.json({
      year,
      company: company
        ? { name: company.companyName || '', taxNumber: company.taxNumber || '', address: company.address || '' }
        : { name: '', taxNumber: '', address: '' },
      employee: {
        firstName: employee.firstName,
        lastName: employee.lastName,
        middleName: employee.middleName || '',
        tinNo: employee.tinNo || '',
        sssNo: employee.sssNo || '',
        philhealthNo: employee.philhealthNo || '',
        pagibigNo: employee.pagibigNo || '',
        position: employee.position || '',
        basicSalary: employee.basicSalary || 0,
      },
      grossPay,
      netPay,
      withholdingTax,
      sssContrib,
      philhealthContrib,
      pagibigContrib,
      monthlyBreakdown,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
