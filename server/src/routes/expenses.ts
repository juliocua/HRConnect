import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { requireAuth, requireRole } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

// ── Receipt upload storage ────────────────────────────────────────────────────
const RECEIPTS_DIR = process.env.UPLOADS_DIR
  ? path.join(process.env.UPLOADS_DIR, 'receipts')
  : path.join(__dirname, '../../uploads/receipts');

if (!fs.existsSync(RECEIPTS_DIR)) fs.mkdirSync(RECEIPTS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, RECEIPTS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `receipt-${Date.now()}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// ── GET /api/expenses/categories — all active categories ─────────────────────
router.get('/categories', requireAuth, async (_req, res) => {
  try {
    const categories = await prisma.expenseCategory.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
    res.json(categories);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// ── GET /api/expenses/categories/all — admin: all including inactive ──────────
router.get('/categories/all', requireAuth, requireRole(['ADMIN', 'MANAGER']), async (_req, res) => {
  try {
    const categories = await prisma.expenseCategory.findMany({ orderBy: { name: 'asc' } });
    res.json(categories);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// ── POST /api/expenses/categories ─────────────────────────────────────────────
router.post('/categories', requireAuth, requireRole(['ADMIN', 'MANAGER']), async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Category name is required' });
  try {
    const category = await prisma.expenseCategory.create({ data: { name: name.trim() } });
    res.status(201).json(category);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create category' });
  }
});

// ── PATCH /api/expenses/categories/:id ───────────────────────────────────────
router.patch('/categories/:id', requireAuth, requireRole(['ADMIN', 'MANAGER']), async (req, res) => {
  const { name, isActive } = req.body;
  try {
    const category = await prisma.expenseCategory.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(isActive !== undefined && { isActive }),
      },
    });
    res.json(category);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update category' });
  }
});

// ── DELETE /api/expenses/categories/:id ──────────────────────────────────────
router.delete('/categories/:id', requireAuth, requireRole(['ADMIN']), async (req, res) => {
  try {
    await prisma.expenseCategory.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete category' });
  }
});

// ── GET /api/expenses — list expenses ─────────────────────────────────────────
// HR/Admin/Manager: all expenses. Employee: own expenses only.
router.get('/', requireAuth, async (req: any, res) => {
  try {
    const isHR = ['ADMIN', 'MANAGER', 'EMPLOYEE_RELATIONS', 'ACCOUNTS_MANAGEMENT'].includes(req.user.role);
    const where = isHR ? {} : { employeeId: req.user.employeeId };
    const expenses = await prisma.expenseRequest.findMany({
      where,
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, client: { select: { id: true, name: true } } } },
        category: true,
        approvedBy: { select: { id: true, firstName: true, lastName: true } },
        payrollRecord: { select: { id: true, payrollRun: { select: { periodStart: true, periodEnd: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(expenses);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch expenses' });
  }
});

// ── POST /api/expenses — employee submits expense ─────────────────────────────
router.post('/', requireAuth, upload.single('receipt'), async (req: any, res) => {
  const { categoryId, description, amount } = req.body;
  if (!description?.trim()) return res.status(400).json({ error: 'Description is required' });
  if (!amount || isNaN(Number(amount))) return res.status(400).json({ error: 'Valid amount is required' });
  if (!req.file) return res.status(400).json({ error: 'Receipt file is required' });

  try {
    const receiptUrl = `/uploads/receipts/${req.file.filename}`;
    const expense = await prisma.expenseRequest.create({
      data: {
        employeeId: req.user.employeeId,
        categoryId: categoryId || null,
        description: description.trim(),
        amount: Number(amount),
        receiptUrl,
      },
      include: {
        category: true,
        employee: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    res.status(201).json(expense);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to submit expense' });
  }
});

// ── PATCH /api/expenses/:id/approve ──────────────────────────────────────────
router.patch('/:id/approve', requireAuth, requireRole(['ADMIN', 'MANAGER', 'EMPLOYEE_RELATIONS']), async (req: any, res) => {
  try {
    const expense = await prisma.expenseRequest.update({
      where: { id: req.params.id },
      data: {
        status: 'APPROVED',
        approvedById: req.user.employeeId,
        approvedAt: new Date(),
        rejectionNote: null,
      },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true } },
        category: true,
        approvedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    res.json(expense);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to approve expense' });
  }
});

// ── PATCH /api/expenses/:id/reject ───────────────────────────────────────────
router.patch('/:id/reject', requireAuth, requireRole(['ADMIN', 'MANAGER', 'EMPLOYEE_RELATIONS']), async (req: any, res) => {
  const { rejectionNote } = req.body;
  try {
    const expense = await prisma.expenseRequest.update({
      where: { id: req.params.id },
      data: {
        status: 'REJECTED',
        approvedById: req.user.employeeId,
        approvedAt: new Date(),
        rejectionNote: rejectionNote?.trim() || null,
      },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true } },
        category: true,
      },
    });
    res.json(expense);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to reject expense' });
  }
});

// ── GET /api/expenses/pending — count for badge ───────────────────────────────
router.get('/pending', requireAuth, requireRole(['ADMIN', 'MANAGER', 'EMPLOYEE_RELATIONS']), async (_req, res) => {
  try {
    const count = await prisma.expenseRequest.count({ where: { status: 'PENDING' } });
    res.json({ count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch pending count' });
  }
});

export default router;
