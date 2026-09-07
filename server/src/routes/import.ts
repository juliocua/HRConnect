import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import { prisma } from '../lib/prisma';
import { authenticate, requireRole } from '../middleware/authenticate';

const router = Router();
router.use(authenticate);
router.use(requireRole('HR_MANAGER', 'SUPER_ADMIN'));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// ── CSV Templates ─────────────────────────────────────────────────────────────

const TEMPLATES: Record<string, string> = {
  client: [
    'name,contactName,contactEmail,contactPhone,address,billingCycle,billingDate,activeContract',
    'Acme Corp,John Doe,john@acme.com,+63 912 345 6789,123 Main St Manila,MONTHLY,1,TRUE',
    'Beta Inc,Jane Smith,jane@beta.com,+63 917 123 4567,456 Rizal Ave Cebu,WEEKLY,,TRUE',
  ].join('\r\n'),

  employee: [
    'employeeNo,firstName,lastName,email,phone,position,department,clientName,hireDate,basicSalary,status,resourceCost,payrollCost',
    'EMP-001,Juan,dela Cruz,juan@company.com,+63 912 000 0001,Developer,IT,Acme Corp,2024-01-15,35000,ACTIVE,50000,38000',
    'EMP-002,Maria,Santos,maria@company.com,+63 917 000 0002,HR Specialist,Human Resources,Beta Inc,2024-03-01,30000,ACTIVE,,',
  ].join('\r\n'),

  time: [
    'employeeNo,date,status,overtimeHrs,notes',
    'EMP-001,2026-09-01,PRESENT,0,',
    'EMP-001,2026-09-02,PRESENT,2,Project deadline',
    'EMP-002,2026-09-01,ABSENT,,Sick leave',
  ].join('\r\n'),
};

