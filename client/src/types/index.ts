// ── Auth ──────────────────────────────────────────────────────────────────────
export type UserRole = 'SUPER_ADMIN' | 'HR_MANAGER' | 'HR_STAFF' | 'EMPLOYEE';
export type AuthProvider = 'LOCAL' | 'GOOGLE' | 'MICROSOFT';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatarUrl?: string;
  provider?: AuthProvider;
  employeeId?: string;
}

// ── Company ───────────────────────────────────────────────────────────────────
export interface Company {
  id: string;
  name: string;
  code: string;
  address?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: { users: number };
}

// ── Department ────────────────────────────────────────────────────────────────
export interface Department {
  id: string;
  name: string;
}

// ── Employee ──────────────────────────────────────────────────────────────────
export type EmployeeStatus = 'ACTIVE' | 'ON_LEAVE' | 'INACTIVE' | 'TERMINATED';
export type EmployeeGender = 'MALE' | 'FEMALE' | 'OTHER';

export interface Employee {
  id: string;
  employeeNo: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  position: string;
  departmentId: string;
  department: Department;
  managerId?: string;
  manager?: { id: string; firstName: string; lastName: string; position: string };
  subordinates?: { id: string; firstName: string; lastName: string; position: string }[];
  status: EmployeeStatus;
  hireDate: string;
  basicSalary: number;
  resourceCost?: number | null;
  payrollCost?: number | null;
  clientId?: string | null;
  client?: { id: string; name: string } | null;
  sssNo?: string;
  philhealthNo?: string;
  pagibigNo?: string;
  tinNo?: string;
  gender?: EmployeeGender | null;
  avatarColor: string;
  photoUrl?: string | null;
  address?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  bankName?: string | null;
  bankAccountNo?: string | null;
  bankAccountName?: string | null;
  createdAt: string;
  user?: { id: string; email: string; isActive: boolean } | null;
}

export type EmployeeFormData = Omit<Employee, 'id' | 'department' | 'manager' | 'subordinates' | 'createdAt' | 'employeeNo'> & {
  employeeNo?: string;
};

// ── Profile Change Requests ───────────────────────────────────────────────────
export type ProfileChangeStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface ProfileChangeRequest {
  id: string;
  employeeId: string;
  employee?: Pick<Employee, 'id' | 'firstName' | 'lastName' | 'position' | 'avatarColor' | 'phone' | 'address' | 'emergencyContactName' | 'emergencyContactPhone'>;
  changes: {
    phone?: string;
    address?: string;
    emergencyContactName?: string;
    emergencyContactPhone?: string;
  };
  status: ProfileChangeStatus;
  reviewedById?: string | null;
  reviewedAt?: string | null;
  rejectionNote?: string | null;
  submittedAt: string;
  updatedAt: string;
}

// ── Gov ID Change Requests ────────────────────────────────────────────────────
export interface GovIdChangeRequest {
  id: string;
  employeeId: string;
  employee?: Pick<Employee, 'id' | 'firstName' | 'lastName' | 'position' | 'avatarColor' | 'sssNo' | 'philhealthNo' | 'pagibigNo' | 'tinNo'>;
  sssNo?: string | null;
  philhealthNo?: string | null;
  pagibigNo?: string | null;
  tinNo?: string | null;
  status: ProfileChangeStatus;
  reviewedById?: string | null;
  reviewedAt?: string | null;
  rejectionNote?: string | null;
  submittedAt: string;
  updatedAt: string;
}

