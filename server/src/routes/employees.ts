import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/authenticate';

// ── Photo upload config ───────────────────────────────────────────────────────
const uploadsDir = path.join(process.cwd(), 'uploads', 'photos');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const photoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (req, _file, cb) => {
    const ext = '.jpg';
    cb(null, `employee-${req.params.id}-${Date.now()}${ext}`);
  },
});

const photoUpload = multer({
  storage: photoStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

const router = Router();
router.use(authenticate);

const EmployeeSchema = z.object({
  employeeNo: z.string().optional(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  position: z.string().min(1),
  departmentId: z.string(),
  managerId: z.string().optional().nullable(),
  status: z.enum(['ACTIVE', 'ON_LEAVE', 'INACTIVE', 'TERMINATED']).optional(),
  hireDate: z.string().transform(d => new Date(d)),
  basicSalary: z.number().positive(),
  sssNo: z.string().optional(),
  philhealthNo: z.string().optional(),
  pagibigNo: z.string().optional(),
  tinNo: z.string().optional(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional().nullable(),
  avatarColor: z.string().optional(),
  resourceCost: z.number().nonnegative().optional().nullable(),
  payrollCost: z.number().nonnegative().optional().nullable(),
  clientId: z.string().optional().nullable(),
});

// GET /api/employees
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { dept, departmentId, status, search } = req.query as Record<string, string>;
    const employees = await prisma.employee.findMany({
      where: {
        ...(departmentId ? { departmentId } : dept ? { department: { name: dept } } : {}),
        ...(status ? { status: status as any } : {}),
        ...(search
          ? {
              OR: [
                { firstName: { contains: search, mode: 'insensitive' } },
                { lastName: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
                { position: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: {
        department: true,
        manager: { select: { firstName: true, lastName: true } },
        user: { select: { id: true, email: true, isActive: true } },
        client: { select: { id: true, name: true } },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    res.json(employees);
  } catch (err) {
    next(err);
  }
});

// GET /api/employees/me  — employee views their own record
router.get('/me', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { employeeId } = req.user!;
    if (!employeeId) return res.status(403).json({ error: 'No linked employee record' });
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      include: { department: true },
    });
    if (!employee) return res.status(404).json({ error: 'Employee not found' });
    res.json(employee);
  } catch (err) { next(err); }
});

// PATCH /api/employees/me  — employee updates their own avatar & govt IDs
router.patch('/me', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { employeeId } = req.user!;
    if (!employeeId) return res.status(403).json({ error: 'No linked employee record' });
    const body = z.object({
      avatarColor: z.string().optional(),
      sssNo: z.string().optional(),
      philhealthNo: z.string().optional(),
      pagibigNo: z.string().optional(),
      tinNo: z.string().optional(),
    }).parse(req.body);
    const employee = await prisma.employee.update({
      where: { id: employeeId },
      data: body,
      include: { department: true },
    });
    res.json(employee);
  } catch (err) { next(err); }
});

// GET /api/employees/:id
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const employee = await prisma.employee.findUnique({
      where: { id: req.params.id },
      include: {
        department: true,
        manager: { select: { id: true, firstName: true, lastName: true, position: true } },
        subordinates: { select: { id: true, firstName: true, lastName: true, position: true } },
        user: { select: { id: true, email: true, role: true, isActive: true } },
      },
    });
    if (!employee) return res.status(404).json({ error: 'Employee not found' });
    res.json(employee);
  } catch (err) {
    next(err);
  }
});

// POST /api/employees
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = EmployeeSchema.parse(req.body);

    // Fix: coerce empty string managerId to null (FK constraint)
    if (!body.managerId) body.managerId = null;

    // Auto-generate employee number if not provided
    if (!body.employeeNo) {
      const count = await prisma.employee.count();
      body.employeeNo = `EMP-${String(count + 1).padStart(10, '0')}`;
    }

    // Auto-create user account for the employee
    const tempPassword = `Welcome@${body.employeeNo}`;
    const hashed = await bcrypt.hash(tempPassword, 12);

    const employee = await prisma.$transaction(async (tx) => {
      // Create the employee record
      const emp = await tx.employee.create({
        data: body as any,
        include: { department: true },
      });

      // Check if a user with this email already exists
      const existingUser = await tx.user.findUnique({ where: { email: body.email } });
      if (!existingUser) {
        await tx.user.create({
          data: {
            name: `${body.firstName} ${body.lastName}`,
            email: body.email,
            password: hashed,
            role: 'EMPLOYEE',
            employeeId: emp.id,
          },
        });
      } else if (!existingUser.employeeId) {
        // Link existing user to this employee record
        await tx.user.update({
          where: { id: existingUser.id },
          data: { employeeId: emp.id },
        });
      }

      return emp;
    });

    // Include temp password in response so HR can share it (only on creation)
    res.status(201).json({ ...employee, _tempPassword: tempPassword });
  } catch (err) {
    next(err);
  }
});

