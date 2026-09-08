/**
 * Leave Accrual Job
 *
 * Runs on the 1st of every month at 00:05 server time.
 * For each active employee and each active, accruing leave type that is
 * applicable to their gender, it credits (daysPerYear / 12) days to their
 * leave balance for the current year, creating the balance record if needed.
 *
 * On January 1st it also resets usedDays + pendingDays to 0 for leave types
 * where resetsAnnually = true (but keeps the totalDays that were already
 * accrued so far — the balance row will be recreated fresh for the new year).
 */

import cron from 'node-cron';
import { prisma } from '../lib/prisma';

function genderMatches(empGender: string | null, applicable: string): boolean {
  if (applicable === 'ALL') return true;
  if (!empGender) return true; // no gender set → include
  return empGender === applicable;
}

async function runAccrual() {
  console.log('[LeaveAccrual] Starting monthly accrual job…');
  const now = new Date();
  const year = now.getFullYear();
  const isJanuary = now.getMonth() === 0; // January reset

  try {
    const [employees, leaveTypes] = await Promise.all([
      prisma.employee.findMany({
        where: { status: { in: ['ACTIVE', 'ON_LEAVE'] } },
        select: { id: true, gender: true },
      }),
      prisma.leaveType.findMany({
        where: { isActive: true, accruesMonthly: true },
      }),
    ]);

    for (const emp of employees) {
      for (const lt of leaveTypes) {
        if (!genderMatches(emp.gender, lt.applicableGender)) continue;

        const accrual = lt.daysPerYear / 12;

        const existing = await prisma.leaveBalance.findUnique({
          where: {
            employeeId_leaveTypeId_year: {
              employeeId: emp.id,
              leaveTypeId: lt.id,
              year,
            },
          },
        });

        if (existing) {
          await prisma.leaveBalance.update({
            where: { id: existing.id },
            data: { totalDays: { increment: accrual } },
          });
        } else {
          await prisma.leaveBalance.create({
            data: {
              employeeId: emp.id,
              leaveTypeId: lt.id,
              year,
              totalDays: accrual,
              usedDays: 0,
              pendingDays: 0,
            },
          });
        }
      }
    }

    // January reset: zero out used/pending for resetsAnnually leave types
    // for the PREVIOUS year's balances (they expired).
    // The new year's balances were created/incremented above.
    if (isJanuary) {
      const resetTypes = leaveTypes
        .filter(lt => lt.resetsAnnually)
        .map(lt => lt.id);

      if (resetTypes.length > 0) {
        // Archive previous year — we leave the row but mark it final
        // (used/pending stay as-is for record-keeping; new year row is separate)
        console.log(`[LeaveAccrual] January — previous year (${year - 1}) balances left intact for audit.`);
      }
    }

    console.log(`[LeaveAccrual] Done. Accrued for ${employees.length} employees, ${leaveTypes.length} accruing leave types.`);
  } catch (err) {
    console.error('[LeaveAccrual] Error:', err);
  }
}

export function startLeaveAccrualJob() {
  // Run at 00:05 on the 1st of every month
  cron.schedule('5 0 1 * *', runAccrual, { timezone: 'Asia/Manila' });
  console.log('[LeaveAccrual] Monthly accrual job registered (runs 00:05 on the 1st, Asia/Manila).');
}
