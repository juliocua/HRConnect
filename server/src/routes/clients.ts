import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { authenticate, requireRole } from '../middleware/authenticate';

const router = Router();
router.use(authenticate);

const ClientSchema = z.object({
  name: z.string().min(1),
  address: z.string().optional(),
  contactName: z.string().optional(),
  contactEmail: z.string().email().optional().or(z.literal('')),
  contactPhone: z.string().optional(),
  servicesOffered: z.string().optional(),
  specificRequest: z.string().optional(),
  billingCycle: z.enum(['WEEKLY', 'EVERY_15TH', 'EVERY_30TH', 'MONTHLY', 'BI_MONTHLY']).optional(),
  billingDate: z.number().int().min(1).max(31).optional().nullable(),
  // Bi-monthly billing configuration — all six are distinct backend fields
  biMonthlyH1CutFrom: z.number().int().min(1).max(31).optional().nullable(),
  biMonthlyH1CutTo:   z.number().int().min(1).max(31).optional().nullable(),
  biMonthlyH1BillDay: z.number().int().min(1).max(31).optional().nullable(),
  biMonthlyH2CutFrom: z.number().int().min(1).max(31).optional().nullable(),
  biMonthlyH2CutTo:   z.number().int().min(1).max(31).optional().nullable(),
  biMonthlyH2BillDay: z.number().int().min(1).max(31).optional().nullable(),
  payPeriodType: z.number().int().optional().nullable(),
  adminFeeRate: z.number().min(0).max(100).optional().nullable(),
  isVatable: z.boolean().optional(),
  hasEwt: z.boolean().optional(),
  billingTerms: z.string().optional().nullable(),
  activeContract: z.boolean().optional(),
  clientSignatoryName: z.string().optional().nullable(),
  clientSignatoryTitle: z.string().optional().nullable(),
});

const BranchSchema = z.object({
  name: z.string().min(1),
  address: z.string().optional().nullable(),
});

const PolicySchema = z.object({
  type: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  value: z.string().optional().nullable(),
});

// GET /api/clients
router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const clients = await prisma.client.findMany({
      include: {
        _count: { select: { employees: true, billings: true } },
        branches: { select: { id: true, name: true }, orderBy: { name: 'asc' } },
      },
      orderBy: { name: 'asc' },
    });
    res.json(clients);
  } catch (err) { next(err); }
});

// GET /api/clients/:id
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const client = await prisma.client.findUnique({
      where: { id: req.params.id },
      include: {
        policies: { orderBy: { createdAt: 'asc' } },
        branches: { orderBy: { name: 'asc' } },
        employees: {
          select: {
            id: true, firstName: true, lastName: true,
            position: true, avatarColor: true, status: true,
            resourceCost: true, payrollCost: true,
            branchId: true,
            branch: { select: { id: true, name: true } },
          },
          where: { status: { not: 'TERMINATED' } },
        },
        billings: {
          orderBy: { billingDate: 'desc' },
          take: 50,
        },
      },
    });
    if (!client) return res.status(404).json({ error: 'Client not found' });
    res.json(client);
  } catch (err) { next(err); }
});

// POST /api/clients
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = ClientSchema.parse(req.body);
    if (!body.contactEmail) body.contactEmail = undefined;
    const client = await prisma.client.create({ data: body as any });
    res.status(201).json(client);
  } catch (err) { next(err); }
});

// PUT /api/clients/:id
router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = ClientSchema.partial().parse(req.body);
    if (body.contactEmail === '') body.contactEmail = undefined;
    const client = await prisma.client.update({
      where: { id: req.params.id },
      data: body as any,
    });
    res.json(client);
  } catch (err) { next(err); }
});

// DELETE /api/clients/:id
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.client.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Policies ──────────────────────────────────────────────────────────────────

// GET /api/clients/:id/policies
router.get('/:id/policies', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const policies = await prisma.clientPolicy.findMany({
      where: { clientId: req.params.id },
      orderBy: { createdAt: 'asc' },
    });
    res.json(policies);
  } catch (err) { next(err); }
});

// POST /api/clients/:id/policies
router.post('/:id/policies', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = PolicySchema.parse(req.body);
    // EMPLOYEE_SHIFT is a singleton policy per client
    if (body.type === 'EMPLOYEE_SHIFT') {
      const existing = await prisma.clientPolicy.findFirst({
        where: { clientId: req.params.id, type: 'EMPLOYEE_SHIFT' },
      });
      if (existing) {
        return res.status(409).json({ error: 'An Employee Shift policy already exists for this client. Edit the existing one.' });
      }
    }
    const policy = await prisma.clientPolicy.create({
      data: { ...body, clientId: req.params.id },
    });
    res.status(201).json(policy);
  } catch (err) { next(err); }
});

// PUT /api/clients/:clientId/policies/:policyId
router.put('/:clientId/policies/:policyId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = PolicySchema.partial().parse(req.body);
    const policy = await prisma.clientPolicy.update({
      where: { id: req.params.policyId },
      data: body,
    });
    res.json(policy);
  } catch (err) { next(err); }
});

