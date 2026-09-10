/**
 * HRConnect — Demo Seed
 * Run: npm run db:seed  (from server/)
 *
 * Clears and rebuilds everything so it's safe to re-run.
 * Generates ~3 months of attendance, 3 payroll runs, billing history,
 * 4 clients, 15 employees across 6 departments.
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// ── TRAIN Law withholding (monthly) ──────────────────────────────────────────
function computeWithholding(taxable: number): number {
  if (taxable <= 20_833) return 0;
  if (taxable <= 33_333) return (taxable - 20_833) * 0.15;
  if (taxable <= 66_667) return 1_875 + (taxable - 33_333) * 0.20;
  if (taxable <= 166_667) return 8_542 + (taxable - 66_667) * 0.25;
  if (taxable <= 666_667) return 33_542 + (taxable - 166_667) * 0.30;
  return 183_542 + (taxable - 666_667) * 0.35;
}

// ── Seeded random (reproducible) ─────────────────────────────────────────────
let seed = 42;
function rand(): number {
  seed = (seed * 1664525 + 1013904223) & 0xffffffff;
  return (seed >>> 0) / 0xffffffff;
}
function randInt(min: number, max: number) { return Math.floor(rand() * (max - min + 1)) + min; }
function pick<T>(arr: T[]): T { return arr[randInt(0, arr.length - 1)]; }

async function main() {
  console.log('🌱  Seeding HRConnect demo data…\n');

  // ── Clear existing data (order matters — FK constraints) ──────────────────
  console.log('Clearing existing data…');
  await prisma.billing.deleteMany();
  await prisma.payrollRecord.deleteMany();
  await prisma.payrollRun.deleteMany();
  await prisma.attendance.deleteMany();
  await prisma.leaveBalance.deleteMany();
  await prisma.leaveRequest.deleteMany();
  await prisma.clientPolicy.deleteMany();
  await prisma.user.deleteMany();
  await (prisma as any).overtimeRequest?.deleteMany().catch(() => null); // guard: table may not exist
  await prisma.employee.deleteMany();
  await prisma.client.deleteMany();
  await prisma.department.deleteMany();
  await prisma.leaveType.deleteMany();

  // ── 1. Leave Types ────────────────────────────────────────────────────────
  console.log('Creating leave types…');
  const [vlType, slType, elType, silType, mlType, plType] = await Promise.all([
    prisma.leaveType.create({ data: { code: 'VL',  name: 'Vacation Leave',          daysPerYear: 15,  isPaid: true,  legalBasis: 'Company Policy' } }),
    prisma.leaveType.create({ data: { code: 'SL',  name: 'Sick Leave',              daysPerYear: 15,  isPaid: true,  legalBasis: 'Labor Code Art. 95' } }),
    prisma.leaveType.create({ data: { code: 'EL',  name: 'Emergency Leave',         daysPerYear: 3,   isPaid: true,  legalBasis: 'Company Policy' } }),
    prisma.leaveType.create({ data: { code: 'SIL', name: 'Service Incentive Leave', daysPerYear: 5,   isPaid: true,  legalBasis: 'Labor Code Art. 95', isManual: true, resetsAnnually: false } }),
    prisma.leaveType.create({ data: { code: 'ML',  name: 'Maternity Leave',         daysPerYear: 105, isPaid: true,  legalBasis: 'RA 11210' } }),
    prisma.leaveType.create({ data: { code: 'PL',  name: 'Paternity Leave',         daysPerYear: 7,   isPaid: true,  legalBasis: 'RA 8187' } }),
  ]);
  const allLeaveTypes = [vlType, slType, elType, silType, mlType, plType];

  // ── 2. Departments ────────────────────────────────────────────────────────
  console.log('Creating departments…');
  const [engDept, opsDept, finDept, hrDept, salesDept, csDept] = await Promise.all([
    prisma.department.create({ data: { name: 'Engineering' } }),
    prisma.department.create({ data: { name: 'Operations' } }),
    prisma.department.create({ data: { name: 'Finance & Accounting' } }),
    prisma.department.create({ data: { name: 'Human Resources' } }),
    prisma.department.create({ data: { name: 'Sales & Marketing' } }),
    prisma.department.create({ data: { name: 'Customer Support' } }),
  ]);

  // ── 3. Clients ────────────────────────────────────────────────────────────
  console.log('Creating clients…');
  const [meridian, coastline, techbridge, pacific] = await Promise.all([
    prisma.client.create({
      data: {
        name: 'Meridian Global Solutions',
        address: '32F Philamlife Tower, Paseo de Roxas, Makati City',
        contactName: 'Robert Chen',
        contactEmail: 'rchen@meridianglobal.com',
        contactPhone: '+63 2 8888 1234',
        servicesOffered: 'IT Outsourcing, Software Development',
        specificRequest: 'Need senior engineers with React and Node.js expertise. Prefers Agile/Scrum methodology.',
        billingCycle: 'MONTHLY',
        billingDate: 1,
        activeContract: true,
      },
    }),
    prisma.client.create({
      data: {
        name: 'Coastline BPO Services',
        address: 'IT Park, Lahug, Cebu City',
        contactName: 'Maria Santos',
        contactEmail: 'msantos@coastlinebpo.ph',
        contactPhone: '+63 32 412 5678',
        servicesOffered: 'Business Process Outsourcing, Customer Service',
        specificRequest: 'Rotating shift coverage required. CSRs must have strong English communication skills.',
        billingCycle: 'EVERY_15TH',
        activeContract: true,
      },
    }),
    prisma.client.create({
      data: {
        name: 'TechBridge Asia',
        address: 'Bonifacio Global City, Taguig',
        contactName: 'James Villanueva',
        contactEmail: 'jvillanueva@techbridge.asia',
        contactPhone: '+63 2 7654 9876',
        servicesOffered: 'Digital Transformation, Cloud Services',
        specificRequest: 'Looking for DevOps and QA engineers. Remote-first setup with weekly on-site.',
        billingCycle: 'MONTHLY',
        billingDate: 15,
        activeContract: true,
      },
    }),
    prisma.client.create({
      data: {
        name: 'Pacific Workforce Partners',
        address: 'Araneta Center, Cubao, Quezon City',
        contactName: 'Grace Reyes',
        contactEmail: 'greyes@pacificwfp.com',
        contactPhone: '+63 2 9123 4567',
        servicesOffered: 'HR Consulting, Staffing Solutions',
        specificRequest: 'Need experienced accountants familiar with BIR compliance and Philippine payroll.',
        billingCycle: 'MONTHLY',
        billingDate: 1,
        activeContract: true,
      },
    }),
  ]);

  // Client policies
  await prisma.clientPolicy.createMany({
    data: [
      { clientId: meridian.id,   type: 'ATTENDANCE', title: 'Flexible Hours Policy',     description: 'Core hours 10AM–3PM. Total 8 hours required per day. Flex start between 7AM–10AM.' },
      { clientId: meridian.id,   type: 'LEAVE',      title: 'Leave Approval SLA',         description: 'All leave requests must be approved or denied within 24 hours. Emergency leaves require notification within 2 hours of absence.' },
      { clientId: coastline.id,  type: 'ATTENDANCE', title: 'Shift Schedule Policy',      description: 'Three rotating shifts: Morning (6AM–2PM), Afternoon (2PM–10PM), Night (10PM–6AM). Schedule released 2 weeks in advance.' },
      { clientId: coastline.id,  type: 'CONDUCT',    title: 'Customer Interaction Policy', description: 'All customer interactions must be recorded and logged in the CRM within 30 minutes. CSAT target: 4.5/5.0.' },
      { clientId: techbridge.id, type: 'ATTENDANCE', title: 'Remote Work Policy',         description: 'Employees may work remotely up to 3 days per week. Must be available on Slack during core hours 10AM–4PM.' },
      { clientId: pacific.id,    type: 'CONDUCT',    title: 'Confidentiality Policy',     description: 'All financial data and client information is strictly confidential. NDA required before onboarding. Annual re-signing required.' },
    ],
  });

  // ── 4. Employees ──────────────────────────────────────────────────────────
  console.log('Creating employees…');

  type EmpSeed = {
    no: string; fn: string; ln: string; pos: string;
    deptId: string; salary: number; rc: number | null;
    clientId: string | null; color: string;
    sss: string; ph: string; pag: string; tin: string;
    hireDate: string; status?: 'ACTIVE' | 'ON_LEAVE';
    gender: 'MALE' | 'FEMALE' | 'OTHER';
    bankName: string; bankAccountNo: string; bankAccountName: string;
  };

  const empSeed: EmpSeed[] = [
    // ── Engineering → Meridian (senior stack)
    { no: 'EMP-0000000001', fn: 'Miguel',    ln: 'Reyes',      pos: 'Senior Software Engineer', deptId: engDept.id,   salary: 75_000, rc: 95_000, clientId: meridian.id,   color: '#2563EB', hireDate: '2021-03-15', sss: '34-5678901-2', ph: '12-345678901-2', pag: '1234-5678-9012', tin: '123-456-789-000', gender: 'MALE',   bankName: 'BDO Unibank',    bankAccountNo: '1234567890',   bankAccountName: 'Miguel P. Reyes' },
    { no: 'EMP-0000000002', fn: 'Ana',       ln: 'Cruz',       pos: 'Frontend Developer',       deptId: engDept.id,   salary: 55_000, rc: 70_000, clientId: meridian.id,   color: '#7C3AED', hireDate: '2022-06-01', sss: '34-5678902-3', ph: '12-345678902-3', pag: '1234-5678-9013', tin: '123-456-789-001', gender: 'FEMALE', bankName: 'Bank of the Philippine Islands', bankAccountNo: '9876543210', bankAccountName: 'Ana L. Cruz' },
    { no: 'EMP-0000000003', fn: 'Carlo',     ln: 'Santos',     pos: 'Backend Developer',        deptId: engDept.id,   salary: 60_000, rc: 78_000, clientId: meridian.id,   color: '#059669', hireDate: '2022-09-12', sss: '34-5678903-4', ph: '12-345678903-4', pag: '1234-5678-9014', tin: '123-456-789-002', gender: 'MALE',   bankName: 'UnionBank',      bankAccountNo: '1122334455',   bankAccountName: 'Carlo R. Santos' },
    // ── Engineering → TechBridge (infra stack)
    { no: 'EMP-0000000004', fn: 'Sophia',    ln: 'Lim',        pos: 'QA Engineer',              deptId: engDept.id,   salary: 45_000, rc: 58_000, clientId: techbridge.id, color: '#DC2626', hireDate: '2023-01-09', sss: '34-5678904-5', ph: '12-345678904-5', pag: '1234-5678-9015', tin: '123-456-789-003', gender: 'FEMALE', bankName: 'Metrobank',      bankAccountNo: '5544332211',   bankAccountName: 'Sophia A. Lim' },
    { no: 'EMP-0000000005', fn: 'Marco',     ln: 'Dela Cruz',  pos: 'DevOps Engineer',          deptId: engDept.id,   salary: 65_000, rc: 85_000, clientId: techbridge.id, color: '#D97706', hireDate: '2022-04-20', sss: '34-5678905-6', ph: '12-345678905-6', pag: '1234-5678-9016', tin: '123-456-789-004', gender: 'MALE',   bankName: 'BDO Unibank',    bankAccountNo: '6677889900',   bankAccountName: 'Marco G. Dela Cruz' },
    // ── Operations → Coastline
    { no: 'EMP-0000000006', fn: 'Patricia',  ln: 'Garcia',     pos: 'Operations Manager',       deptId: opsDept.id,   salary: 55_000, rc: 70_000, clientId: coastline.id,  color: '#0891B2', hireDate: '2020-11-03', sss: '34-5678906-7', ph: '12-345678906-7', pag: '1234-5678-9017', tin: '123-456-789-005', gender: 'FEMALE', bankName: 'Security Bank',  bankAccountNo: '2233445566',   bankAccountName: 'Patricia M. Garcia' },
    { no: 'EMP-0000000007', fn: 'Jose',      ln: 'Hernandez',  pos: 'Team Lead',                deptId: opsDept.id,   salary: 38_000, rc: 49_000, clientId: coastline.id,  color: '#4F46E5', hireDate: '2021-07-14', sss: '34-5678907-8', ph: '12-345678907-8', pag: '1234-5678-9018', tin: '123-456-789-006', gender: 'MALE',   bankName: 'Bank of the Philippine Islands', bankAccountNo: '3344556677', bankAccountName: 'Jose T. Hernandez' },
    // ── Customer Support → Coastline
    { no: 'EMP-0000000008', fn: 'Marilou',   ln: 'Bautista',   pos: 'Customer Service Rep',     deptId: csDept.id,    salary: 25_000, rc: 33_000, clientId: coastline.id,  color: '#BE185D', hireDate: '2023-03-20', sss: '34-5678908-9', ph: '12-345678908-9', pag: '1234-5678-9019', tin: '123-456-789-007', gender: 'FEMALE', bankName: 'Landbank',       bankAccountNo: '4455667788',   bankAccountName: 'Marilou S. Bautista' },
    { no: 'EMP-0000000009', fn: 'Kevin',     ln: 'Mendoza',    pos: 'Customer Service Rep',     deptId: csDept.id,    salary: 25_000, rc: 33_000, clientId: coastline.id,  color: '#16A34A', hireDate: '2023-05-08', sss: '34-5678909-0', ph: '12-345678909-0', pag: '1234-5678-9020', tin: '123-456-789-008', gender: 'MALE',   bankName: 'UnionBank',      bankAccountNo: '5566778899',   bankAccountName: 'Kevin D. Mendoza' },
    // ── Finance → Pacific
    { no: 'EMP-0000000010', fn: 'Isabel',    ln: 'Torres',     pos: 'Senior Accountant',        deptId: finDept.id,   salary: 48_000, rc: 62_000, clientId: pacific.id,    color: '#CA8A04', hireDate: '2021-02-01', sss: '34-5678910-1', ph: '12-345678910-1', pag: '1234-5678-9021', tin: '123-456-789-009', gender: 'FEMALE', bankName: 'BDO Unibank',    bankAccountNo: '6677889912',   bankAccountName: 'Isabel C. Torres' },
    { no: 'EMP-0000000011', fn: 'Rafael',    ln: 'Aquino',     pos: 'Payroll Specialist',       deptId: finDept.id,   salary: 35_000, rc: 45_000, clientId: pacific.id,    color: '#2563EB', hireDate: '2022-08-15', sss: '34-5678911-2', ph: '12-345678911-2', pag: '1234-5678-9022', tin: '123-456-789-010', gender: 'MALE',   bankName: 'Bank of the Philippine Islands', bankAccountNo: '7788990012', bankAccountName: 'Rafael B. Aquino' },
    // ── Internal: HR
    { no: 'EMP-0000000012', fn: 'Camille',   ln: 'Ramos',      pos: 'HR Manager',               deptId: hrDept.id,    salary: 52_000, rc: null,   clientId: null,          color: '#7C3AED', hireDate: '2020-06-01', sss: '34-5678912-3', ph: '12-345678912-3', pag: '1234-5678-9023', tin: '123-456-789-011', gender: 'FEMALE', bankName: 'Metrobank',      bankAccountNo: '8899001123',   bankAccountName: 'Camille A. Ramos' },
    { no: 'EMP-0000000013', fn: 'Diana',     ln: 'Flores',     pos: 'HR Coordinator',           deptId: hrDept.id,    salary: 28_000, rc: null,   clientId: null,          color: '#059669', hireDate: '2023-09-04', sss: '34-5678913-4', ph: '12-345678913-4', pag: '1234-5678-9024', tin: '123-456-789-012', gender: 'FEMALE', bankName: 'UnionBank',      bankAccountNo: '9900112234',   bankAccountName: 'Diana R. Flores' },
    // ── Internal: Sales
    { no: 'EMP-0000000014', fn: 'Antonio',   ln: 'Pascual',    pos: 'Sales Manager',            deptId: salesDept.id, salary: 58_000, rc: null,   clientId: null,          color: '#DC2626', hireDate: '2021-10-18', sss: '34-5678914-5', ph: '12-345678914-5', pag: '1234-5678-9025', tin: '123-456-789-013', gender: 'MALE',   bankName: 'Security Bank',  bankAccountNo: '1234987654',   bankAccountName: 'Antonio J. Pascual' },
    // ── On bench (available, not deployed)
    { no: 'EMP-0000000015', fn: 'Liza',      ln: 'Navarro',    pos: 'Business Analyst',         deptId: opsDept.id,   salary: 40_000, rc: null,   clientId: null,          color: '#D97706', hireDate: '2024-01-15', sss: '34-5678915-6', ph: '12-345678915-6', pag: '1234-5678-9026', tin: '123-456-789-014', gender: 'FEMALE', bankName: 'BDO Unibank',    bankAccountNo: '2345678901',   bankAccountName: 'Liza P. Navarro' },
  ];

  const employees: { id: string; employeeNo: string; basicSalary: number; resourceCost: number | null; clientId: string | null }[] = [];
  for (const e of empSeed) {
    const emp = await prisma.employee.create({
      data: {
        employeeNo:   e.no,
        firstName:    e.fn,
        lastName:     e.ln,
        email:        `${e.fn.toLowerCase()}.${e.ln.toLowerCase().replace(/[\s.]/g, '')}@hrconnect.demo`,
        position:     e.pos,
        departmentId: e.deptId,
        status:       e.status ?? 'ACTIVE',
        hireDate:     new Date(e.hireDate),
        basicSalary:  e.salary,
        resourceCost: e.rc,
        payrollCost:  e.salary,
        clientId:     e.clientId,
        avatarColor:  e.color,
        sssNo:          e.sss,
        philhealthNo:   e.ph,
        pagibigNo:      e.pag,
        tinNo:          e.tin,
        gender:         e.gender,
        bankName:       e.bankName,
        bankAccountNo:  e.bankAccountNo,
        bankAccountName: e.bankAccountName,
      },
    });
    employees.push({ id: emp.id, employeeNo: emp.employeeNo, basicSalary: emp.basicSalary, resourceCost: emp.resourceCost, clientId: emp.clientId });
  }
  console.log(`  ✓ ${employees.length} employees`);

  // ── 5. User accounts ──────────────────────────────────────────────────────
  console.log('Creating user accounts…');

  // Super admin (not linked to an employee)
  await prisma.user.create({
    data: {
      name:     'HR Admin',
      email:    'admin@hrconnect.demo',
      password: await bcrypt.hash('Admin@2026', 12),
      role:     'SUPER_ADMIN',
    },
  });

  // HR Manager → linked to Camille Ramos (index 11)
  await prisma.user.create({
    data: {
      name:       'Camille Ramos',
      email:      'camille.ramos@hrconnect.demo',
      password:   await bcrypt.hash('Manager@2026', 12),
      role:       'HR_MANAGER',
      employeeId: employees[11].id,
    },
  });

  // Employee portal accounts for everyone else
  for (const emp of employees) {
    const email = `${empSeed.find(e => e.no === emp.employeeNo)!.fn.toLowerCase()}.${empSeed.find(e => e.no === emp.employeeNo)!.ln.toLowerCase().replace(/[\s.]/g, '')}@hrconnect.demo`;
    if (email === 'camille.ramos@hrconnect.demo') continue; // already created
    await prisma.user.create({
      data: {
        name:       `${empSeed.find(e => e.no === emp.employeeNo)!.fn} ${empSeed.find(e => e.no === emp.employeeNo)!.ln}`,
        email,
        password:   await bcrypt.hash(`Welcome@${emp.employeeNo}`, 12),
        role:       'EMPLOYEE',
        employeeId: emp.id,
      },
    });
  }

  // ── 6. Leave balances ─────────────────────────────────────────────────────
  console.log('Creating leave balances…');
  const year = new Date().getFullYear();
  for (const emp of employees) {
    for (const lt of allLeaveTypes) {
      const used = lt.code === 'SL' ? randInt(0, 4) : lt.code === 'VL' ? randInt(0, 6) : 0;
      await prisma.leaveBalance.create({
        data: {
          employeeId:  emp.id,
          leaveTypeId: lt.id,
          year,
          totalDays:   lt.daysPerYear,
          usedDays:    used,
          pendingDays: 0,
        },
      });
    }
  }

  // ── 7. Attendance (3 months) ──────────────────────────────────────────────
  console.log('Creating attendance records (3 months)…');

  const today = new Date();
  const start = new Date(today);
  start.setMonth(start.getMonth() - 3);
  start.setDate(1);

  // Per-employee attendance profile (some employees are more reliable than others)
  const profile = (idx: number) => ({
    presentRate: 0.80 + idx % 3 * 0.05,   // 80–90%
    lateRate:    0.03 + idx % 4 * 0.02,   // 3–9%
    absentRate:  0.02 + idx % 3 * 0.015,  // 2–5%
    otRate:      0.10 + idx % 5 * 0.04,   // 10–26%
  });

  const attendanceRows: any[] = [];
  for (let i = 0; i < employees.length; i++) {
    const emp = employees[i];
    const p   = profile(i);
    const d   = new Date(start);

    while (d <= today) {
      const dow = d.getDay();
      const isWeekend = dow === 0 || dow === 6;

      if (isWeekend) {
        attendanceRows.push({ employeeId: emp.id, date: new Date(d), status: 'WEEKEND' });
      } else {
        const r = rand();
        let status: string;
        let timeIn: Date | null = null;
        let timeOut: Date | null = null;
        let overtimeHrs = 0;

        const late = p.lateRate;
        const absent = late + p.absentRate;
        const halfDay = absent + 0.02;

        if (r < late) {
          status = 'LATE';
          timeIn = new Date(d); timeIn.setHours(9 + randInt(0, 1), randInt(1, 59), 0);
          timeOut = new Date(d); timeOut.setHours(18, randInt(0, 30), 0);
        } else if (r < absent) {
          status = 'ABSENT';
        } else if (r < halfDay) {
          status = 'HALF_DAY';
          timeIn = new Date(d); timeIn.setHours(8, 0, 0);
          timeOut = new Date(d); timeOut.setHours(12, 0, 0);
        } else if (r < halfDay + 0.015) {
          status = 'ON_LEAVE';
        } else {
          status = 'PRESENT';
          timeIn = new Date(d); timeIn.setHours(8, randInt(0, 15), 0);
          timeOut = new Date(d); timeOut.setHours(17, randInt(0, 30), 0);
          if (rand() < p.otRate) {
            overtimeHrs = randInt(1, 3);
            timeOut.setHours(17 + overtimeHrs, 0, 0);
          }
        }

        attendanceRows.push({ employeeId: emp.id, date: new Date(d), status, timeIn, timeOut, overtimeHrs });
      }
      d.setDate(d.getDate() + 1);
    }
  }

  // Batch-insert in chunks of 500
  for (let i = 0; i < attendanceRows.length; i += 500) {
    await prisma.attendance.createMany({ data: attendanceRows.slice(i, i + 500) });
  }
  console.log(`  ✓ ${attendanceRows.length} attendance records`);

  // ── 8. Leave requests ─────────────────────────────────────────────────────
  console.log('Creating leave requests…');
  await prisma.leaveRequest.createMany({
    data: [
      { employeeId: employees[0].id, leaveTypeId: vlType.id, startDate: new Date('2026-08-04'), endDate: new Date('2026-08-06'), totalDays: 3, reason: 'Family vacation in Bohol',  status: 'APPROVED', approvedAt: new Date('2026-07-26'), filedAt: new Date('2026-07-25'), updatedAt: new Date('2026-07-26') },
      { employeeId: employees[1].id, leaveTypeId: slType.id, startDate: new Date('2026-08-12'), endDate: new Date('2026-08-12'), totalDays: 1, reason: 'Fever and flu',              status: 'APPROVED', approvedAt: new Date('2026-08-12'), filedAt: new Date('2026-08-12'), updatedAt: new Date('2026-08-12') },
      { employeeId: employees[3].id, leaveTypeId: vlType.id, startDate: new Date('2026-09-22'), endDate: new Date('2026-09-24'), totalDays: 3, reason: 'Rest and personal matters', status: 'PENDING',  filedAt: new Date('2026-09-05'), updatedAt: new Date('2026-09-05') },
      { employeeId: employees[6].id, leaveTypeId: slType.id, startDate: new Date('2026-09-10'), endDate: new Date('2026-09-10'), totalDays: 1, reason: 'Medical check-up',          status: 'PENDING',  filedAt: new Date('2026-09-08'), updatedAt: new Date('2026-09-08') },
      { employeeId: employees[9].id, leaveTypeId: elType.id, startDate: new Date('2026-08-20'), endDate: new Date('2026-08-21'), totalDays: 2, reason: 'Family emergency',          status: 'APPROVED', approvedAt: new Date('2026-08-20'), filedAt: new Date('2026-08-20'), updatedAt: new Date('2026-08-20') },
      { employeeId: employees[2].id, leaveTypeId: vlType.id, startDate: new Date('2026-07-14'), endDate: new Date('2026-07-18'), totalDays: 5, reason: 'Summer break',              status: 'APPROVED', approvedAt: new Date('2026-07-05'), filedAt: new Date('2026-07-04'), updatedAt: new Date('2026-07-05') },
    ],
  });

  // ── 9. Payroll runs ───────────────────────────────────────────────────────
  console.log('Creating payroll runs…');
  const payrollMonths = [
    { period: 'Jun 2026 · Type 1 (1st Half)', year: 2026, month: 6, payPeriodType: 1, periodStart: new Date(2026, 4, 26), periodEnd: new Date(2026, 5, 10), status: 'PAID'   as const },
    { period: 'Jun 2026 · Type 2 (2nd Half)', year: 2026, month: 6, payPeriodType: 2, periodStart: new Date(2026, 5, 11), periodEnd: new Date(2026, 5, 25), status: 'PAID'   as const },
    { period: 'Jul 2026 · Type 1 (1st Half)', year: 2026, month: 7, payPeriodType: 1, periodStart: new Date(2026, 5, 26), periodEnd: new Date(2026, 6, 10), status: 'PAID'   as const },
    { period: 'Jul 2026 · Type 2 (2nd Half)', year: 2026, month: 7, payPeriodType: 2, periodStart: new Date(2026, 6, 11), periodEnd: new Date(2026, 6, 25), status: 'PAID'   as const },
    { period: 'Aug 2026 · Type 1 (1st Half)', year: 2026, month: 8, payPeriodType: 1, periodStart: new Date(2026, 6, 26), periodEnd: new Date(2026, 7, 10), status: 'POSTED' as const },
    { period: 'Aug 2026 · Type 2 (2nd Half)', year: 2026, month: 8, payPeriodType: 2, periodStart: new Date(2026, 7, 11), periodEnd: new Date(2026, 7, 25), status: 'POSTED' as const },
  ];

  let totalPayrollRecords = 0;
  for (const m of payrollMonths) {
    const run = await prisma.payrollRun.create({
      data: { period: m.period, year: m.year, month: m.month, payPeriodType: m.payPeriodType, periodStart: m.periodStart, periodEnd: m.periodEnd, status: m.status, runById: 'seed' },
    });

    for (const emp of employees) {
      const basic      = emp.basicSalary;
      const daysWorked = m.status === 'PAID' ? 20 : 18;
      const grossPay   = basic;
      // SSS: employer rate ~9.5%, employee 4.5%, ceiling ₱30k
      const sssBracket  = Math.min(basic, 30_000);
      const sssContrib  = Math.round(sssBracket * 0.045);
      // PhilHealth: 5% shared, employee pays 2.5%, ceiling ₱5k
      const philhealthContrib = Math.min(2_500, Math.round(basic * 0.025));
      // Pag-IBIG: 2%, max ₱200
      const pagibigContrib    = Math.min(200, Math.round(basic * 0.02));
      const mandatoryDeductions = sssContrib + philhealthContrib + pagibigContrib;
      const taxableIncome       = grossPay - mandatoryDeductions;
      const withholdingTax      = computeWithholding(taxableIncome);
      const totalDeductions     = mandatoryDeductions + withholdingTax;
      const netPay              = grossPay - totalDeductions;

      await prisma.payrollRecord.create({
        data: {
          payrollRunId:      run.id,
          employeeId:        emp.id,
          basicSalary:       basic,
          grossPay,
          sssContrib,
          philhealthContrib,
          pagibigContrib,
          taxableIncome,
          withholdingTax,
          totalDeductions,
          netPay,
          daysWorked,
          overtimePay: 0,
          allowances:  0,
        },
      });
      totalPayrollRecords++;
    }
  }
  console.log(`  ✓ ${payrollMonths.length} payroll runs  (${totalPayrollRecords} records)`);

  // ── 10. Billing history ───────────────────────────────────────────────────
  console.log('Creating billing records…');

  const rcTotal = (clientId: string) =>
    employees.filter(e => e.clientId === clientId).reduce((s, e) => s + (e.resourceCost ?? e.basicSalary), 0);

  const billings = [
    // Meridian — 4 months, current month pending
    { clientId: meridian.id,   date: '2026-06-01', paid: true,  paidAt: '2026-06-18' },
    { clientId: meridian.id,   date: '2026-07-01', paid: true,  paidAt: '2026-07-14' },
    { clientId: meridian.id,   date: '2026-08-01', paid: true,  paidAt: '2026-08-12' },
    { clientId: meridian.id,   date: '2026-09-01', paid: false },
    // Coastline — every 15th
    { clientId: coastline.id,  date: '2026-06-15', paid: true,  paidAt: '2026-06-20' },
    { clientId: coastline.id,  date: '2026-07-15', paid: true,  paidAt: '2026-07-22' },
    { clientId: coastline.id,  date: '2026-08-15', paid: true,  paidAt: '2026-08-19' },
    { clientId: coastline.id,  date: '2026-09-15', paid: false },
    // TechBridge — 15th monthly
    { clientId: techbridge.id, date: '2026-06-15', paid: true,  paidAt: '2026-06-28' },
    { clientId: techbridge.id, date: '2026-07-15', paid: true,  paidAt: '2026-07-30' },
    { clientId: techbridge.id, date: '2026-08-15', paid: false },
    // Pacific — 1st monthly, newer client
    { clientId: pacific.id,    date: '2026-07-01', paid: true,  paidAt: '2026-07-10' },
    { clientId: pacific.id,    date: '2026-08-01', paid: true,  paidAt: '2026-08-08' },
    { clientId: pacific.id,    date: '2026-09-01', paid: false },
  ];

  for (const b of billings) {
    await prisma.billing.create({
      data: {
        clientId:    b.clientId,
        billingDate: new Date(b.date),
        amount:      rcTotal(b.clientId),
        status:      b.paid ? 'PAID' : 'PENDING',
        paidAt:      b.paid && b.paidAt ? new Date(b.paidAt) : null,
        notes:       'Monthly resource billing',
        lineItems:   [],
      },
    });
  }
  console.log(`  ✓ ${billings.length} billing records`);

  // ── Done ──────────────────────────────────────────────────────────────────
  console.log('\n✅  Seed complete!\n');
  console.log('┌─────────────────────────────────────────────────────┐');
  console.log('│  Demo credentials                                    │');
  console.log('├─────────────────────────────────────────────────────┤');
  console.log('│  Super Admin   admin@hrconnect.demo / Admin@2026    │');
  console.log('│  HR Manager    camille.ramos@hrconnect.demo         │');
  console.log('│                / Manager@2026                       │');
  console.log('│  Employee      miguel.reyes@hrconnect.demo          │');
  console.log('│                / Welcome@EMP-0000000001             │');
  console.log('└─────────────────────────────────────────────────────┘');
  console.log(`
Data summary:
  ${allLeaveTypes.length}  leave types
  6  departments
  4  clients  (with policies)
  ${employees.length}  employees  (11 deployed, 4 internal/bench)
  ${attendanceRows.length}  attendance records  (3 months)
  6  leave requests
  ${payrollMonths.length}  payroll runs  (${totalPayrollRecords} records)
  ${billings.length}  billing records
`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());