// PUT /api/employees/:id
router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = EmployeeSchema.partial().parse(req.body);
    // Fix: coerce empty string managerId to null
    if ('managerId' in body && !body.managerId) body.managerId = null;

    const employee = await prisma.employee.update({
      where: { id: req.params.id },
      data: body as any,
      include: { department: true },
    });
    res.json(employee);
  } catch (err) {
    next(err);
  }
});

// POST /api/employees/:id/create-account  — create login for existing employee
router.post('/:id/create-account', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const employee = await prisma.employee.findUnique({
      where: { id: req.params.id },
      include: { user: true },
    });
    if (!employee) return res.status(404).json({ error: 'Employee not found' });
    if (employee.user) return res.status(422).json({ error: 'Employee already has a login account' });

    const empNo = employee.employeeNo ?? employee.id.slice(-4).toUpperCase();
    const tempPassword = `Welcome@${empNo}`;
    const hashed = await bcrypt.hash(tempPassword, 12);

    const existingUser = await prisma.user.findUnique({ where: { email: employee.email } });
    if (existingUser) {
      await prisma.user.update({ where: { id: existingUser.id }, data: { employeeId: employee.id } });
    } else {
      await prisma.user.create({
        data: {
          name: `${employee.firstName} ${employee.lastName}`,
          email: employee.email,
          password: hashed,
          role: 'EMPLOYEE',
          employeeId: employee.id,
        },
      });
    }
    res.json({ email: employee.email, tempPassword });
  } catch (err) {
    next(err);
  }
});

// POST /api/employees/:id/reset-password  — reset login password
router.post('/:id/reset-password', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const employee = await prisma.employee.findUnique({
      where: { id: req.params.id },
      include: { user: true },
    });
    if (!employee) return res.status(404).json({ error: 'Employee not found' });
    if (!employee.user) return res.status(422).json({ error: 'Employee has no login account' });

    const empNo = employee.employeeNo ?? employee.id.slice(-4).toUpperCase();
    const tempPassword = `Welcome@${empNo}`;
    const hashed = await bcrypt.hash(tempPassword, 12);

    await prisma.user.update({ where: { id: employee.user.id }, data: { password: hashed } });
    res.json({ email: employee.email, tempPassword });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/employees/:id  (soft delete — set status to TERMINATED)
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.employee.update({
      where: { id: req.params.id },
      data: { status: 'TERMINATED' },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/employees/:id/photo — upload employee photo
router.post('/:id/photo', photoUpload.single('photo'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const employee = await prisma.employee.findUnique({ where: { id: req.params.id } });
    if (!employee) {
      fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Employee not found' });
    }

    // Delete old photo if exists
    if (employee.photoUrl) {
      const oldFilename = employee.photoUrl.split('/uploads/photos/').pop();
      if (oldFilename) {
        const oldPath = path.join(uploadsDir, oldFilename);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
    }

    const baseUrl = process.env.SERVER_URL || `http://localhost:${process.env.PORT || 3001}`;
    const photoUrl = `${baseUrl}/uploads/photos/${req.file.filename}`;

    const updated = await prisma.employee.update({
      where: { id: req.params.id },
      data: { photoUrl },
      include: { department: true },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

// DELETE /api/employees/:id/photo — remove employee photo
router.delete('/:id/photo', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const employee = await prisma.employee.findUnique({ where: { id: req.params.id } });
    if (!employee) return res.status(404).json({ error: 'Employee not found' });

    if (employee.photoUrl) {
      const oldFilename = employee.photoUrl.split('/uploads/photos/').pop();
      if (oldFilename) {
        const oldPath = path.join(uploadsDir, oldFilename);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
    }

    const updated = await prisma.employee.update({
      where: { id: req.params.id },
      data: { photoUrl: null },
      include: { department: true },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

// GET /api/employees/departments/list
router.get('/departments/list', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const depts = await prisma.department.findMany({ orderBy: { name: 'asc' } });
    res.json(depts);
  } catch (err) {
    next(err);
  }
});

// POST /api/employees/departments
router.post('/departments', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name } = z.object({ name: z.string().min(1) }).parse(req.body);
    const dept = await prisma.department.create({ data: { name } });
    res.status(201).json(dept);
  } catch (err) {
    next(err);
  }
});

export default router;