// DELETE /api/clients/:clientId/policies/:policyId
router.delete('/:clientId/policies/:policyId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.clientPolicy.delete({ where: { id: req.params.policyId } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Branches ──────────────────────────────────────────────────────────────────

// GET /api/clients/:id/branches
router.get('/:id/branches', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const branches = await (prisma as any).clientBranch.findMany({
      where: { clientId: req.params.id },
      orderBy: { name: 'asc' },
    });
    res.json(branches);
  } catch (err) { next(err); }
});

// POST /api/clients/:id/branches
router.post('/:id/branches', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = BranchSchema.parse(req.body);
    const branch = await (prisma as any).clientBranch.create({
      data: { ...body, clientId: req.params.id },
    });
    res.status(201).json(branch);
  } catch (err) { next(err); }
});

// PUT /api/clients/:clientId/branches/:branchId
router.put('/:clientId/branches/:branchId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = BranchSchema.partial().parse(req.body);
    const branch = await (prisma as any).clientBranch.update({
      where: { id: req.params.branchId },
      data: body,
    });
    res.json(branch);
  } catch (err) { next(err); }
});

// DELETE /api/clients/:clientId/branches/:branchId
router.delete('/:clientId/branches/:branchId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Unassign all employees from this branch first
    await prisma.employee.updateMany({
      where: { branchId: req.params.branchId },
      data: { branchId: null },
    });
    await (prisma as any).clientBranch.delete({ where: { id: req.params.branchId } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// PATCH /api/clients/:clientId/employees/:employeeId/branch
router.patch('/:clientId/employees/:employeeId/branch', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { branchId } = z.object({ branchId: z.string().nullable() }).parse(req.body);
    const employee = await prisma.employee.update({
      where: { id: req.params.employeeId },
      data: { branchId },
    });
    res.json(employee);
  } catch (err) { next(err); }
});

// ── Client User Access Management ─────────────────────────────────────────────

// GET /api/clients/:id/access — check if client has a login user
router.get('/:id/access', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const client = await prisma.client.findUnique({
      where: { id: req.params.id },
      include: {
        clientUser: {
          select: { id: true, name: true, email: true, isActive: true, createdAt: true },
        },
      },
    });
    if (!client) return res.status(404).json({ error: 'Client not found' });
    res.json({ user: client.clientUser ?? null });
  } catch (err) { next(err); }
});

// POST /api/clients/:id/access — create or reset client login (uses contactEmail)
router.post('/:id/access', requireRole('SUPER_ADMIN', 'HR_MANAGER', 'HR_STAFF'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { password } = z.object({ password: z.string().min(8) }).parse(req.body);

    const client = await prisma.client.findUnique({
      where: { id: req.params.id },
      include: { clientUser: true },
    });
    if (!client) return res.status(404).json({ error: 'Client not found' });
    if (!client.contactEmail) {
      return res.status(422).json({ error: 'Client has no contact email. Add a contact email before granting access.' });
    }

    const hashed = await bcrypt.hash(password, 12);

    if (client.clientUser) {
      // Reset password on existing user and reactivate
      const updated = await prisma.user.update({
        where: { id: client.clientUser.id },
        data: { password: hashed, isActive: true },
        select: { id: true, name: true, email: true, isActive: true },
      });
      return res.json({ user: updated, created: false });
    }

    // Create new CLIENT user
    const existing = await prisma.user.findUnique({ where: { email: client.contactEmail } });
    if (existing) {
      return res.status(409).json({ error: `Email ${client.contactEmail} is already registered to another account.` });
    }

    const newUser = await prisma.user.create({
      data: {
        name: client.contactName ?? client.name,
        email: client.contactEmail,
        password: hashed,
        role: 'CLIENT' as any,
        clientId: client.id,
      },
      select: { id: true, name: true, email: true, isActive: true },
    });
    res.status(201).json({ user: newUser, created: true });
  } catch (err) { next(err); }
});

// DELETE /api/clients/:id/access — revoke (set isActive = false)
router.delete('/:id/access', requireRole('SUPER_ADMIN', 'HR_MANAGER'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const client = await prisma.client.findUnique({
      where: { id: req.params.id },
      include: { clientUser: true },
    });
    if (!client) return res.status(404).json({ error: 'Client not found' });
    if (!client.clientUser) return res.status(404).json({ error: 'No login account for this client' });

    await prisma.user.update({
      where: { id: client.clientUser.id },
      data: { isActive: false },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/clients/:id/access/restore — re-enable (set isActive = true)
router.post('/:id/access/restore', requireRole('SUPER_ADMIN', 'HR_MANAGER'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const client = await prisma.client.findUnique({
      where: { id: req.params.id },
      include: { clientUser: true },
    });
    if (!client) return res.status(404).json({ error: 'Client not found' });
    if (!client.clientUser) return res.status(404).json({ error: 'No login account for this client' });

    const updated = await prisma.user.update({
      where: { id: client.clientUser.id },
      data: { isActive: true },
      select: { id: true, name: true, email: true, isActive: true },
    });
    res.json({ user: updated });
  } catch (err) { next(err); }
});

export default router;
