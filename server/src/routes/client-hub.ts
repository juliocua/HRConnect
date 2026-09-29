import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';

const router = Router();
// authenticate + rbacGuard('clientHub') applied in index.ts

// ── Client info (for hub header) ──────────────────────────────────────────────
router.get('/me', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const clientId = req.user!.clientId;
    if (!clientId) return res.status(403).json({ error: 'No client context' });

    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: {
        id: true,
        name: true,
        contactName: true,
        contactEmail: true,
        _count: { select: { employees: true } },
      },
    });
    if (!client) return res.status(404).json({ error: 'Client not found' });
    res.json(client);
  } catch (err) { next(err); }
});

// ── DTR (Attendance Edit Requests) ────────────────────────────────────────────

// GET /api/client-hub/dtr — pending DTR edit requests for this client's employees
router.get('/dtr', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const clientId = req.user!.clientId;
    if (!clientId) return res.status(403).json({ error: 'No client context' });

    const records = await (prisma as any).attendanceEditRequest.findMany({
      where: {
        status: 'PENDING',
        employee: { clientId },
      },
      include: {
        employee: {
          select: { id: true, firstName: true, lastName: true, employeeNo: true, position: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    res.json(records);
  } catch (err) { next(err); }
});

// GET /api/client-hub/dtr/history — approved/rejected for audit
router.get('/dtr/history', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const clientId = req.user!.clientId;
    if (!clientId) return res.status(403).json({ error: 'No client context' });

    const records = await (prisma as any).attendanceEditRequest.findMany({
      where: {
        status: { in: ['APPROVED', 'REJECTED'] },
        employee: { clientId },
      },
      include: {
        employee: {
          select: { id: true, firstName: true, lastName: true, employeeNo: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
    res.json(records);
  } catch (err) { next(err); }
});

// PUT /api/client-hub/dtr/:id/approve
router.put('/dtr/:id/approve', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const clientId = req.user!.clientId;
    if (!clientId) return res.status(403).json({ error: 'No client context' });

    const editRequest = await (prisma as any).attendanceEditRequest.findUnique({
      where: { id: req.params.id },
      include: { employee: { select: { clientId: true } } },
    });
    if (!editRequest) return res.status(404).json({ error: 'Request not found' });
    if (editRequest.employee.clientId !== clientId) return res.status(403).json({ error: 'Access denied' });
    if (editRequest.status !== 'PENDING') {
      return res.status(409).json({ error: `Request is already ${editRequest.status.toLowerCase()}` });
    }

    // Mark approved — client approval is final; HR cannot override
    const updated = await (prisma as any).attendanceEditRequest.update({
      where: { id: req.params.id },
      data: {
        status: 'APPROVED',
        reviewedById: req.user!.userId,
        reviewedAt: new Date(),
      },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

// PUT /api/client-hub/dtr/:id/reject
router.put('/dtr/:id/reject', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const clientId = req.user!.clientId;
    if (!clientId) return res.status(403).json({ error: 'No client context' });

    const { reason } = z.object({ reason: z.string().optional() }).parse(req.body);

    const editRequest = await (prisma as any).attendanceEditRequest.findUnique({
      where: { id: req.params.id },
      include: { employee: { select: { clientId: true } } },
    });
    if (!editRequest) return res.status(404).json({ error: 'Request not found' });
    if (editRequest.employee.clientId !== clientId) return res.status(403).json({ error: 'Access denied' });
    if (editRequest.status !== 'PENDING') {
      return res.status(409).json({ error: `Request is already ${editRequest.status.toLowerCase()}` });
    }

    const updated = await (prisma as any).attendanceEditRequest.update({
      where: { id: req.params.id },
      data: {
        status: 'REJECTED',
        reviewedById: req.user!.userId,
        reviewedAt: new Date(),
        rejectionNote: reason ?? null,
      },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

// ── Overtime Requests ─────────────────────────────────────────────────────────

// GET /api/client-hub/overtime — pending OT requests for this client's employees
router.get('/overtime', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const clientId = req.user!.clientId;
    if (!clientId) return res.status(403).json({ error: 'No client context' });

    const records = await (prisma as any).overtimeRequest.findMany({
      where: {
        status: 'PENDING',
        employee: { clientId },
      },
      include: {
        employee: {
          select: { id: true, firstName: true, lastName: true, employeeNo: true, position: true },
        },
      },
      orderBy: { filedAt: 'asc' },
    });
    res.json(records);
  } catch (err) { next(err); }
});

// GET /api/client-hub/overtime/history
router.get('/overtime/history', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const clientId = req.user!.clientId;
    if (!clientId) return res.status(403).json({ error: 'No client context' });

    const records = await (prisma as any).overtimeRequest.findMany({
      where: {
        status: { in: ['APPROVED', 'REJECTED'] },
        employee: { clientId },
      },
      include: {
        employee: {
          select: { id: true, firstName: true, lastName: true, employeeNo: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
    res.json(records);
  } catch (err) { next(err); }
});

// PUT /api/client-hub/overtime/:id/approve
router.put('/overtime/:id/approve', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const clientId = req.user!.clientId;
    if (!clientId) return res.status(403).json({ error: 'No client context' });

    const otRequest = await (prisma as any).overtimeRequest.findUnique({
      where: { id: req.params.id },
      include: { employee: { select: { clientId: true } } },
    });
    if (!otRequest) return res.status(404).json({ error: 'Request not found' });
    if (otRequest.employee.clientId !== clientId) return res.status(403).json({ error: 'Access denied' });
    if (otRequest.status !== 'PENDING') {
      return res.status(409).json({ error: `Request is already ${otRequest.status.toLowerCase()}` });
    }

    const updated = await (prisma as any).overtimeRequest.update({
      where: { id: req.params.id },
      data: {
        status: 'APPROVED',
        approvedById: req.user!.userId,
        approvedAt: new Date(),
      },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

// PUT /api/client-hub/overtime/:id/reject
router.put('/overtime/:id/reject', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const clientId = req.user!.clientId;
    if (!clientId) return res.status(403).json({ error: 'No client context' });

    const { reason } = z.object({ reason: z.string().optional() }).parse(req.body);

    const otRequest = await (prisma as any).overtimeRequest.findUnique({
      where: { id: req.params.id },
      include: { employee: { select: { clientId: true } } },
    });
    if (!otRequest) return res.status(404).json({ error: 'Request not found' });
    if (otRequest.employee.clientId !== clientId) return res.status(403).json({ error: 'Access denied' });
    if (otRequest.status !== 'PENDING') {
      return res.status(409).json({ error: `Request is already ${otRequest.status.toLowerCase()}` });
    }

    const updated = await (prisma as any).overtimeRequest.update({
      where: { id: req.params.id },
      data: {
        status: 'REJECTED',
        rejectedAt: new Date(),
        rejectionNote: reason ?? null,
      },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

export default router;
