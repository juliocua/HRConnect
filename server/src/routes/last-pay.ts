import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// ── GET /api/last-pay/clearance-items ──────────────────────────────────────
// List all clearance items (master list)
router.get('/clearance-items', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const items = await (prisma as any).clearanceItem.findMany({
      orderBy: { order: 'asc' },
    });
    res.json(items);
  } catch (err) {
    next(err);
  }
});

// ── POST /api/last-pay/clearance-items ────────────────────────────────────
// Create a new clearance item
router.post('/clearance-items', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!['SUPER_ADMIN', 'HR_MANAGER'].includes(req.user!.role)) return res.status(403).json({ error: 'HR Manager or above required' });
    const { name, order } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(422).json({ error: 'name is required' });
    }
    const item = await (prisma as any).clearanceItem.create({
      data: { name: name.trim(), order: order ?? 0 },
    });

    // Push new item to all employees currently tracked in any last-pay run
    const trackedEmpIds = await (prisma as any).employeeClearance.findMany({
      select: { employeeId: true },
      distinct: ['employeeId'],
    });
    for (const { employeeId } of trackedEmpIds) {
      await (prisma as any).employeeClearance.upsert({
        where: { employeeId_clearanceItemId: { employeeId, clearanceItemId: item.id } },
        update: {},
        create: { employeeId, clearanceItemId: item.id, name: item.name, isCleared: false },
      });
    }

    res.status(201).json(item);
  } catch (err) {
    next(err);
  }
});

// ── PUT /api/last-pay/clearance-items/:id ────────────────────────────────
// Update a clearance item (name, order, isActive)
router.put('/clearance-items/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!['SUPER_ADMIN', 'HR_MANAGER'].includes(req.user!.role)) return res.status(403).json({ error: 'HR Manager or above required' });
    const { name, order, isActive } = req.body;
    const data: any = {};
    if (name !== undefined) data.name = String(name).trim();
    if (order !== undefined) data.order = Number(order);
    if (isActive !== undefined) data.isActive = Boolean(isActive);

    const item = await (prisma as any).clearanceItem.update({
      where: { id: req.params.id },
      data,
    });
    res.json(item);
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/last-pay/clearance-items/:id ─────────────────────────────
router.delete('/clearance-items/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!['SUPER_ADMIN', 'HR_MANAGER'].includes(req.user!.role)) return res.status(403).json({ error: 'HR Manager or above required' });
    await (prisma as any).employeeClearance.deleteMany({ where: { clearanceItemId: req.params.id } });
    await (prisma as any).clearanceItem.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/last-pay/employees ──────────────────────────────────────────
// List employees being tracked (those with any EmployeeClearance record)
router.get('/employees', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Find employees in any last-pay payroll run
    const runRecords = await prisma.payrollRecord.findMany({
      where: { payrollRun: { payPeriodType: 10 } },
      select: { employeeId: true },
      distinct: ['employeeId'],
    });
    const empIds = runRecords.map((r: any) => r.employeeId);

    const employees = await prisma.employee.findMany({
      where: { id: { in: empIds } },
      select: {
        id: true,
        employeeNo: true,
        firstName: true,
        lastName: true,
        position: true,
        avatarColor: true,
        separationDate: true,
        basicSalary: true,
        dailyRate: true,
        useDailyRate: true,
        client: { select: { id: true, name: true } },
        leaveBalances: {
          where: { leaveType: { code: 'SIL' } },
          select: { totalDays: true, usedDays: true, pendingDays: true },
        },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });

    // Attach clearances + lastPayRecord
    const results = await Promise.all(employees.map(async (emp: any) => {
      const clearances = await (prisma as any).employeeClearance.findMany({
        where: { employeeId: emp.id },
        include: { clearanceItem: true },
        orderBy: { clearanceItem: { order: 'asc' } },
      });
      // Get the most recent Type 10 payroll record for this employee
      const lastPayRecord = await prisma.payrollRecord.findFirst({
        where: { employeeId: emp.id, payrollRun: { payPeriodType: 10 } },
        orderBy: { payrollRun: { periodEnd: 'desc' } },
        select: {
          id: true,
          basicSalary: true,
          netPay: true,
          sssContrib: true,
          philhealthContrib: true,
          pagibigContrib: true,
          withholdingTax: true,
          thirteenthMonthPay: true,
          silConversion: true,
          otherDeductions: true,
        },
      });
      return {
        ...emp,
        leaveBalance: (emp.leaveBalances[0]?.totalDays ?? 0) - (emp.leaveBalances[0]?.usedDays ?? 0) - (emp.leaveBalances[0]?.pendingDays ?? 0),
        clearances,
        lastPayRecord: lastPayRecord ?? null,
      };
    }));

    res.json(results);
  } catch (err) {
    next(err);
  }
});

// ── PUT /api/last-pay/clearances/:clearanceId ────────────────────────────
// Toggle a single clearance item (isCleared)
router.put('/clearances/:clearanceId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { isCleared } = req.body;
    const data: any = { isCleared: Boolean(isCleared) };
    if (isCleared) {
      data.clearedById = req.user!.userId;
      data.clearedAt = new Date();
    } else {
      data.clearedById = null;
      data.clearedAt = null;
    }
    const updated = await (prisma as any).employeeClearance.update({
      where: { id: req.params.clearanceId },
      data,
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

export default router;