// ── Audit Log ─────────────────────────────────────────────────────────────────
export interface AuditLog {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  performedById: string;
  performedAt: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

// ── Attendance ────────────────────────────────────────────────────────────────
export type AttendanceStatus = 'PRESENT' | 'LATE' | 'ABSENT' | 'HALF_DAY' | 'ON_LEAVE' | 'HOLIDAY' | 'WEEKEND';

export interface AttendanceRecord {
  id: string;
  employeeId: string;
  employee: Pick<Employee, 'id' | 'firstName' | 'lastName' | 'position' | 'avatarColor'>;
  date: string;
  timeIn?: string;
  timeOut?: string;
  status: AttendanceStatus;
  overtimeHrs: number;
  notes?: string;
  isManualEntry?: boolean;
  manualReason?: string;
  clockInAt?: string;
  clockOutAt?: string;
}

export type AttendanceEditRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface AttendanceEditRequest {
  id: string;
  employeeId: string;
  employee: Pick<Employee, 'id' | 'firstName' | 'lastName' | 'position' | 'avatarColor'>;
  attendanceDate: string;
  requestedTimeIn?: string | null;
  requestedTimeOut?: string | null;
  requestedStatus?: string | null;
  reason: string;
  attachmentUrl?: string | null;
  status: AttendanceEditRequestStatus;
  reviewedById?: string | null;
  reviewedAt?: string | null;
  rejectionNote?: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Leave ─────────────────────────────────────────────────────────────────────
export interface LeaveType {
  id: string;
  code: string;
  name: string;
  daysPerYear: number;
  isPaid: boolean;
  legalBasis?: string | null;
  applicableGender: 'ALL' | 'MALE' | 'FEMALE';
  resetsAnnually: boolean;
  accruesMonthly: boolean;
  isManual: boolean;
  isActive: boolean;
}

export type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface LeaveRequest {
  id: string;
  employeeId: string;
  employee: Pick<Employee, 'id' | 'firstName' | 'lastName' | 'position' | 'avatarColor'>;
  leaveTypeId: string;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  totalDays: number;
  reason?: string;
  status: LeaveStatus;
  filedAt: string;
  approvedAt?: string;
  rejectedAt?: string;
  rejectionNote?: string;
}

export interface LeaveBalance {
  id: string;
  employeeId: string;
  leaveTypeId: string;
  leaveType: LeaveType;
  year: number;
  totalDays: number;
  usedDays: number;
  pendingDays: number;
}

// ── Payroll ───────────────────────────────────────────────────────────────────
export type PayrollStatus = 'DRAFT' | 'POSTED' | 'PAID';

export interface PayrollRecord {
  id: string;
  payrollRunId: string;
  employeeId: string;
  employee: Pick<Employee, 'id' | 'firstName' | 'lastName' | 'position' | 'avatarColor'> & {
    department: Department;
    client?: { id: string; name: string } | null;
  };
  basicSalary: number;
  grossPay: number;
  sssContrib: number;
  philhealthContrib: number;
  pagibigContrib: number;
  taxableIncome: number;
  withholdingTax: number;
  totalDeductions: number;
  otherDeductions: number;
  netPay: number;
  daysWorked: number;
  overtimePay: number;
  allowances: number;
  lateDeduction: number;
  holidayPay: number;
  nightDifferential: number;
}

export interface PayrollRun {
  id: string;
  period: string;
  year: number;
  month: number;
  payPeriodType: number;
  description?: string;
  periodStart: string;
  periodEnd: string;
  status: PayrollStatus;
  runAt: string;
  records: PayrollRecord[];
}

export interface MyPayrollRecord extends Omit<PayrollRecord, 'employee'> {
  payrollRun: {
    period: string; year: number; month: number; payPeriodType: number;
    description?: string; periodStart?: string; periodEnd?: string;
    runAt?: string; status: PayrollStatus;
  };
  employee?: { client?: { id: string; name: string } | null };
}

// ── Overtime ──────────────────────────────────────────────────────────────────
export type OTStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface OvertimeRequest {
  id: string;
  employeeId: string;
  employee: Pick<Employee, 'id' | 'firstName' | 'lastName' | 'position' | 'avatarColor'>;
  attendanceId?: string | null;
  date: string;
  hours: number;
  reason?: string;
  status: OTStatus;
  approvedAt?: string;
  rejectedAt?: string;
  rejectionNote?: string;
  filedAt: string;
}

// ── Clients & Billing ─────────────────────────────────────────────────────────
export type BillingCycle = 'WEEKLY' | 'EVERY_15TH' | 'EVERY_30TH' | 'MONTHLY';
export type BillingStatus = 'PENDING' | 'PAID' | 'CANCELLED';

export interface ClientPolicy {
  id: string;
  clientId: string;
  type: string;
  title: string;
  value?: string | null;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface Client {
  id: string;
  name: string;
  address?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  servicesOffered?: string;
  specificRequest?: string;
  billingCycle: BillingCycle;
  billingDate?: number | null;
  payPeriodType?: number | null;
  adminFeeRate?: number | null;
  isVatable?: boolean;
  hasEwt?: boolean;
  billingTerms?: string | null;
  activeContract: boolean;
  createdAt: string;
  policies?: ClientPolicy[];
  billings?: Billing[];
  employees?: Pick<Employee, 'id' | 'firstName' | 'lastName' | 'position' | 'avatarColor' | 'status' | 'resourceCost' | 'payrollCost'>[];
  _count?: { employees: number; billings: number };
}

export interface Billing {
  id: string;
  clientId: string;
  client?: { id: string; name: string; billingCycle: BillingCycle };
  billingDate: string;
  dueDate?: string;
  amount: number;
  status: BillingStatus;
  paidAt?: string;
  paymentRef?: string;
  paymentLinkId?: string;
  paymentLinkUrl?: string;
  notes?: string;
  createdAt: string;
}

export interface BillingSummary {
  pendingAmount: number;
  pendingCount: number;
  paidAmount: number;
  paidCount: number;
  dueSoon: (Billing & { client: { id: string; name: string } })[];
}
