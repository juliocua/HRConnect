/**
 * HRConnect — Payroll-only seed (Jan–Aug 2026)
 *
 * Clears only payroll records and runs — does NOT touch employees,
 * attendance, leave, billing, or users. Safe to re-run at any time.
 *
 * Run from server/:
 *   npx ts-node --esm prisma/seed-payroll.ts
 * Or if the project uses tsx:
 *   npx tsx prisma/seed-payroll.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ── Statutory deduction helpers (TRAIN Law 2024+) ─────────────────────────────

function computeSSS(basicSalary: number): number {
  const msc = Math.min(Math.max(basicSalary, 5_000), 35_000);
  return Math.round(msc * 0.045);
}

function computePhilHealth(basicSalary: number): number {
  return Math.round(Math.min(Math.max(basicSalary * 0.025, 500), 2_500));
}

function computePagIBIG(basicSalary: number): number {
  if (basicSalary < 1_500) return Math.round(basicSalary * 0.01);
  return Math.min(Math.round(basicSalary * 0.02), 200);
}

function computeWithholdingTax(taxableIncome: number): number {
  if (taxableIncome <= 20_833) return 0;
  if (taxableIncome <= 33_332) return Math.round((taxableIncome - 20_833) * 0.20);
  if (taxableIncome <= 66_666) return Math.round(2_500 + (taxableIncome - 33_332) * 0.25);
  if (taxableIncome <= 166_666) return Math.round(10_833 + (taxableIncome - 66_666) * 0.30);
  if (taxableIncome <= 666_666) return Math.round(40_833 + (taxableIncome - 166_666) * 0.32);
  return Math.round(200_833 + (taxableIncome - 666_666) * 0.35);
}

// ── Seeded random (reproducible) ─────────────────────────────────────────────
let _seed = 77;
function rand(): number {
  _seed = (_seed * 1_664_525 + 1_013_904_223) & 0xffffffff;
  return (_seed >>> 0) / 0xffffffff;
}
function randInt(min: number, max: number) { return Math.floor(rand() * (max - min + 1)) + min; }

// ── Payroll periods: Jan–Aug 2026, Type 1 + Type 2 each month ────────────────
const RUNS = [
  { period: 'Jan 2026 · Type 1 (1st Half)', year: 2026, month: 1, payPeriodType: 1, periodStart: new Date(2025, 11, 26), periodEnd: new Date(2026,  0, 10), status: 'PAID'   as const },
  { period: 'Jan 2026 · Type 2 (2nd Half)', year: 2026, month: 1, payPeriodType: 2, periodStart: new Date(2026,  0, 11), periodEnd: new Date(2026,  0, 25), status: 'PAID'   as const },
  { period: 'Feb 2026 · Type 1 (1st Half)', year: 2026, month: 2, payPeriodType: 1, periodStart: new Date(2026,  0, 26), periodEnd: new Date(2026,  1, 10), status: 'PAID'   as const },
  { period: 'Feb 2026 · Type 2 (2nd Half)', year: 2026, month: 2, payPeriodType: 2, periodStart: new Date(2026,  1, 11), periodEnd: new Date(2026,  1, 25), status: 'PAID'   as const },
  { period: 'Mar 2026 · Type 1 (1st Half)', year: 2026, month: 3, payPeriodType: 1, periodStart: new Date(2026,  1, 26), periodEnd: new Date(2026,  2, 10), status: 'PAID'   as const },
  { period: 'Mar 2026 · Type 2 (2nd Half)', year: 2026, month: 3, payPeriodType: 2, periodStart: new Date(2026,  2, 11), periodEnd: new Date(2026,  2, 25), status: 'PAID'   as const },
  { period: 'Apr 2026 · Type 1 (1st Half)', year: 2026, month: 4, payPeriodType: 1, periodStart: new Date(2026,  2, 26), periodEnd: new Date(2026,  3, 10), status: 'PAID'   as const },
  { period: 'Apr 2026 · Type 2 (2nd Half)', year: 2026, month: 4, payPeriodType: 2, periodStart: new Date(2026,  3, 11), periodEnd: new Date(2026,  3, 25), status: 'PAID'   as const },
  { period: 'May 2026 · Type 1 (1st Half)', year: 2026, month: 5, payPeriodType: 1, periodStart: new Date(2026,  3, 26), periodEnd: new Date(2026,  4, 10), status: 'PAID'   as const },
  { period: 'May 2026 · Type 2 (2nd Half)', year: 2026, month: 5, payPeriodType: 2, periodStart: new Date(2026,  4, 11), periodEnd: new Date(2026,  4, 25), status: 'PAID'   as const },
  { period: 'Jun 2026 · Type 1 (1st Half)', year: 2026, month: 6, payPeriodType: 1, periodStart: new Date(2026,  4, 26), periodEnd: new Date(2026,  5, 10), status: 'PAID'   as const },
  { period: 'Jun 2026 · Type 2 (2nd Half)', year: 2026, month: 6, payPeriodType: 2, periodStart: new Date(2026,  5, 11), periodEnd: new Date(2026,  5, 25), status: 'PAID'   as const },
  { period: 'Jul 2026 · Type 1 (1st Half)', year: 2026, month: 7, payPeriodType: 1, periodStart: new Date(2026,  5, 26), periodEnd: new Date(2026,  6, 10), status: 'PAID'   as const },
  { period: 'Jul 2026 · Type 2 (2nd Half)', year: 2026, month: 7, payPeriodType: 2, periodStart: new Date(2026,  6, 11), periodEnd: new Date(2026,  6, 25), status: 'PAID'   as const },
  { period: 'Aug 2026 · Type 1 (1st Half)', year: 2026, month: 8, payPeriodType: 1, periodStart: new Date(2026,  6, 26), periodEnd: new Date(2026,  7, 10), status: 'POSTED' as const },
  { period: 'Aug 2026 · Type 2 (2nd Half)', year: 2026, month: 8, payPeriodType: 2, periodStart: new Date(2026,  7, 11), periodEnd: new Date(2026,  7, 25), status: 'POSTED' as const },
];

async function main() {
  console.log('💰  Payroll-only seed — Jan–Aug 2026\n');

  // ── Clear only payroll data ────────────────────────────────────────────────
  console.log('Clearing payroll records and runs…');
  await prisma.payrollRecord.deleteMany();
  await prisma.payrollRun.deleteMany();

  // ── Fetch active employees ─────────────────────────────────────────────────
  const employees = await prisma.employee.findMany({
    where: { status: { in: ['ACTIVE', 'ON_LEAVE'] } },
    select: { id: true, basicSalary: true },
  });

  if (employees.length === 0) {
    console.error('⚠️  No employees found — run the main seed first (npm run db:seed).');
    process.exit(1);
  }
  console.log(`Found ${employees.length} active employees\n`);

  // ── Seed runs ──────────────────────────────────────────────────────────────
  let totalRecords = 0;

  for (const m of RUNS) {
    const run = await prisma.payrollRun.create({
      data: {
        period:        m.period,
        year:          m.year,
        month:         m.month,
        payPeriodType: m.payPeriodType,
        periodStart:   m.periodStart,
        periodEnd:     m.periodEnd,
        status:        m.status,
        runById:       'seed',
        runAt:         new Date(),
      },
    });

    // Semi-monthly max ≈ 11 working days; PAID runs are complete, POSTED are in-period
    const records = employees.map(emp => {
      const daysWorked = m.status === 'PAID'
        ? randInt(9, 11)   // 9–11 days (realistic for a full semi-monthly period)
        : randInt(7, 11);  // 7–11 days (in-progress)

      // Gross = prorated daily rate × days actually worked
      const grossPay          = (emp.basicSalary / 22) * daysWorked;

      // Statutory contributions computed from monthly salary bracket
      const sssContrib        = computeSSS(emp.basicSalary);
      const philhealthContrib = computePhilHealth(emp.basicSalary);
      const pagibigContrib    = computePagIBIG(emp.basicSalary);

      const taxableIncome  = Math.max(0, grossPay - sssContrib - philhealthContrib - pagibigContrib);
      const withholdingTax = computeWithholdingTax(taxableIncome);
      const totalDeductions = sssContrib + philhealthContrib + pagibigContrib + withholdingTax;
      const netPay          = grossPay - totalDeductions;

      return {
        payrollRunId:      run.id,
        employeeId:        emp.id,
        basicSalary:       emp.basicSalary,
        daysWorked,
        grossPay,
        overtimePay:       0,
        allowances:        0,
        otherDeductions:   0,
        lateDeduction:     0,
        holidayPay:        0,
        nightDifferential: 0,
        sssContrib,
        philhealthContrib,
        pagibigContrib,
        taxableIncome,
        withholdingTax,
        totalDeductions,
        netPay,
      };
    });

    await prisma.payrollRecord.createMany({ data: records });
    totalRecords += records.length;
    console.log(`  ✓  ${m.period}  [${m.status}]  —  ${records.length} records`);
  }

  console.log(`\n✅  Done — ${RUNS.length} payroll runs, ${totalRecords} records total`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
