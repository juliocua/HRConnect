import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const router = Router();
const prisma = new PrismaClient();

// Roles that can manage/approve expenses (all non-employee HR roles)
const HR_ROLES = [
  'SUPER_ADMIN', 'HR_MANAGER', 'HR_STAFF',
  'EMPLOYEE_RELATIONS', 'ACCOUNTS_MANAGEMENT',
  'BILLING_COLLECTION', 'ACCOUNTING',
];

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

// ── GET /api/expenses/pending — count for badge (must be before /:id routes) ──
router.get('/pending', async (req: any, res) => {
  if (!HR_ROLES.includes(req.user?.role)) return res.status(403).json({ error: 'Forbidden' });
  try {
    const count = await (prisma as any).expenseRequest.count({ where: { status: 'PENDING' } });
    res.json({ count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch pending count' });
  }
});

// ── GET /api/expenses/categories — all active categories ─────────────────────
router.get('/categories', async (_req, res) => {
  try {
    const categories = await (prisma as any).expenseCategory.findMany({
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
router.get('/categories/all', async (req: any, res) => {
  if (!HR_ROLES.includes(req.user?.role)) return res.status(403).json({ error: 'Forbidden' });
  try {
    const categories = await (prisma as any).expenseCategory.findMany({ orderBy: { name: 'asc' } });
    res.json(categories);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// ── POST /api/expenses/categories ─────────────────────────────────────────────
router.post('/categories', async (req: any, res) => {
  if (!HR_ROLES.includes(req.user?.role)) return res.status(403).json({ error: 'Forbidden' });
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Category name is required' });
  try {
    const category = await (prisma as any).expenseCategory.create({ data: { name: name.trim() } });
    res.status(201).json(category);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create category' });
  }
});

// ── PATCH /api/expenses/categories/:id ───────────────────────────────────────
router.patch('/categories/:id', async (req: any, res) => {
  if (!HR_ROLES.includes(req.user?.role)) return res.status(403).json({ error: 'Forbidden' });
  const { name, isActive } = req.body;
  try {
    const category = await (prisma as any).expenseCategory.update({
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
router.delete('/categories/:id', async (req: any, res) => {
  if (!HR_ROLES.includes(req.user?.role)) return res.status(403).json({ error: 'Forbidden' });
  try {
    await (prisma as any).expenseCategory.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete category' });
  }
});

// ── GET /api/expenses — list expenses ─────────────────────────────────────────
// HR roles: all expenses. EMPLOYEE: own expenses only.
router.get('/', async (req: any, res) => {
  try {
    const isHR = HR_ROLES.includes(req.user?.role);
    const where = isHR ? {} : { employeeId: req.user?.employeeId };
    const expenses = await (prisma as any).expenseRequest.findMany({
      where,
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, client: { select: { id: true, name: true } } } },
        category: true,
        approvedBy: { select: { id: true, firstName: true, lastName: true } },
        payrollRecord: { select: { id: true, payrollRun: { select: { period: true, periodStart: true, periodEnd: true } } } },
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
router.post('/', upload.single('receipt'), async (req: any, res) => {
  const { categoryId, description, amount } = req.body;
  if (!description?.trim()) return res.status(400).json({ error: 'Description is required' });
  if (!amount || isNaN(Number(amount))) return res.status(400).json({ error: 'Valid amount is required' });
  if (!req.file) return res.status(400).json({ error: 'Receipt file is required' });

  try {
    const receiptUrl = `/uploads/receipts/${req.file.filename}`;
    const expense = await (prisma as any).expenseRequest.create({
      data: {
        employeeId: req.user?.employeeId,
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
router.patch('/:id/approve', async (req: any, res) => {
  if (!HR_ROLES.includes(req.user?.role)) return res.status(403).json({ error: 'Forbidden' });
  try {
    const expense = await (prisma as any).expenseRequest.update({
      where: { id: req.params.id },
      data: {
        status: 'APPROVED',
        approvedById: req.user?.employeeId,
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
router.patch('/:id/reject', async (req: any, res) => {
  if (!HR_ROLES.includes(req.user?.role)) return res.status(403).json({ error: 'Forbidden' });
  const { rejectionNote } = req.body;
  try {
    const expense = await (prisma as any).expenseRequest.update({
      where: { id: req.params.id },
      data: {
        status: 'REJECTED',
        approvedById: req.user?.employeeId,
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

export default router;
