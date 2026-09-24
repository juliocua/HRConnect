// ── Auth ──────────────────────────────────────────────────────────────────────
export type UserRole =
  | 'SUPER_ADMIN'
  | 'HR_MANAGER'
  | 'HR_STAFF'
  | 'EMPLOYEE'
  | 'EMPLOYEE_RELATIONS'
  | 'ACCOUNTS_MANAGEMENT'
  | 'BILLING_COLLECTION'
  | 'ACCOUNTING';

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
  branchId?: string | null;
  branch?: { id: string; name: string } | null;
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
  dailyRate?: number | null;
  useDailyRate?: boolean;
  createdAt: string;
  user?: { id: string; email: string; role?: UserRole; isActive: boolean } | null;
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
  employee: Pick<Employee, 'id' | 'firstName' | 'lastName' | 'position' | 'avatarColor'> & {
    client?: { id: string; name: string } | null;
  };
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
  employee: Pick<Employee, 'id' | 'employeeNo' | 'firstName' | 'lastName' | 'position' | 'avatarColor' | 'useDailyRate' | 'dailyRate'> & {
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
  otherDeductionsNote?: string | null;
  netPay: number;
  daysWorked: number;
  overtimePay: number;
  allowances: number;
  lateDeduction: number;
  holidayPay: number;
  nightDifferential: number;
  nightDiffHours?: number;
  silPay?: number;
  priorPeriodDeduction?: number;
  absenceCarryForward?: number;
  expenseReimbursement?: number;
}

// ── Global Setup ──────────────────────────────────────────────────────────────
export interface CutOffPeriod {
  id: string;
  name: string;
  cutOffFromDay: number;
  cutOffFromIsPrevMonth: boolean;
  cutOffToDay: number;
  payDay: number;
  payDayIsNextMonth: boolean;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type GlobalPolicyType = 'SSS_DEDUCTION' | 'PHIC_DEDUCTION' | 'HDMF_DEDUCTION' | 'TAX_DEDUCTION';

export interface GlobalPayrollPolicy {
  id: string;
  type: GlobalPolicyType;
  cutOffPeriodId: string | null;
  cutOffPeriod: CutOffPeriod | null;
  createdAt: string;
  updatedAt: string;
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
  soaNo?: string | null;
  records: PayrollRecord[];          // present on single-run detail fetch
  totalNetPay?: number;              // present on history list fetch
  _count?: { records: number };      // present on history list fetch
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

// ── Employee Assignments ──────────────────────────────────────────────────────
export type AssignmentType = 'DEPLOYED' | 'RTA' | 'TRANSFERRED';

export interface EmployeeAssignment {
  id: string;
  employeeId: string;
  clientId?: string | null;
  client?: { id: string; name: string } | null;
  type: AssignmentType;
  startDate: string;
  endDate?: string | null;
  notes?: string | null;
  createdAt: string;
}

// ── Clients & Billing ─────────────────────────────────────────────────────────
export type BillingCycle = 'WEEKLY' | 'EVERY_15TH' | 'EVERY_30TH' | 'MONTHLY';
export type BillingStatus = 'PENDING' | 'PAID' | 'CANCELLED';

export interface ClientBranch {
  id: string;
  clientId: string;
  name: string;
  address?: string | null;
  createdAt: string;
  updatedAt: string;
}

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
  clientSignatoryName?: string | null;
  clientSignatoryTitle?: string | null;
  createdAt: string;
  policies?: ClientPolicy[];
  branches?: ClientBranch[];
  billings?: Billing[];
  employees?: (Pick<Employee, 'id' | 'firstName' | 'lastName' | 'position' | 'avatarColor' | 'status' | 'resourceCost' | 'payrollCost'> & { branchId?: string | null; branch?: { id: string; name: string } | null })[];
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
  paymentScreenshotUrl?: string;
  soaNo?: string;
  grossBill?: number;
  vatAmount?: number;
  ewtAmount?: number;
  totalNetBill?: number;
  amountPaid?: number;
  serviceInvoiceNo?: string;
  paymentLinkId?: string;
  paymentLinkUrl?: string;
  notes?: string;
  lineItems?: Array<{ label: string; amount: number }> | null;
  createdAt: string;
}

// ── Company Settings ──────────────────────────────────────────────────────────
export type AdminFeeType = 'PERCENT_GROSS' | 'FLAT_PER_EMPLOYEE' | 'TIERED' | 'FIXED_LUMP';

export interface CompanySettings {
  id: string;
  companyName: string;
  address?: string | null;
  taxNumber?: string | null;
  contactNumber?: string | null;
  logoUrl?: string | null;
  defaultShiftStart?: string | null;
  defaultShiftEnd?: string | null;
  // Admin fee (global)
  adminFeeType?: AdminFeeType | null;
  adminFeeValue?: number | null;
  adminFeeTiers?: unknown | null;
  // SOA signatories (company side)
  signatoryName?: string | null;
  signatoryTitle?: string | null;
  // Pay computation rates
  overtimeRate?: number | null;
  nightDifferentialRate?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface BillingSummary {
  pendingAmount: number;
  pendingCount: number;
  paidAmount: number;
  paidCount: number;
  dueSoon: (Billing & { client: { id: string; name: string } })[];
}

// ── Holidays ──────────────────────────────────────────────────────────────────
export type HolidayType = 'REGULAR' | 'SPECIAL_NON_WORKING' | 'SPECIAL_WORKING';

export interface Holiday {
  id: string;
  date: string;
  name: string;
  type: HolidayType;
  year: number;
  createdAt: string;
  updatedAt: string;
}

// ── Billing Attendance Summary ────────────────────────────────────────────────
export interface BillingAttendanceSummaryEmployee {
  employee: Pick<Employee, 'id' | 'firstName' | 'lastName' | 'position' | 'basicSalary' | 'dailyRate' | 'useDailyRate'> & {
    branch?: { id: string; name: string } | null;
  };
  daysWorked: number;
  lateMinutes: number;
  otHours: number;
  ndHours: number;
  totalHours: number;
}

export interface BillingAttendanceSummary {
  periodStart: string;
  periodEnd: string;
  employees: BillingAttendanceSummaryEmployee[];
}

// ── Expenses ──────────────────────────────────────────────────────────────────
export type ExpenseStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface ExpenseCategory {
  id: string;
  name: string;
  isActive: boolean;
}

export interface ExpenseRequest {
  id: string;
  categoryId: string | null;
  category: ExpenseCategory | null;
  description: string;
  amount: number;
  receiptUrl: string | null;
  status: ExpenseStatus;
  rejectionNote: string | null;
  approvedAt: string | null;
  approvedBy: { firstName: string; lastName: string } | null;
  payrollRecord: { id: string; payrollRun: { periodStart: string; periodEnd: string } } | null;
  createdAt: string;
  employee?: { id: string; firstName: string; lastName: string; client: { id: string; name: string } | null };
}
