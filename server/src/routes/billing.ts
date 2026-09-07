import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticate, requireRole } from '../middleware/authenticate';
import { generateInvoicePDF } from '../lib/invoice-pdf';
import { sendInvoiceEmail } from '../lib/email';

const router = Router();
router.use(authenticate);

const PAYMONGO_SECRET = process.env.PAYMONGO_SECRET_KEY ?? '';
const PAYMONGO_BASE = 'https://api.paymongo.com/v1';

// ── PayMongo helpers ──────────────────────────────────────────────────────────

async function createPayMongoLink(amount: number, description: string, billingId: string) {
  if (!PAYMONGO_SECRET) return null;

  const appUrl = process.env.CLIENT_URL || 'http://localhost:5173';
  const response = await fetch(`${PAYMONGO_BASE}/links`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${Buffer.from(`${PAYMONGO_SECRET}:`).toString('base64')}`,
    },
    body: JSON.stringify({
      data: {
        attributes: {
          amount: Math.round(amount * 100), // PayMongo uses centavos
          description,
          remarks: `billing-${billingId}`,
        },
      },
    }),
  });

  if (!response.ok) {
    console.error('PayMongo error:', await response.text());
    return null;
  }

  const data: any = await response.json();
  return {
    id: data.data.id as string,
    url: data.data.attributes.checkout_url as string,
  };
}

// ── Shared includes ───────────────────────────────────────────────────────────

const invoiceInclude = {
  client: {
    include: {
      employees: {
        where: { status: { in: ['ACTIVE', 'ON_LEAVE'] as any } },
        select: {
          id: true, firstName: true, lastName: true, position: true,
          resourceCost: true,
        },
      },
    },
  },
};

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/billing  — all billings (with optional filters)
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { clientId, status } = req.query as Record<string, string>;
    const billings = await prisma.billing.findMany({
      where: {
        ...(clientId ? { clientId } : {}),
        ...(status ? { status: status as any } : {}),
      },
      include: {
        client: { select: { id: true, name: true, billingCycle: true } },
      },
      orderBy: { billingDate: 'desc' },
    });
    res.json(billings);
  } catch (err) { next(err); }
});

// GET /api/billing/summary  — dashboard numbers
router.get('/summary', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [pending, paid, dueSoon] = await Promise.all([
      prisma.billing.aggregate({
        where: { status: 'PENDING' },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.billing.aggregate({
        where: { status: 'PAID' },
        _sum: { amount: true },
        _count: true,
      }),
      // billings due within the next 7 days
      prisma.billing.findMany({
        where: {
          status: 'PENDING',
          billingDate: { lte: new Date(Date.now() + 7 * 86400_000) },
        },
        include: { client: { select: { id: true, name: true } } },
        orderBy: { billingDate: 'asc' },
        take: 10,
      }),
    ]);

    res.json({
      pendingAmount: pending._sum.amount ?? 0,
      pendingCount: pending._count,
      paidAmount: paid._sum.amount ?? 0,
      paidCount: paid._count,
      dueSoon,
    });
  } catch (err) { next(err); }
});

// GET /api/billing/clients-due  — clients whose billing cycle hits today or overdue
router.get('/clients-due', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const today = new Date();

    // Find client IDs that already have a PENDING invoice
    const pendingBillings = await prisma.billing.findMany({
      where: { status: 'PENDING' },
      select: { clientId: true },
    });
    const clientsWithPending = new Set(pendingBillings.map(b => b.clientId));

    const clients = await prisma.client.findMany({
      where: { activeContract: true },
      include: {
        employees: {
          where: { status: { in: ['ACTIVE', 'ON_LEAVE'] } },
          select: { id: true, resourceCost: true },
        },
        _count: { select: { employees: true } },
      },
    });

    // Exclude clients that already have a pending invoice
    const billableClients = clients.filter(c => !clientsWithPending.has(c.id));

    // Determine which clients are due for billing today
    const due = billableClients.filter(c => {
      const day = today.getDate();
      const dow = today.getDay(); // 0 = Sunday
      switch (c.billingCycle) {
        case 'WEEKLY': return dow === 1; // every Monday
        case 'EVERY_15TH': return day === 15;
        case 'EVERY_30TH': return day === 30;
        case 'MONTHLY': return c.billingDate ? day === c.billingDate : day === 1;
        default: return false;
      }
    });

    res.json({ due, all: billableClients });
  } catch (err) { next(err); }
});

// POST /api/billing/generate  — generate billing for one or more clients
router.post(
  '/generate',
  requireRole('HR_MANAGER', 'SUPER_ADMIN'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { clientIds, billingDate, notes, lineItems } = z.object({
        clientIds: z.array(z.string()).min(1),
        billingDate: z.string(), // ISO date string
        notes: z.string().optional(),
        lineItems: z.array(z.object({
          description: z.string().min(1),
          amount: z.number(),
        })).optional(),
      }).parse(req.body);

      const date = new Date(billingDate);
      const results = [];
      const skipped: { clientId: string; name: string; reason: string }[] = [];

      for (const clientId of clientIds) {
        // Get client with active employees and their resource costs
        const client = await prisma.client.findUnique({
          where: { id: clientId },
          include: {
            employees: {
              where: { status: { in: ['ACTIVE', 'ON_LEAVE'] } },
              select: { id: true, firstName: true, lastName: true, resourceCost: true, basicSalary: true },
            },
          },
        });
        if (!client) {
          skipped.push({ clientId, name: clientId, reason: 'Client not found' });
          continue;
        }

        if (client.employees.length === 0) {
          skipped.push({ clientId, name: client.name, reason: 'No active resources deployed' });
          continue;
        }

        // Sum resource costs (fall back to basicSalary if resourceCost not set)
        const resourceTotal = client.employees.reduce((sum: number, e: any) => {
          return sum + (e.resourceCost ?? e.basicSalary ?? 0);
        }, 0);

        // Add any additional line item charges
        const lineItemTotal = (lineItems ?? []).reduce((sum: number, li: any) => sum + li.amount, 0);
        const amount = resourceTotal + lineItemTotal;

        if (amount <= 0) {
          skipped.push({ clientId, name: client.name, reason: 'Total amount is ₱0 — set resource costs on deployed employees or add line charges' });
          continue;
        }

        const description = `${client.name} — billing for ${date.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })} (${client.employees.length} resource${client.employees.length !== 1 ? 's' : ''})`;

        // Create billing record
        const billing = await prisma.billing.create({
          data: {
            clientId,
            billingDate: date,
            amount,
            notes,
            lineItems: lineItems ?? [],
            status: 'PENDING',
          },
        });

        // Create PayMongo payment link
        const link = await createPayMongoLink(amount, description, billing.id);
        if (link) {
          await prisma.billing.update({
            where: { id: billing.id },
            data: { paymentLinkId: link.id, paymentLinkUrl: link.url },
          });
          billing.paymentLinkId = link.id;
          billing.paymentLinkUrl = link.url;
        }

        // Auto-send invoice email if client has a contact email
        if (client.contactEmail) {
          try {
            const billingForPdf = await prisma.billing.findUnique({
              where: { id: billing.id },
              include: invoiceInclude,
            });
            if (billingForPdf) {
              const pdf = await generateInvoicePDF(billingForPdf);
              await sendInvoiceEmail(client.contactEmail, billingForPdf, pdf);
            }
          } catch (emailErr) {
            // Don't fail the whole request if email sending fails
            console.error(`Failed to send invoice email for billing ${billing.id}:`, emailErr);
          }
        }

        results.push({ ...billing, client: { id: client.id, name: client.name } });
      }

      res.status(201).json({ generated: results, skipped });
    } catch (err) { next(err); }
  }
);

// POST /api/billing/:id/resend  — regenerate/resend payment link
router.post('/:id/resend', requireRole('HR_MANAGER', 'SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const billing = await prisma.billing.findUnique({
      where: { id: req.params.id },
      include: { client: { select: { name: true } } },
    });
    if (!billing) return res.status(404).json({ error: 'Billing not found' });
    if (billing.status === 'PAID') return res.status(422).json({ error: 'Billing already paid' });

    const description = `${billing.client.name} — invoice #${billing.id.slice(-6).toUpperCase()}`;
    const link = await createPayMongoLink(billing.amount, description, billing.id);

    const updated = await prisma.billing.update({
      where: { id: billing.id },
      data: link ? { paymentLinkId: link.id, paymentLinkUrl: link.url } : {},
    });

    res.json(updated);
  } catch (err) { next(err); }
});

