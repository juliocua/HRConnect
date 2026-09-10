import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticate, requireRole } from '../middleware/authenticate';

const router = Router();
router.use(authenticate);
router.use(requireRole('SUPER_ADMIN'));

const CompanySchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1).max(20).toUpperCase(),
  address: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
});

// GET /api/companies
router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const companies = await (prisma as any).company.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { users: true } } },
    });
    res.json(companies);
  } catch (err) { next(err); }
});

// GET /api/companies/:id
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const company = await (prisma as any).company.findUnique({
      where: { id: req.params.id },
      include: {
        users: {
          select: { id: true, name: true, email: true, role: true, isActive: true },
          orderBy: { name: 'asc' },
        },
      },
    });
    if (!company) return res.status(404).json({ error: 'Company not found' });
    res.json(company);
  } catch (err) { next(err); }
});

// POST /api/companies
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = CompanySchema.parse(req.body);
    const existing = await (prisma as any).company.findUnique({ where: { code: body.code } });
    if (existing) return res.status(422).json({ error: `Company code "${body.code}" is already in use` });

    const company = await (prisma as any).company.create({ data: body });
    res.status(201).json(company);
  } catch (err) { next(err); }
});

// PUT /api/companies/:id
router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = CompanySchema.partial().parse(req.body);
    if (body.code) {
      const existing = await (prisma as any).company.findFirst({
        where: { code: body.code, NOT: { id: req.params.id } },
      });
      if (existing) return res.status(422).json({ error: `Company code "${body.code}" is already in use` });
    }
    const company = await (prisma as any).company.update({
      where: { id: req.params.id },
      data: body,
    });
    res.json(company);
  } catch (err) { next(err); }
});

// DELETE /api/companies/:id  (soft delete — set isActive false)
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const company = await (prisma as any).company.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });
    res.json(company);
  } catch (err) { next(err); }
});

// POST /api/companies/:id/assign-user  — assign a user to this company
router.post('/:id/assign-user', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId } = z.object({ userId: z.string() }).parse(req.body);
    const user = await prisma.user.update({
      where: { id: userId },
      data: { companyId: req.params.id },
      select: { id: true, name: true, email: true, role: true, companyId: true },
    });
    res.json(user);
  } catch (err) { next(err); }
});

// DELETE /api/companies/:id/assign-user/:userId  — unassign user from company
router.delete('/:id/assign-user/:userId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.update({
      where: { id: req.params.userId },
      data: { companyId: null },
      select: { id: true, name: true, email: true, role: true, companyId: true },
    });
    res.json(user);
  } catch (err) { next(err); }
});

export default router;
