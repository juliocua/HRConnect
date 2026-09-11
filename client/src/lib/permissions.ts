import type { UserRole } from '@/types';

// ── Access levels ─────────────────────────────────────────────────────────────
export type Access = 'full' | 'read' | 'none';

// ── Module names (mirror the backend RBAC) ────────────────────────────────────
export type Module =
  | 'dashboard'
  | 'employees'
  | 'attendance'
  | 'leave'
  | 'overtime'
  | 'payroll'
  | 'billing'
  | 'clients'
  | 'reports'
  | 'import'
  | 'leaveSetup';

// ── Permission matrix ─────────────────────────────────────────────────────────
const ROLE_ACCESS: Record<UserRole, Record<Module, Access>> = {
  SUPER_ADMIN: {
    dashboard: 'full', employees: 'full', attendance: 'full', leave: 'full',
    overtime: 'full', payroll: 'full', billing: 'full', clients: 'full',
    reports: 'full', import: 'full', leaveSetup: 'full',
  },
  HR_MANAGER: {
    dashboard: 'full', employees: 'full', attendance: 'full', leave: 'full',
    overtime: 'full', payroll: 'full', billing: 'full', clients: 'full',
    reports: 'full', import: 'full', leaveSetup: 'full',
  },
  HR_STAFF: {
    dashboard: 'full', employees: 'full', attendance: 'full', leave: 'full',
    overtime: 'full', payroll: 'full', billing: 'full', clients: 'full',
    reports: 'full', import: 'full', leaveSetup: 'full',
  },
  EMPLOYEE_RELATIONS: {
    dashboard: 'full', employees: 'full', attendance: 'none', leave: 'none',
    overtime: 'none', payroll: 'none', billing: 'none', clients: 'none',
    reports: 'none', import: 'none', leaveSetup: 'none',
  },
  ACCOUNTS_MANAGEMENT: {
    dashboard: 'full', employees: 'read', attendance: 'full', leave: 'full',
    overtime: 'full', payroll: 'full', billing: 'none', clients: 'none',
    reports: 'full', import: 'none', leaveSetup: 'none',
  },
  BILLING_COLLECTION: {
    dashboard: 'full', employees: 'full', attendance: 'full', leave: 'full',
    overtime: 'full', payroll: 'full', billing: 'full', clients: 'full',
    reports: 'full', import: 'full', leaveSetup: 'full',
  },
  ACCOUNTING: {
    dashboard: 'full', employees: 'full', attendance: 'full', leave: 'full',
    overtime: 'full', payroll: 'full', billing: 'full', clients: 'full',
    reports: 'full', import: 'full', leaveSetup: 'full',
  },
  EMPLOYEE: {
    dashboard: 'none', employees: 'none', attendance: 'none', leave: 'none',
    overtime: 'none', payroll: 'none', billing: 'none', clients: 'none',
    reports: 'none', import: 'none', leaveSetup: 'none',
  },
};

// ── Helper functions ──────────────────────────────────────────────────────────

/** Returns the access level for a role + module. Defaults to 'none' for unknown roles. */
export function getAccess(role: UserRole | undefined, module: Module): Access {
  if (!role) return 'none';
  return ROLE_ACCESS[role]?.[module] ?? 'none';
}

/** True if the role can see this module (access is 'read' or 'full'). */
export function canAccess(role: UserRole | undefined, module: Module): boolean {
  return getAccess(role, module) !== 'none';
}

/** True if the role can perform write actions on this module (access is 'full'). */
export function canWrite(role: UserRole | undefined, module: Module): boolean {
  return getAccess(role, module) === 'full';
}

// ── Human-readable role labels ────────────────────────────────────────────────
export const ROLE_LABELS: Record<UserRole, string> = {
  SUPER_ADMIN:         'Super Admin',
  HR_MANAGER:          'HR Manager',
  HR_STAFF:            'HR Staff',
  EMPLOYEE:            'Employee',
  EMPLOYEE_RELATIONS:  'Employee Relations',
  ACCOUNTS_MANAGEMENT: 'Accounts Management',
  BILLING_COLLECTION:  'Billing & Collection',
  ACCOUNTING:          'Accounting',
};