// PUT /api/billing/:id/mark-paid  — manually mark as paid
router.put('/:id/mark-paid', requireRole('HR_MANAGER', 'SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { paymentRef } = z.object({ paymentRef: z.string().optional() }).parse(req.body);
    const billing = await prisma.billing.update({
      where: { id: req.params.id },
      data: { status: 'PAID', paidAt: new Date(), paymentRef },
    });
    res.json(billing);
  } catch (err) { next(err); }
});

// POST /api/billing/webhook/paymongo  — PayMongo webhook (no auth middleware)
router.post('/webhook/paymongo', async (req: Request, res: Response) => {
  try {
    const event = req.body;
    // PayMongo sends events like "link.payment.paid"
    if (event?.data?.attributes?.type === 'link.payment.paid') {
      const linkId = event.data.attributes.data?.id;
      if (linkId) {
        await prisma.billing.updateMany({
          where: { paymentLinkId: linkId, status: 'PENDING' },
          data: { status: 'PAID', paidAt: new Date() },
        });
      }
    }
    res.json({ received: true });
  } catch {
    res.json({ received: true });
  }
});

// ── Reports ───────────────────────────────────────────────────────────────────

// GET /api/billing/reports/billing-summary
router.get('/reports/billing-summary', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { from, to, clientIds } = req.query as Record<string, string>;
    const where: any = {};
    if (from) where.billingDate = { gte: new Date(from) };
    if (to) where.billingDate = { ...(where.billingDate ?? {}), lte: new Date(to) };
    if (clientIds) where.clientId = { in: clientIds.split(',') };

    const billings = await prisma.billing.findMany({
      where,
      include: { client: { select: { id: true, name: true } } },
      orderBy: [{ client: { name: 'asc' } }, { billingDate: 'desc' }],
    });

    // Group by client — shape matches BillingSummaryRow on the frontend
    const byClient = new Map<string, { client: { id: string; name: string }; totalBilled: number; totalPaid: number; totalPending: number; invoiceCount: number }>();
    for (const b of billings) {
      const existing = byClient.get(b.clientId) ?? { client: { id: b.clientId, name: b.client.name }, totalBilled: 0, totalPaid: 0, totalPending: 0, invoiceCount: 0 };
      existing.totalBilled += b.amount;
      existing.invoiceCount++;
      if (b.status === 'PAID') existing.totalPaid += b.amount;
      else if (b.status === 'PENDING') existing.totalPending += b.amount;
      byClient.set(b.clientId, existing);
    }

    // Return both the raw billings and the grouped summary
    res.json([...byClient.values()]);
  } catch (err) { next(err); }
});