// GET /api/import/template/:type — download CSV template
router.get('/template/:type', (req: Request, res: Response) => {
  const type = req.params.type;
  if (!TEMPLATES[type]) return res.status(404).json({ error: 'Unknown template type' });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="hrconnect-${type}-template.csv"`);
  res.send(TEMPLATES[type]);
});

// ── Import: Client ────────────────────────────────────────────────────────────
// Rule: name blank → error. name filled → upsert by name (update if exists, create if not).

router.post('/client', upload.single('file'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const rows: any[] = parse(req.file.buffer, { columns: true, skip_empty_lines: true, trim: true });
    const results: { row: number; status: 'ok' | 'error'; action?: 'created' | 'updated'; name: string; error?: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowNum = i + 2;
      const name = r.name?.trim() ?? '';

      try {
        if (!name) throw new Error('"name" is required');

        const cycle = r.billingCycle?.trim().toUpperCase();
        const VALID_CYCLES = ['WEEKLY', 'EVERY_15TH', 'EVERY_30TH', 'MONTHLY'];
        if (!VALID_CYCLES.includes(cycle)) throw new Error(`billingCycle must be one of: ${VALID_CYCLES.join(', ')}`);

        const data = {
          name,
          contactName: r.contactName?.trim() || null,
          contactEmail: r.contactEmail?.trim() || null,
          contactPhone: r.contactPhone?.trim() || null,
          address: r.address?.trim() || null,
          billingCycle: cycle as any,
          billingDate: r.billingDate?.trim() ? parseInt(r.billingDate) : null,
          activeContract: r.activeContract?.trim().toUpperCase() === 'TRUE',
        };

        // Upsert by name
        const existing = await prisma.client.findFirst({ where: { name } });
        if (existing) {
          await prisma.client.update({ where: { id: existing.id }, data });
          results.push({ row: rowNum, status: 'ok', name, action: 'updated' });
        } else {
          await prisma.client.create({ data });
          results.push({ row: rowNum, status: 'ok', name, action: 'created' });
        }
      } catch (err: any) {
        results.push({ row: rowNum, status: 'error', name: name || `Row ${rowNum}`, error: err.message });
      }
    }

    res.json(summary(rows.length, results));
  } catch (err) { next(err); }
});

// ── Import: Employee ──────────────────────────────────────────────────────────
// Rule: employeeNo blank → always CREATE new employee.
//       employeeNo filled → upsert by employeeNo (update if exists, create if not).

router.post('/employee', upload.single('file'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const rows: any[] = parse(req.file.buffer, { columns: true, skip_empty_lines: true, trim: true });
    const results: { row: number; status: 'ok' | 'error'; action?: 'created' | 'updated'; name: string; error?: string }[] = [];

    const departments = await prisma.department.findMany({ select: { id: true, name: true } });
    const deptMap = new Map(departments.map(d => [d.name.toLowerCase(), d.id]));

    const clients = await prisma.client.findMany({ select: { id: true, name: true } });
    const clientMap = new Map(clients.map(c => [c.name.toLowerCase(), c.id]));

    // For auto-generating employeeNo when blank, start after the current max
    const empCount = await prisma.employee.count();
    let autoSeq = empCount + 1;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowNum = i + 2;
      const name = `${r.firstName?.trim() ?? ''} ${r.lastName?.trim() ?? ''}`.trim() || `Row ${rowNum}`;

      try {
        if (!r.firstName?.trim()) throw new Error('"firstName" is required');
        if (!r.lastName?.trim()) throw new Error('"lastName" is required');

        const status = r.status?.trim().toUpperCase() || 'ACTIVE';
        if (!['ACTIVE', 'ON_LEAVE', 'TERMINATED'].includes(status)) {
          throw new Error('status must be ACTIVE, ON_LEAVE, or TERMINATED');
        }

        // Department — required
        if (!r.department?.trim()) throw new Error('"department" is required');
        const departmentId = deptMap.get(r.department.trim().toLowerCase());
        if (!departmentId) throw new Error(`Department "${r.department.trim()}" not found — must match an existing department name exactly`);

        // Client deployment — required
        if (!r.clientName?.trim()) throw new Error('"clientName" is required');
        const clientId = clientMap.get(r.clientName.trim().toLowerCase());
        if (!clientId) throw new Error(`Client "${r.clientName.trim()}" not found — must match an existing client name exactly`);

        const data: any = {
          firstName: r.firstName.trim(),
          lastName: r.lastName.trim(),
          email: r.email?.trim() || null,
          phone: r.phone?.trim() || null,
          position: r.position?.trim() || null,
          departmentId,
          clientId,
          hireDate: r.hireDate?.trim() ? new Date(r.hireDate.trim()) : new Date(),
          basicSalary: r.basicSalary?.trim() ? parseFloat(r.basicSalary) : 0,
          status: status as any,
          resourceCost: r.resourceCost?.trim() ? parseFloat(r.resourceCost) : null,
          payrollCost: r.payrollCost?.trim() ? parseFloat(r.payrollCost) : null,
        };

        const employeeNo = r.employeeNo?.trim();

        if (employeeNo) {
          // employeeNo provided → upsert by employeeNo
          const existing = await prisma.employee.findFirst({ where: { employeeNo } });
          if (existing) {
            await prisma.employee.update({ where: { id: existing.id }, data });
            results.push({ row: rowNum, status: 'ok', name, action: 'updated' });
          } else {
            await prisma.employee.create({ data: { ...data, employeeNo } });
            results.push({ row: rowNum, status: 'ok', name, action: 'created' });
          }
        } else {
          // No employeeNo → always create new with auto-generated number
          const generatedNo = `EMP-${String(autoSeq++).padStart(3, '0')}`;
          await prisma.employee.create({ data: { ...data, employeeNo: generatedNo } });
          results.push({ row: rowNum, status: 'ok', name, action: 'created' });
        }
      } catch (err: any) {
        results.push({ row: rowNum, status: 'error', name, error: err.message });
      }
    }

    res.json(summary(rows.length, results));
  } catch (err) { next(err); }
});

// ── Import: Time / Attendance ─────────────────────────────────────────────────
// Rule: employeeNo + date together are the unique key → always upsert (update if same
//       employee+date exists, create if not). Both fields are required.

router.post('/time', upload.single('file'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const rows: any[] = parse(req.file.buffer, { columns: true, skip_empty_lines: true, trim: true });
    const results: { row: number; status: 'ok' | 'error'; action?: 'created' | 'updated'; name: string; error?: string }[] = [];

    const VALID_STATUS = ['PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'ON_LEAVE'];

    // Cache employee lookups to avoid N+1 per row
    const empCache = new Map<string, string>();
    const getEmpId = async (employeeNo: string) => {
      if (empCache.has(employeeNo)) return empCache.get(employeeNo)!;
      const emp = await prisma.employee.findFirst({ where: { employeeNo }, select: { id: true } });
      if (!emp) throw new Error(`Employee "${employeeNo}" not found`);
      empCache.set(employeeNo, emp.id);
      return emp.id;
    };

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowNum = i + 2;
      const label = `${r.employeeNo ?? ''} / ${r.date ?? ''}`.trim() || `Row ${rowNum}`;

      try {
        if (!r.employeeNo?.trim()) throw new Error('"employeeNo" is required');
        if (!r.date?.trim()) throw new Error('"date" is required');

        const status = r.status?.trim().toUpperCase() || 'PRESENT';
        if (!VALID_STATUS.includes(status)) throw new Error(`status must be one of: ${VALID_STATUS.join(', ')}`);

        const employeeId = await getEmpId(r.employeeNo.trim());
        const date = new Date(r.date.trim());
        if (isNaN(date.getTime())) throw new Error(`Invalid date: ${r.date}`);

        const existing = await prisma.attendance.findUnique({
          where: { employeeId_date: { employeeId, date } },
        });

        if (existing) {
          await prisma.attendance.update({
            where: { employeeId_date: { employeeId, date } },
            data: {
              status: status as any,
              overtimeHrs: r.overtimeHrs?.trim() ? parseFloat(r.overtimeHrs) : 0,
              notes: r.notes?.trim() || null,
            },
          });
          results.push({ row: rowNum, status: 'ok', name: label, action: 'updated' });
        } else {
          await prisma.attendance.create({
            data: {
              employeeId, date,
              status: status as any,
              overtimeHrs: r.overtimeHrs?.trim() ? parseFloat(r.overtimeHrs) : 0,
              notes: r.notes?.trim() || null,
            },
          });
          results.push({ row: rowNum, status: 'ok', name: label, action: 'created' });
        }
      } catch (err: any) {
        results.push({ row: rowNum, status: 'error', name: label, error: err.message });
      }
    }

    res.json(summary(rows.length, results));
  } catch (err) { next(err); }
});

function summary(total: number, results: { row: number; status: string; action?: string; name: string; error?: string }[]) {
  return {
    total,
    imported: results.filter(r => r.status === 'ok').length,
    created: results.filter(r => r.action === 'created').length,
    updated: results.filter(r => r.action === 'updated').length,
    failed: results.filter(r => r.status === 'error').length,
    results,
  };
}

export default router;