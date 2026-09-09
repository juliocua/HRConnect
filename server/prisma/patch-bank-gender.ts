/**
 * Patch script — adds gender + bank details to existing employees.
 * Run: npx tsx prisma/patch-bank-gender.ts  (from server/)
 * Safe to re-run — only updates, never deletes.
 */

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const patches: { no: string; gender: 'MALE' | 'FEMALE' | 'OTHER'; bankName: string; bankAccountNo: string; bankAccountName: string }[] = [
  { no: 'EMP-0000000001', gender: 'MALE',   bankName: 'BDO Unibank',                    bankAccountNo: '1234567890', bankAccountName: 'Miguel P. Reyes' },
  { no: 'EMP-0000000002', gender: 'FEMALE', bankName: 'Bank of the Philippine Islands',  bankAccountNo: '9876543210', bankAccountName: 'Ana L. Cruz' },
  { no: 'EMP-0000000003', gender: 'MALE',   bankName: 'UnionBank',                       bankAccountNo: '1122334455', bankAccountName: 'Carlo R. Santos' },
  { no: 'EMP-0000000004', gender: 'FEMALE', bankName: 'Metrobank',                       bankAccountNo: '5544332211', bankAccountName: 'Sophia A. Lim' },
  { no: 'EMP-0000000005', gender: 'MALE',   bankName: 'BDO Unibank',                    bankAccountNo: '6677889900', bankAccountName: 'Marco G. Dela Cruz' },
  { no: 'EMP-0000000006', gender: 'FEMALE', bankName: 'Security Bank',                   bankAccountNo: '2233445566', bankAccountName: 'Patricia M. Garcia' },
  { no: 'EMP-0000000007', gender: 'MALE',   bankName: 'Bank of the Philippine Islands',  bankAccountNo: '3344556677', bankAccountName: 'Jose T. Hernandez' },
  { no: 'EMP-0000000008', gender: 'FEMALE', bankName: 'Landbank',                        bankAccountNo: '4455667788', bankAccountName: 'Marilou S. Bautista' },
  { no: 'EMP-0000000009', gender: 'MALE',   bankName: 'UnionBank',                       bankAccountNo: '5566778899', bankAccountName: 'Kevin D. Mendoza' },
  { no: 'EMP-0000000010', gender: 'FEMALE', bankName: 'BDO Unibank',                    bankAccountNo: '6677889912', bankAccountName: 'Isabel C. Torres' },
  { no: 'EMP-0000000011', gender: 'MALE',   bankName: 'Bank of the Philippine Islands',  bankAccountNo: '7788990012', bankAccountName: 'Rafael B. Aquino' },
  { no: 'EMP-0000000012', gender: 'FEMALE', bankName: 'Metrobank',                       bankAccountNo: '8899001123', bankAccountName: 'Camille A. Ramos' },
  { no: 'EMP-0000000013', gender: 'FEMALE', bankName: 'UnionBank',                       bankAccountNo: '9900112234', bankAccountName: 'Diana R. Flores' },
  { no: 'EMP-0000000014', gender: 'MALE',   bankName: 'Security Bank',                   bankAccountNo: '1234987654', bankAccountName: 'Antonio J. Pascual' },
  { no: 'EMP-0000000015', gender: 'FEMALE', bankName: 'BDO Unibank',                    bankAccountNo: '2345678901', bankAccountName: 'Liza P. Navarro' },
];

async function main() {
  console.log('Patching gender + bank details for existing employees…\n');
  let updated = 0;
  for (const p of patches) {
    const result = await prisma.employee.updateMany({
      where: { employeeNo: p.no },
      data: {
        gender:          p.gender,
        bankName:        p.bankName,
        bankAccountNo:   p.bankAccountNo,
        bankAccountName: p.bankAccountName,
      },
    });
    if (result.count > 0) {
      console.log(`  ✓ ${p.no} — ${p.gender} · ${p.bankName}`);
      updated++;
    } else {
      console.warn(`  ⚠ ${p.no} not found — skipped`);
    }
  }
  console.log(`\n✅  Done — ${updated}/${patches.length} employees updated.`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
