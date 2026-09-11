import { Request, Response, NextFunction } from 'express';

// ── Access levels ─────────────────────────────────────────────────────────────
type Access = 'full' | 'read' | 'none';

// ── Module names (match API path segments) ────────────────────────────────────
export type RbacModule =
  | 'employees'
  | 'attendance'
  | 'leave'
  | 'payroll'
  | 'billing'
  | 'clients'
  | 'reports'
  | 'import'
  | 'overtime'
  | 'companies';

// ── Permission matrix ─────────────────────────────────────────────────────────
//
// Role               | employees | attendance | leave | payroll | billing | clients | reports | import | overtime | companies
// -------------------|-----------|------------|-------|---------|---------|---------|---------|--------|----------|----------
// SUPER_ADMIN        | full      | full       | full  | full    | full    | full    | full    | full   | full     | full
// HR_MANAGER         | full      | full       | full  | full    | full    | full    | full    | full   | full     | full
// HR_STAFF           | full      | full       | full  | full    | full    | full    | full    | full   | full     | full
// EMPLOYEE_RELATIONS | full      | none       | none  | none    | none    | read    | none    | none   | none     | none
// ACCOUNTS_MGMT      | read      | full       | full  | full    | none    | read    | full    | none   | full     | none
// BILLING_COLLECTION | full      | full       | full  | full    | full    | full    | full    | full   | full     | full
// ACCOUNTING         | full      | full       | full  | full    | full    | full    | full    | full   | full     | full
// EMPLOYEE           | /me only  | hub only   | hub   | hub     | none    | none    | none    | none   | hub      | none

const ROLE_ACCESS: Record<string, Record<RbacModule, Access>> = {
  SUPER_ADMIN:        { employees: 'full', attendance: 'full', leave: 'full', payroll: 'full', billing: 'full', clients: 'full', reports: 'full', import: 'full', overtime: 'full', companies: 'full' },
  HR_MANAGER:         { employees: 'full', attendance: 'full', leave: 'full', payroll: 'full', billing: 'full', clients: 'full', reports: 'full', import: 'full', overtime: 'full', companies: 'full' },
  HR_STAFF:           { employees: 'full', attendance: 'full', leave: 'full', payroll: 'full', billing: 'full', clients: 'full', reports: 'full', import: 'full', overtime: 'full', companies: 'full' },
  EMPLOYEE_RELATIONS: { employees: 'full', attendance: 'none', leave: 'none', payroll: 'none', billing: 'none', clients: 'read', reports: 'none', import: 'none', overtime: 'none', companies: 'none' },
  ACCOUNTS_MANAGEMENT:{ employees: 'read', attendance: 'full', leave: 'full', payroll: 'full', billing: 'none', clients: 'read', reports: 'full', import: 'none', overtime: 'full', companies: 'none' },
  BILLING_COLLECTION: { employees: 'full', attendance: 'full', leave: 'full', payroll: 'full', billing: 'full', clients: 'full', reports: 'full', import: 'full', overtime: 'full', companies: 'full' },
  ACCOUNTING:         { employees: 'full', attendance: 'full', leave: 'full', payroll: 'full', billing: 'full', clients: 'full', reports: 'full', import: 'full', overtime: 'full', companies: 'full' },
  // EMPLOYEE: handled by self-service bypass below — matrix values not consulted
  EMPLOYEE:           { employees: 'none', attendance: 'none', leave: 'none', payroll: 'none', billing: 'none', clients: 'none', reports: 'none', import: 'none', overtime: 'none', companies: 'none' },
};

// ── Middleware factory ────────────────────────────────────────────────────────
// Usage: app.use('/api/employees', authenticate, rbacGuard('employees'), employeeRoutes)
//
// rbacGuard runs AFTER authenticate so req.user is already populated.
// It checks the role's access level for the given module and blocks the request
// if the role has 'none' access, or if the role has 'read' access but the
// request is not a GET (i.e. write operations are denied).
//
// Special case — EMPLOYEE role:
//   employees module : only /me and /me/* paths are allowed (own record)
//   all other modules: passthrough to the route handler, which enforces
//                      data isolation via req.user.employeeId
export function rbacGuard(module: RbacModule) {
  return (req: Request, res: Response, next: NextFunction) => {
    const role = req.user?.role;
    if (!role) return res.status(401).json({ error: 'Unauthorized' });

    // ── EMPLOYEE self-service bypass ──────────────────────────────────────────
    if (role === 'EMPLOYEE') {
      if (module === 'employees') {
        // Block the HR employee list/CRUD; only allow self-service /me paths
        if (req.path === '/me' || req.path.startsWith('/me/')) return next();
        return res.status(403).json({ error: 'Access denied: your role does not have access to this module' });
      }
      // attendance, leave, overtime, payroll: employees access their own data
      // through the Employee Hub — route handlers enforce data isolation
      if (['attendance', 'leave', 'overtime', 'payroll'].includes(module)) return next();
      // billing, clients, reports, import, companies: no access
      return res.status(403).json({ error: 'Access denied: your role does not have access to this module' });
    }

    // ── All other roles: check permission matrix ──────────────────────────────
    const access: Access = ROLE_ACCESS[role]?.[module] ?? 'none';

    if (access === 'none') {
      return res.status(403).json({ error: 'Access denied: your role does not have access to this module' });
    }

    if (access === 'read' && req.method !== 'GET') {
      return res.status(403).json({ error: 'Read-only access: your role cannot modify this resource' });
    }

    next();
  };
}