// GET /api/billing/reports/margin
router.get('/reports/margin', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { clientIds, employeeIds } = req.query as Record<string, string>;
    const where: any = { status: { not: 'TERMINATED' } };
    if (clientIds) where.clientId = { in: clientIds.split(',') };
    if (employeeIds) where.id = { in: employeeIds.split(',') };

    const employees = await prisma.employee.findMany({
      where,
      select: {
        id: true, firstName: true, lastName: true, position: true,
        avatarColor: true, basicSalary: true, resourceCost: true, payrollCost: true,
        department: { select: { name: true } },
        client: { select: { id: true, name: true } },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });

    // Shape matches MarginRow on the frontend
    const rows = employees.map((e: any) => {
      const rc = e.resourceCost ?? 0;
      const pc = e.payrollCost ?? e.basicSalary ?? 0;
      const margin = rc - pc;
      return {
        employee: { id: e.id, firstName: e.firstName, lastName: e.lastName, position: e.position, department: e.department },
        client: e.client,
        resourceCost: rc,
        payrollCost: pc,
        margin,
        marginPct: rc > 0 ? (margin / rc) * 100 : 0,
      };
    });

    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/billing/reports/deployment
router.get('/reports/deployment', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { clientIds, employeeIds } = req.query as Record<string, string>;
    const where: any = { status: { not: 'TERMINATED' } };
    if (clientIds) where.clientId = { in: clientIds.split(',') };
    if (employeeIds) where.id = { in: employeeIds.split(',') };

    const employees = await prisma.employee.findMany({
      where,
      select: {
        id: true, firstName: true, lastName: true, employeeNo: true,
        position: true, avatarColor: true, status: true, hireDate: true,
        resourceCost: true, payrollCost: true, basicSalary: true,
        department: { select: { name: true } },
        client: { select: { id: true, name: true } },
      },
      orderBy: [{ client: { name: 'asc' } }, { lastName: 'asc' }],
    });

    // Shape matches DeploymentRow on the frontend
    const deploymentRows = employees.map((e: any) => ({
      employee: {
        id: e.id, firstName: e.firstName, lastName: e.lastName,
        employeeNo: e.employeeNo, position: e.position,
        avatarColor: e.avatarColor, status: e.status, hireDate: e.hireDate,
        department: e.department,
      },
      client: e.client,
      resourceCost: e.resourceCost,
      payrollCost: e.payrollCost,
    }));

    res.json(deploymentRows);
  } catch (err) { next(err); }
});

