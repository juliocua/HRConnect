import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';

const router = Router();

// ── Statutory deductions — pulled from existing PayrollRecord data ─────────────

// GET /api/deductions/:employeeId/statutory?limit=24
router.get('/:employeeId/statutory', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { employeeId } = req.params;
    const limit = Math.min(Number(req.query.limit ?? 24), 120);

    const records = await prisma.payrollRecord.findMany({
      where: { employeeId },
      orderBy: { payrollRun: { periodStart: 'desc' } },
      take: limit,
      select: {
        id: true,
        basicSalary: true,
        grossPay: true,
        sssContrib: true,
        philhealthContrib: true,
        pagibigContrib: true,
        withholdingTax: true,
        totalDeductions: true,
        otherDeductions: true,
        otherDeductionsNote: true,
        lateDeduction: true,
        netPay: true,
        daysWorked: true,
        payrollRun: {
          select: {
            id: true,
            period: true,
            periodStart: true,
            periodEnd: true,
            payPeriodType: true,
            status: true,
          },
        },
      },
    });

    res.json(records);
  } catch (err) { next(err); }
});

// ── Other deductions history — all records where otherDeductions > 0 ──────────

// GET /api/deductions/:employeeId/other
router.get('/:employeeId/other', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { employeeId } = req.params;

    const records = await prisma.payrollRecord.findMany({
      where: { employeeId, otherDeductions: { gt: 0 } },
      orderBy: { payrollRun: { periodStart: 'desc' } },
      select: {
        id: true,
        otherDeductions: true,
        otherDeductionsNote: true,
        payrollRun: {
          select: {
            id: true,
            period: true,
            periodStart: true,
            periodEnd: true,
          },
        },
      },
    });

    res.json(records);
  } catch (err) { next(err); }
});

// ── Loans & Cash Advances ─────────────────────────────────────────────────────

// GET /api/deductions/:employeeId/loans
router.get('/:employeeId/loans', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { employeeId } = req.params;

    const loans = await prisma.employeeLoan.findMany({
      where: { employeeId },
      orderBy: { createdAt: 'desc' },
      include: {
        payments: {
          orderBy: { paidAt: 'desc' },
        },
      },
    });

    res.json(loans);
  } catch (err) { next(err); }
});

// POST /api/deductions/:employeeId/loans — create a new loan/advance
const LoanCreateSchema = z.object({
  type: z.enum(['CASH_ADVANCE', 'LOAN']).default('CASH_ADVANCE'),
  description: z.string().optional(),
  principal: z.number().positive(),
});

router.post('/:employeeId/loans', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { employeeId } = req.params;
    const body = LoanCreateSchema.parse(req.body);

    // Verify employee exists
    const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true } });
    if (!emp) return res.status(404).json({ error: 'Employee not found' });

    const loan = await prisma.employeeLoan.create({
      data: {
        employeeId,
        type: body.type,
        description: body.description ?? null,
        principal: body.principal,
        balance: body.principal,
        status: 'ACTIVE',
      },
      include: { payments: true },
    });

    res.status(201).json(loan);
  } catch (err) { next(err); }
});

// POST /api/deductions/loans/:loanId/payment — record a manual payment
const PaymentSchema = z.object({
  amount: z.number().positive(),
  note: z.string().optional(),
  payrollRunId: z.string().optional(),
  paidAt: z.string().optional(), // ISO date string
});

router.post('/loans/:loanId/payment', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { loanId } = req.params;
    const body = PaymentSchema.parse(req.body);

    const loan = await prisma.employeeLoan.findUnique({ where: { id: loanId } });
    if (!loan) return res.status(404).json({ error: 'Loan not found' });
    if (loan.status === 'SETTLED') return res.status(409).json({ error: 'Loan is already settled' });

    const appliedAmount = Math.min(body.amount, loan.balance);
    const newBalance = Math.max(0, loan.balance - appliedAmount);
    const newStatus = newBalance <= 0 ? 'SETTLED' : 'ACTIVE';

    const [payment] = await prisma.$transaction([
      prisma.employeeLoanPayment.create({
        data: {
          loanId,
          amount: appliedAmount,
          note: body.note ?? null,
          payrollRunId: body.payrollRunId ?? null,
          paidAt: body.paidAt ? new Date(body.paidAt) : new Date(),
        },
      }),
      prisma.employeeLoan.update({
        where: { id: loanId },
        data: { balance: newBalance, status: newStatus },
      }),
    ]);

    const updated = await prisma.employeeLoan.findUnique({
      where: { id: loanId },
      include: { payments: { orderBy: { paidAt: 'desc' } } },
    });

    res.json({ payment, loan: updated });
  } catch (err) { next(err); }
});

// PATCH /api/deductions/loans/:loanId — update description or mark settled
const LoanUpdateSchema = z.object({
  description: z.string().optional(),
  status: z.enum(['ACTIVE', 'SETTLED']).optional(),
});

router.patch('/loans/:loanId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { loanId } = req.params;
    const body = LoanUpdateSchema.parse(req.body);

    const loan = await prisma.employeeLoan.update({
      where: { id: loanId },
      data: {
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
      },
      include: { payments: { orderBy: { paidAt: 'desc' } } },
    });

    res.json(loan);
  } catch (err) { next(err); }
});

// DELETE /api/deductions/loans/:loanId — only if no payments recorded
router.delete('/loans/:loanId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { loanId } = req.params;

    const count = await prisma.employeeLoanPayment.count({ where: { loanId } });
    if (count > 0) return res.status(409).json({ error: 'Cannot delete a loan with recorded payments' });

    await prisma.employeeLoan.delete({ where: { id: loanId } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
