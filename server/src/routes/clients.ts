import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/authenticate';

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
  billingCycle: z.enum(['WEEKLY', 'EVERY_15TH', 'EVERY_30TH', 'MONTHLY']).optional(),
  billingDate: z.number().int().min(1).max(31).optional().nullable(),
  payPeriodType: z.number().int().optional().nullable(),
  adminFeeRate: z.number().min(0).max(100).optional().nullable(),
  isVatable: z.boolean().optional(),
  hasEwt: z.boolean().optional(),
  billingTerms: z.string().optional().nullable(),
  activeContract: z.boolean().optional(),
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
        employees: {
          select: {
            id: true, firstName: true, lastName: true,
            position: true, avatarColor: true, status: true,
            resourceCost: true, payrollCost: true,
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

export default router;