// GET /api/billing/reports/attendance-summary
router.get('/reports/attendance-summary', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { from, to, employeeIds, clientIds } = req.query as Record<string, string>;
    const dateFilter: any = {};
    if (from) dateFilter.gte = new Date(from);
    if (to) dateFilter.lte = new Date(to);

    const empWhere: any = {};
    if (employeeIds) empWhere.id = { in: employeeIds.split(',') };
    if (clientIds) empWhere.clientId = { in: clientIds.split(',') };

    const employees = await prisma.employee.findMany({
      where: { status: { not: 'TERMINATED' }, ...empWhere },
      select: {
        id: true, firstName: true, lastName: true, avatarColor: true, position: true,
        department: { select: { name: true } },
      },
    });
    const empIds = employees.map(e => e.id);

    const records = await prisma.attendance.findMany({
      where: {
        employeeId: { in: empIds },
        ...(Object.keys(dateFilter).length ? { date: dateFilter } : {}),
      },
      select: { employeeId: true, status: true, overtimeHrs: true },
    });

    const empMap = new Map(employees.map(e => [e.id, e]));
    const stats = new Map<string, { present: number; late: number; absent: number; halfDay: number; onLeave: number; totalOT: number }>();

    for (const r of records) {
      const s = stats.get(r.employeeId) ?? { present: 0, late: 0, absent: 0, halfDay: 0, onLeave: 0, totalOT: 0 };
      if (r.status === 'PRESENT') s.present++;
      else if (r.status === 'LATE') { s.present++; s.late++; }
      else if (r.status === 'ABSENT') s.absent++;
      else if (r.status === 'HALF_DAY') s.halfDay++;
      else if (r.status === 'ON_LEAVE') s.onLeave++;
      s.totalOT += r.overtimeHrs;
      stats.set(r.employeeId, s);
    }

    // Shape matches AttendanceSummaryRow on the frontend (adds total + attendanceRate)
    const rows = employees.map((e: any) => {
      const s = stats.get(e.id) ?? { present: 0, late: 0, absent: 0, halfDay: 0, onLeave: 0, totalOT: 0 };
      const total = s.present + s.absent + s.halfDay + s.onLeave;
      const attendanceRate = total > 0 ? ((s.present + s.halfDay * 0.5) / total) * 100 : 0;
      return { employee: e, ...s, total, attendanceRate };
    });

    res.json(rows);
  } catch (err) { next(err); }
});

// ── Invoice PDF & Email ───────────────────────────────────────────────────────

// GET /api/billing/:id/pdf  — download invoice as PDF
router.get('/:id/pdf', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const billing = await prisma.billing.findUnique({
      where: { id: req.params.id },
      include: invoiceInclude,
    });
    if (!billing) return res.status(404).json({ error: 'Billing not found' });

    const pdf = await generateInvoicePDF(billing);
    const invoiceNo = billing.id.slice(-8).toUpperCase();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoiceNo}.pdf"`);
    res.send(pdf);
  } catch (err) { next(err); }
});

// POST /api/billing/:id/send-invoice  — email PDF to client contact
router.post('/:id/send-invoice', requireRole('HR_MANAGER', 'SUPER_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const billing = await prisma.billing.findUnique({
      where: { id: req.params.id },
      include: invoiceInclude,
    });
    if (!billing) return res.status(404).json({ error: 'Billing not found' });

    const toEmail = billing.client.contactEmail;
    if (!toEmail) {
      return res.status(422).json({ error: 'No contact email on this client. Add one in Client Records first.' });
    }

    const pdf = await generateInvoicePDF(billing);
    await sendInvoiceEmail(toEmail, billing, pdf);

    res.json({ sent: true, email: toEmail });
  } catch (err: any) {
    if (err.message?.includes('SMTP not configured')) {
      return res.status(503).json({ error: err.message });
    }
    next(err);
  }
});

export default router;