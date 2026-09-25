/**
 * Deletes ALL PayrollRecord, PayrollRun, and Attendance records from the database.
 * Run from server/ directory:
 *
 *   Windows PowerShell:
 *     $env:DATABASE_URL="postgresql://postgres:<PASSWORD>@tramway.proxy.rlwy.net:33728/railway"
 *     npx ts-node src/scripts/cleanup-records.ts
 *
 *   Or pipe into tsx:
 *     DATABASE_URL="..." npx tsx src/scripts/cleanup-records.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Deleting PayrollRecord rows...');
  const pr = await prisma.payrollRecord.deleteMany({});
  console.log(`  → Deleted ${pr.count} PayrollRecord rows`);

  console.log('Deleting PayrollRun rows...');
  const run = await prisma.payrollRun.deleteMany({});
  console.log(`  → Deleted ${run.count} PayrollRun rows`);

  console.log('Deleting Attendance rows...');
  const att = await prisma.attendance.deleteMany({});
  console.log(`  → Deleted ${att.count} Attendance rows`);

  console.log('Done.');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
