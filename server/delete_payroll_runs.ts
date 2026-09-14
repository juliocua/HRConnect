import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Deleting all payroll records...');
  const { count: recCount } = await prisma.payrollRecord.deleteMany({});
  console.log(`  Deleted ${recCount} payroll records.`);

  console.log('Deleting all payroll runs...');
  const { count: runCount } = await prisma.payrollRun.deleteMany({});
  console.log(`  Deleted ${runCount} payroll runs.`);

  console.log('Done.');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
