import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { formatPHP } from '@/lib/payroll';
import type { Employee, AttendanceRecord, LeaveRequest, PayrollRun, BillingSummary } from '@/types';

interface DashStats {
  totalEmployees: number;
  activeEmployees: number;
  onLeaveToday: number;
  todayPresent: number;
  todayAbsent: number;
  pendingLeaves: number;
  latestPayroll?: { netPay: number; period: string };
}

export default function Dashboard() {
  const today = new Date().toISOString().slice(0, 10);
  const year = new Date().getFullYear();
  const month = new Date().getMonth() + 1;

  const { data: employees } = useQuery<Employee[]>({
    queryKey: ['employees'],
    queryFn: () => api.get('/employees').then(r => r.data),
  });

  const { data: attendance } = useQuery<AttendanceRecord[]>({
    queryKey: ['attendance', today],
    queryFn: () => api.get(`/attendance?date=${today}`).then(r => r.data),
  });

  const { data: leaveRequests } = useQuery<LeaveRequest[]>({
    queryKey: ['leaves', 'pending'],
    queryFn: () => api.get('/leave?status=PENDING').then(r => r.data),
  });

  const { data: currentPayroll } = useQuery<PayrollRun | null>({
    queryKey: ['payroll', year, month],
    queryFn: () => api.get(`/payroll?year=${year}&month=${month}`).then(r => r.data ?? null),
  });

  const { data: billingSummary } = useQuery<BillingSummary>({
    queryKey: ['billing-summary'],
    queryFn: () => api.get('/billing/summary').then(r => r.data),
  });

  const totalEmp = employees?.length ?? 0;
  const activeEmp = employees?.filter(e => e.status === 'ACTIVE').length ?? 0;
  const presentToday = attendance?.filter(a => a.status === 'PRESENT' || a.status === 'LATE').length ?? 0;
  const onLeave = attendance?.filter(a => a.status === 'ON_LEAVE').length ?? 0;
  const pendingLeaves = leaveRequests?.length ?? 0;
  const latestRun = currentPayroll;

  const recentLeaves = leaveRequests?.slice(0, 5) ?? [];
  const recentAttendance = attendance?.slice(0, 8) ?? [];

  return (
    <div>
      {/* Stat cards */}
      <div className="grid-4" style={{ marginBottom: 24 }}>
        <StatCard
          icon="👥"
          color="#EFF6FF"
          label="Total Employees"
          value={totalEmp}
          sub={`${activeEmp} active`}
        />
        <StatCard
          icon="✅"
          color="#ECFDF5"
          label="Present Today"
          value={presentToday}
          sub={`${activeEmp > 0 ? Math.round(presentToday / activeEmp * 100) : 0}% attendance rate`}
        />
        <StatCard
          icon="🏖️"
          color="#FFFBEB"
          label="On Leave"
          value={onLeave}
          sub={`${pendingLeaves} pending requests`}
        />
        <StatCard
          icon="💰"
          color="#F0FDF4"
          label="Latest Payroll"
          value={latestRun ? formatPHP(latestRun.records.reduce((s, r) => s + r.netPay, 0)) : '—'}
          sub={latestRun ? `${latestRun.period} · ${latestRun.status}` : 'No payroll run yet'}
          small
        />
      </div>

      {/* Billing summary */}
      {billingSummary && (
        <div className="grid-4" style={{ marginBottom: 24 }}>
          <StatCard
            icon="📄"
            color="#FEF2F2"
            label="Outstanding Bills"
            value={formatPHP(billingSummary.pendingAmount)}
            sub={`${billingSummary.pendingCount} unpaid invoice${billingSummary.pendingCount !== 1 ? 's' : ''}`}
            small
          />
          <StatCard
            icon="✅"
            color="#F0FDF4"
            label="Collected (All Time)"
            value={formatPHP(billingSummary.paidAmount)}
            sub={`${billingSummary.paidCount} paid invoice${billingSummary.paidCount !== 1 ? 's' : ''}`}
            small
          />
          {billingSummary.dueSoon.length > 0 && (
            <div className="stat-card" style={{ gridColumn: 'span 2' }}>
              <div className="stat-icon" style={{ background: '#FFFBEB', fontSize: 20 }}>⏰</div>
              <div style={{ flex: 1 }}>
                <div className="stat-label">Due for Billing (Next 7 Days)</div>
                <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {billingSummary.dueSoon.slice(0, 3).map(b => (
                    <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                      <span style={{ fontWeight: 600 }}>{b.client.name}</span>
                      <span style={{ color: 'var(--color-text-muted)' }}>{formatPHP(b.amount)}</span>
                    </div>
                  ))}
                  {billingSummary.dueSoon.length > 3 && (
                    <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>+{billingSummary.dueSoon.length - 3} more</div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Two-column */}
      <div className="grid-2">
        {/* Today's attendance */}
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Today's Attendance</div>
              <div className="card-subtitle">{formatDate(today)}</div>
            </div>
          </div>
          {recentAttendance.length === 0 ? (
            <div className="empty-state" style={{ padding: '32px 0' }}>
              <div className="empty-state-icon">📋</div>
              <div>No attendance records yet today</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {recentAttendance.map(a => (
                <div key={a.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div className="emp-info">
                    <div className="emp-avatar" style={{ background: a.employee.avatarColor }}>
                      {initials(a.employee.firstName, a.employee.lastName)}
                    </div>
                    <div>
                      <div className="emp-name">{a.employee.firstName} {a.employee.lastName}</div>
                      <div className="emp-role">{a.employee.position}</div>
                    </div>
                  </div>
                  <StatusBadge status={a.status} type="attendance" />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pending leave requests */}
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Pending Leave Requests</div>
              <div className="card-subtitle">{pendingLeaves} awaiting action</div>
            </div>
          </div>
          {recentLeaves.length === 0 ? (
            <div className="empty-state" style={{ padding: '32px 0' }}>
              <div className="empty-state-icon">🎉</div>
              <div>No pending leave requests</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {recentLeaves.map(l => (
                <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div className="emp-avatar" style={{ background: l.employee.avatarColor }}>
                    {initials(l.employee.firstName, l.employee.lastName)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="emp-name">{l.employee.firstName} {l.employee.lastName}</div>
                    <div className="emp-role">
                      {l.leaveType.name} · {l.totalDays}d · {formatDate(l.startDate)}
                    </div>
                  </div>
                  <span className="badge badge-yellow">Pending</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Department breakdown */}
      {employees && employees.length > 0 && (
        <div className="card" style={{ marginTop: 24 }}>
          <div className="card-header">
            <div className="card-title">Headcount by Department</div>
          </div>
          <DeptBreakdown employees={employees} />
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, color, label, value, sub, small }: {
  icon: string; color: string; label: string;
  value: string | number; sub: string; small?: boolean;
}) {
  return (
    <div className="stat-card">
      <div className="stat-icon" style={{ background: color }}>
        <span style={{ fontSize: 20 }}>{icon}</span>
      </div>
      <div>
        <div className="stat-label">{label}</div>
        <div className="stat-value" style={{ fontSize: small ? 18 : undefined }}>
          {value}
        </div>
        <div className="stat-delta">{sub}</div>
      </div>
    </div>
  );
}

function DeptBreakdown({ employees }: { employees: Employee[] }) {
  const deptMap = new Map<string, { name: string; count: number }>();
  for (const e of employees) {
    const key = e.departmentId;
    const existing = deptMap.get(key);
    if (existing) existing.count++;
    else deptMap.set(key, { name: e.department.name, count: 1 });
  }
  const depts = [...deptMap.values()].sort((a, b) => b.count - a.count);
  const max = depts[0]?.count ?? 1;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {depts.map(d => (
        <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 120, fontSize: 13, color: 'var(--color-text-secondary)', flexShrink: 0 }}>{d.name}</div>
          <div style={{ flex: 1, background: 'var(--color-surface-2)', borderRadius: 99, height: 8, overflow: 'hidden' }}>
            <div style={{ width: `${(d.count / max) * 100}%`, background: 'var(--color-primary)', height: '100%', borderRadius: 99, transition: 'width 0.5s' }} />
          </div>
          <div style={{ width: 24, textAlign: 'right', fontWeight: 700, fontSize: 13 }}>{d.count}</div>
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ status, type }: { status: string; type: 'attendance' | 'leave' }) {
  if (type === 'attendance') {
    const map: Record<string, string> = {
      PRESENT: 'badge-green', LATE: 'badge-yellow', ABSENT: 'badge-red',
      HALF_DAY: 'badge-yellow', ON_LEAVE: 'badge-blue', HOLIDAY: 'badge-blue', WEEKEND: 'badge-gray',
    };
    const label: Record<string, string> = {
      PRESENT: 'Present', LATE: 'Late', ABSENT: 'Absent',
      HALF_DAY: 'Half Day', ON_LEAVE: 'On Leave', HOLIDAY: 'Holiday', WEEKEND: 'Weekend',
    };
    return <span className={`badge ${map[status] ?? 'badge-gray'}`}>{label[status] ?? status}</span>;
  }
  const map: Record<string, string> = {
    PENDING: 'badge-yellow', APPROVED: 'badge-green', REJECTED: 'badge-red', CANCELLED: 'badge-gray',
  };
  return <span className={`badge ${map[status] ?? 'badge-gray'}`}>{status}</span>;
}

function initials(first: string, last: string) {
  return `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase();
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}