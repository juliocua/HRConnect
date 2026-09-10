import { useState, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import api from '@/lib/api';
import { DataTable } from '@/components/DataTable';
import { ClientCombobox } from '@/components/ClientCombobox';
import type { Employee, Department, EmployeeFormData, EmployeeStatus, Client, ProfileChangeRequest } from '@/types';

// Resolve photo URL — strips stored origin and uses VITE_API_URL so photos work even if
// SERVER_URL was misconfigured (e.g. fell back to localhost) at upload time.
const API_ORIGIN = (import.meta.env.VITE_API_URL ?? '').replace(/\/api$/, '');
function resolvePhotoUrl(url: string): string {
  try { return `${API_ORIGIN}${new URL(url).pathname}`; } catch { return url; }
}

const STATUS_COLORS: Record<EmployeeStatus, string> = {
  ACTIVE: 'badge-green',
  ON_LEAVE: 'badge-yellow',
  INACTIVE: 'badge-gray',
  TERMINATED: 'badge-red',
};

const STATUS_LABELS: Record<EmployeeStatus, string> = {
  ACTIVE: 'Active',
  ON_LEAVE: 'On Leave',
  INACTIVE: 'Inactive',
  TERMINATED: 'Terminated',
};

const AVATAR_COLORS = [
  '#2563EB','#7C3AED','#DB2777','#EA580C','#CA8A04','#16A34A','#0891B2','#DC2626',
];

export default function Employees() {
  const qc = useQueryClient();
  const [clientFilter, setClientFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState<Employee | null>(null);
  const [viewTarget, setViewTarget] = useState<Employee | null>(null);

  const { data: employees = [], isLoading } = useQuery<Employee[]>({
    queryKey: ['employees', clientFilter, statusFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (clientFilter) params.set('clientId', clientFilter);
      if (statusFilter) params.set('status', statusFilter);
      return api.get(`/employees?${params}`).then(r => r.data);
    },
  });

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ['clients'],
    queryFn: () => api.get('/clients').then(r => r.data),
  });

  const { data: departments = [] } = useQuery<Department[]>({
    queryKey: ['departments'],
    queryFn: () => api.get('/employees/departments/list').then(r => r.data),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/employees/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['employees'] }),
  });

  const openAdd = () => { setEditTarget(null); setShowModal(true); };
  const openEdit = (e: Employee) => { setEditTarget(e); setShowModal(true); };

  const handleDelete = (e: Employee) => {
    if (confirm(`Terminate ${e.firstName} ${e.lastName}? This will mark them as TERMINATED.`)) {
      deleteMutation.mutate(e.id);
    }
  };

  const columns = useMemo<ColumnDef<Employee>[]>(() => [
    {
      id: 'employee',
      accessorFn: row => `${row.firstName} ${row.lastName} ${row.email}`,
      header: 'Employee',
      cell: ({ row: { original: e } }) => (
        <div className="emp-info">
          <div className="emp-avatar" style={{ background: e.avatarColor, overflow: 'hidden', padding: 0 }}>
            {e.photoUrl
              ? <img src={resolvePhotoUrl(e.photoUrl)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }} />
              : <>{e.firstName[0]}{e.lastName[0]}</>
            }
          </div>
          <div>
            <div className="emp-name">{e.firstName} {e.lastName}</div>
            <div className="emp-role">{e.email}</div>
          </div>
        </div>
      ),
    },
    {
      accessorKey: 'employeeNo',
      header: 'Emp. No',
      cell: ({ getValue }) => <span className="td-mono">{getValue() as string}</span>,
    },
    {
      id: 'department',
      accessorFn: row => row.department.name,
      header: 'Department',
    },
    {
      accessorKey: 'position',
      header: 'Position',
    },
    {
      id: 'client',
      accessorFn: row => row.client?.name ?? '',
      header: 'Deployed To',
      cell: ({ getValue }) => {
        const name = getValue() as string;
        return name
          ? <span style={{ fontSize: 13, fontWeight: 600 }}>{name}</span>
          : <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>—</span>;
      },
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ getValue }) => {
        const s = getValue() as EmployeeStatus;
        return <span className={`badge ${STATUS_COLORS[s]}`}>{STATUS_LABELS[s]}</span>;
      },
    },
    {
      accessorKey: 'hireDate',
      header: 'Hire Date',
      cell: ({ getValue }) => <span className="text-muted text-sm">{formatDate(getValue() as string)}</span>,
    },
    {
      id: 'actions',
      header: '',
      enableSorting: false,
      cell: ({ row: { original: e } }) => (
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn btn-secondary btn-sm" onClick={ev => { ev.stopPropagation(); openEdit(e); }}>Edit</button>
          {e.status !== 'TERMINATED' && (
            <button className="btn btn-ghost btn-sm" style={{ color: 'var(--color-danger)' }} onClick={ev => { ev.stopPropagation(); handleDelete(e); }}>
              Terminate
            </button>
          )}
        </div>
      ),
    },
  ], [deleteMutation]);

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Employees</h1>
          <p className="page-desc">{employees.length} team member{employees.length !== 1 ? 's' : ''}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <a href="/import?type=employee" className="btn btn-ghost">⬆ Import CSV</a>
          <button className="btn btn-primary" onClick={openAdd}>
            <span>＋</span> Add Employee
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="filter-bar">
          <ClientCombobox
            clients={clients}
            value={clientFilter}
            onChange={setClientFilter}
            style={{ width: 220 }}
          />
          <select className="form-control" style={{ width: 150 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All Statuses</option>
            {(Object.keys(STATUS_LABELS) as EmployeeStatus[]).map(s => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Change Requests */}
      <ChangeRequestsPanel />

      {/* Table */}
      {isLoading ? (
        <div className="loading-center"><div className="spinner" /></div>
      ) : employees.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">👥</div>
          <div className="empty-state-title">No employees found</div>
          <div>Try adjusting your filters or add a new employee</div>
        </div>
      ) : (
        <div className="card">
          <DataTable
            data={employees}
            columns={columns}
            globalFilterPlaceholder="Search employees…"
            exportFilename="Employees"
            onRowClick={e => setViewTarget(e)}
          />
        </div>
      )}

      {showModal && (
        <EmployeeModal
          departments={departments}
          employees={employees}
          initial={editTarget}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); qc.invalidateQueries({ queryKey: ['employees'] }); }}
        />
      )}

      {viewTarget && (
        <EmployeeDetailModal
          employee={viewTarget}
          onClose={() => setViewTarget(null)}
          onEdit={() => { setViewTarget(null); openEdit(viewTarget); }}
        />
      )}
    </div>
  );
}

// ── Tab Bar ────────────────────────────────────────────────────────────────
function TabBar({ tabs, active, onChange }: {
  tabs: string[];
  active: string;
  onChange: (t: string) => void;
}) {
  return (
    <div style={{
      display: 'flex',
      gap: 0,
      borderBottom: '2px solid var(--color-border)',
      marginBottom: 20,
      overflowX: 'auto',
    }}>
      {tabs.map(t => (
        <button
          key={t}
          type="button"
          onClick={() => onChange(t)}
          style={{
            background: 'none',
            border: 'none',
            borderBottom: active === t ? '2px solid var(--color-primary)' : '2px solid transparent',
            marginBottom: -2,
            padding: '8px 14px',
            fontSize: 13,
            fontWeight: active === t ? 700 : 500,
            color: active === t ? 'var(--color-primary)' : 'var(--color-text-secondary)',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

// ── Employee Modal (Add / Edit) ─────────────────────────────────────────────
function EmployeeModal({
  departments, employees, initial, onClose, onSaved,
}: {
  departments: Department[];
  employees: Employee[];
  initial: Employee | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ['clients'],
    queryFn: () => api.get('/clients').then(r => r.data),
  });
  const isEdit = !!initial;
  const [activeTab, setActiveTab] = useState('Basic Info');

  const [form, setForm] = useState<EmployeeFormData>(initial
    ? {
        employeeNo: initial.employeeNo,
        firstName: initial.firstName,
        lastName: initial.lastName,
        email: initial.email,
        phone: initial.phone ?? '',
        position: initial.position,
        departmentId: initial.departmentId,
        managerId: initial.managerId ?? '',
        status: initial.status,
        hireDate: initial.hireDate.slice(0, 10),
        basicSalary: initial.basicSalary,
        resourceCost: initial.resourceCost ?? null,
        payrollCost: initial.payrollCost ?? null,
        clientId: initial.clientId ?? null,
        sssNo: initial.sssNo ?? '',
        philhealthNo: initial.philhealthNo ?? '',
        pagibigNo: initial.pagibigNo ?? '',
        tinNo: initial.tinNo ?? '',
        bankName: initial.bankName ?? '',
        bankAccountNo: initial.bankAccountNo ?? '',
        bankAccountName: initial.bankAccountName ?? '',
        avatarColor: initial.avatarColor,
        gender: initial.gender ?? null,
        address: initial.address ?? '',
        emergencyContactName: initial.emergencyContactName ?? '',
        emergencyContactPhone: initial.emergencyContactPhone ?? '',
      }
    : {
        firstName: '', lastName: '', email: '', phone: '', position: '',
        departmentId: departments[0]?.id ?? '',
        managerId: '', status: 'ACTIVE', hireDate: new Date().toISOString().slice(0, 10),
        basicSalary: 25000, resourceCost: null, payrollCost: null, clientId: null,
        sssNo: '', philhealthNo: '', pagibigNo: '', tinNo: '',
        bankName: '', bankAccountNo: '', bankAccountName: '',
        avatarColor: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
        gender: null,
        address: '',
        emergencyContactName: '',
        emergencyContactPhone: '',
      });

  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [tempPassword, setTempPassword] = useState('');

  // Login account management (edit mode only)
  const [accountInfo, setAccountInfo] = useState<{ email: string; tempPassword: string } | null>(null);
  const [accountAction, setAccountAction] = useState<'idle' | 'loading' | 'done'>('idle');
  const [accountError, setAccountError] = useState('');

  const handleCreateAccount = async () => {
    setAccountAction('loading'); setAccountError('');
    try {
      const res = await api.post(`/employees/${initial!.id}/create-account`);
      setAccountInfo(res.data);
      setAccountAction('done');
    } catch (err: unknown) {
      setAccountError((err as any)?.response?.data?.error ?? 'Failed to create account');
      setAccountAction('idle');
    }
  };

  const handleResetPassword = async () => {
    if (!confirm('Reset this employee\'s password? They will need to use the new temp password to log in.')) return;
    setAccountAction('loading'); setAccountError('');
    try {
      const res = await api.post(`/employees/${initial!.id}/reset-password`);
      setAccountInfo(res.data);
      setAccountAction('done');
    } catch (err: unknown) {
      setAccountError((err as any)?.response?.data?.error ?? 'Failed to reset password');
      setAccountAction('idle');
    }
  };

  const set = (k: keyof EmployeeFormData, v: unknown) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (isEdit) {
        await api.put(`/employees/${initial!.id}`, form);
        onSaved();
      } else {
        const res = await api.post('/employees', form);
        if (res.data._tempPassword) {
          setTempPassword(res.data._tempPassword);
        } else {
          onSaved();
        }
      }
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setError((err as any)?.response?.data?.error ?? 'Failed to save employee');
    } finally {
      setSaving(false);
    }
  };

  const managers = employees.filter(e => e.id !== initial?.id && e.status === 'ACTIVE');

  const EDIT_TABS = isEdit
    ? ['Basic Info', 'Deployment', 'IDs & Bank', 'Emergency Contact', 'Account']
    : ['Basic Info', 'Deployment', 'IDs & Bank', 'Emergency Contact'];

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-lg" style={{ display: 'flex', flexDirection: 'column', height: 'min(90vh, 860px)' }}>
        <div className="modal-header" style={{ flexShrink: 0 }}>
          <h2 className="modal-title">{isEdit ? 'Edit Employee' : 'Add Employee'}</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        {tempPassword ? (
          <>
            <div className="modal-body" style={{ flex: 1, overflowY: 'auto', gap: 16 }}>
              <div style={{ textAlign: 'center', padding: '8px 0' }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
                <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>Employee Added!</div>
                <p style={{ color: 'var(--color-text-secondary)', fontSize: 13.5, marginBottom: 16 }}>
                  A login account has been automatically created. Share the temporary password with the employee — they can log in and change it.
                </p>
                <div style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', borderRadius: 10, padding: '14px 20px', marginBottom: 8 }}>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 4 }}>Email</div>
                  <div style={{ fontWeight: 600, marginBottom: 12 }}>{form.email}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 4 }}>Temporary Password</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 800, color: 'var(--color-primary)', letterSpacing: '0.05em' }}>{tempPassword}</div>
                </div>
                <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>⚠️ This password is only shown once. Save it now.</p>
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-primary" onClick={onSaved}>Done</button>
            </div>
          </>
        ) : (
        <form onSubmit={handleSubmit} style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Pinned profile header — same layout as view modal, never scrolls */}
          <div style={{ padding: '20px 24px 16px', flexShrink: 0, borderBottom: '1px solid var(--color-border)' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 24 }}>
              <div style={{ flexShrink: 0 }}>
                <div style={{
                  width: 240, height: 300, borderRadius: 12,
                  background: isEdit ? initial!.avatarColor : form.avatarColor,
                  overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 64, fontWeight: 800, color: '#fff',
                }}>
                  {isEdit && initial!.photoUrl
                    ? <img src={resolvePhotoUrl(initial!.photoUrl)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }} />
                    : <>
                        {(isEdit ? initial!.firstName : form.firstName)[0] ?? '?'}
                        {(isEdit ? initial!.lastName : form.lastName)[0] ?? '?'}
                      </>
                  }
                </div>
              </div>
              <div style={{ flex: 1, paddingTop: 4 }}>
                <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.2 }}>
                  {isEdit
                    ? `${initial!.firstName} ${initial!.lastName}`
                    : (form.firstName || form.lastName ? `${form.firstName} ${form.lastName}`.trim() : 'New Employee')}
                </div>
                <div style={{ color: 'var(--color-text-secondary)', marginTop: 4, fontSize: 14 }}>
                  {isEdit ? initial!.position : (form.position || 'New Position')}
                </div>
                {isEdit && (
                  <>
                    <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>{initial!.department.name}</div>
                    <span className={`badge ${STATUS_COLORS[form.status]}`} style={{ marginTop: 10, display: 'inline-block' }}>{STATUS_LABELS[form.status]}</span>
                  </>
                )}
              </div>
            </div>
          </div>
          {/* Pinned tab bar — never scrolls */}
          <div style={{ padding: '0 24px', flexShrink: 0 }}>
            <TabBar tabs={EDIT_TABS} active={activeTab} onChange={setActiveTab} />
          </div>
          {/* Scrollable tab content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '0 24px 16px' }}>
            {error && <div className="error-msg" style={{ marginTop: 16 }}>{error}</div>}

            {/* ── Tab: Basic Info ── */}
            {activeTab === 'Basic Info' && (
              <>
                <div className="form-grid form-grid-2">
                  <div className="form-group">
                    <label>First Name *</label>
                    <input className="form-control" required value={form.firstName} onChange={e => set('firstName', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>Last Name *</label>
                    <input className="form-control" required value={form.lastName} onChange={e => set('lastName', e.target.value)} />
                  </div>
                </div>

                <div className="form-grid form-grid-3">
                  <div className="form-group">
                    <label>Email *</label>
                    <input type="email" className="form-control" required value={form.email} onChange={e => set('email', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>Phone</label>
                    <input className="form-control" placeholder="+63 9XX XXX XXXX" value={form.phone ?? ''} onChange={e => set('phone', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>Gender</label>
                    <select className="form-control" value={form.gender ?? ''} onChange={e => set('gender', (e.target.value || null) as any)}>
                      <option value="">— Prefer not to say —</option>
                      <option value="MALE">Male</option>
                      <option value="FEMALE">Female</option>
                      <option value="OTHER">Other</option>
                    </select>
                  </div>
                </div>

                <div className="form-grid form-grid-2">
                  <div className="form-group">
                    <label>Position *</label>
                    <input className="form-control" required value={form.position} onChange={e => set('position', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>Department *</label>
                    <select className="form-control" required value={form.departmentId} onChange={e => set('departmentId', e.target.value)}>
                      {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </div>
                </div>

                <div className="form-grid form-grid-3">
                  <div className="form-group">
                    <label>Direct Manager</label>
                    <select className="form-control" value={form.managerId ?? ''} onChange={e => set('managerId', e.target.value || undefined)}>
                      <option value="">— None —</option>
                      {managers.map(m => (
                        <option key={m.id} value={m.id}>{m.firstName} {m.lastName}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Status</label>
                    <select className="form-control" value={form.status} onChange={e => set('status', e.target.value)}>
                      <option value="ACTIVE">Active</option>
                      <option value="ON_LEAVE">On Leave</option>
                      <option value="INACTIVE">Inactive</option>
                      <option value="TERMINATED">Terminated</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Hire Date *</label>
                    <input type="date" className="form-control" required value={form.hireDate} onChange={e => set('hireDate', e.target.value)} />
                  </div>
                </div>

                <div className="form-grid form-grid-2">
                  <div className="form-group">
                    <label>Basic Salary (₱) *</label>
                    <input type="number" className="form-control" required min={0} value={form.basicSalary} onChange={e => set('basicSalary', Number(e.target.value))} />
                  </div>
                  <div className="form-group">
                    <label>Employee No.</label>
                    <input className="form-control" placeholder="Auto-generated" value={form.employeeNo ?? ''} onChange={e => set('employeeNo', e.target.value)} />
                  </div>
                </div>

                <div className="form-group">
                  <label>Avatar Color</label>
                  <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                    {AVATAR_COLORS.map(c => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => set('avatarColor', c)}
                        style={{
                          width: 28, height: 28, borderRadius: '50%', background: c, border: 'none', cursor: 'pointer',
                          outline: form.avatarColor === c ? `3px solid var(--color-primary)` : '3px solid transparent',
                          outlineOffset: 2,
                        }}
                      />
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* ── Tab: Deployment ── */}
            {activeTab === 'Deployment' && (
              <>
                <div className="form-group">
                  <label>Deployed To (Client)</label>
                  <select
                    className="form-control"
                    value={form.clientId ?? ''}
                    onChange={e => set('clientId', e.target.value || null)}
                  >
                    <option value="">— Not deployed / On bench —</option>
                    {clients.filter(c => c.activeContract).map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div className="form-grid form-grid-2">
                  <div className="form-group">
                    <label>Resource Cost (₱ billed to client)</label>
                    <input
                      type="number"
                      className="form-control"
                      min={0}
                      placeholder="e.g. 60000"
                      value={form.resourceCost ?? ''}
                      onChange={e => set('resourceCost', e.target.value ? Number(e.target.value) : null)}
                    />
                  </div>
                  <div className="form-group">
                    <label>Payroll Cost (₱ paid to employee)</label>
                    <input
                      type="number"
                      className="form-control"
                      min={0}
                      placeholder="e.g. 45000"
                      value={form.payrollCost ?? ''}
                      onChange={e => set('payrollCost', e.target.value ? Number(e.target.value) : null)}
                    />
                  </div>
                </div>
              </>
            )}

            {/* ── Tab: IDs & Bank ── */}
            {activeTab === 'IDs & Bank' && (
              <>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
                  Government IDs
                </div>
                <div className="form-grid form-grid-2">
                  <div className="form-group">
                    <label>SSS No.</label>
                    <input className="form-control font-mono" placeholder="XX-XXXXXXX-X" value={form.sssNo ?? ''} onChange={e => set('sssNo', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>PhilHealth No.</label>
                    <input className="form-control font-mono" placeholder="XXXXXXXXXXXX" value={form.philhealthNo ?? ''} onChange={e => set('philhealthNo', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>Pag-IBIG No.</label>
                    <input className="form-control font-mono" placeholder="XXXXXXXXXXXX" value={form.pagibigNo ?? ''} onChange={e => set('pagibigNo', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>TIN No.</label>
                    <input className="form-control font-mono" placeholder="XXX-XXX-XXX-XXX" value={form.tinNo ?? ''} onChange={e => set('tinNo', e.target.value)} />
                  </div>
                </div>

                <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '16px 0 12px' }}>
                  Bank Details
                </div>
                <div className="form-grid form-grid-2">
                  <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                    <label>Bank Name</label>
                    <input className="form-control" placeholder="e.g. BDO, BPI, UnionBank" value={form.bankName ?? ''} onChange={e => set('bankName', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>Account Number</label>
                    <input className="form-control font-mono" placeholder="XXXXXXXXXXXX" value={form.bankAccountNo ?? ''} onChange={e => set('bankAccountNo', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>Account Name</label>
                    <input className="form-control" placeholder="Name as registered in bank" value={form.bankAccountName ?? ''} onChange={e => set('bankAccountName', e.target.value)} />
                  </div>
                </div>
              </>
            )}

            {/* ── Tab: Emergency Contact ── */}
            {activeTab === 'Emergency Contact' && (
              <>
                <div className="form-group">
                  <label>Home Address</label>
                  <textarea
                    className="form-control"
                    rows={3}
                    placeholder="Full home address"
                    value={form.address ?? ''}
                    onChange={e => set('address', e.target.value)}
                    style={{ resize: 'vertical' }}
                  />
                </div>
                <div className="form-grid form-grid-2">
                  <div className="form-group">
                    <label>Emergency Contact Name</label>
                    <input
                      className="form-control"
                      placeholder="Full name"
                      value={form.emergencyContactName ?? ''}
                      onChange={e => set('emergencyContactName', e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label>Emergency Contact Phone</label>
                    <input
                      className="form-control"
                      placeholder="+63 9XX XXX XXXX"
                      value={form.emergencyContactPhone ?? ''}
                      onChange={e => set('emergencyContactPhone', e.target.value)}
                    />
                  </div>
                </div>
              </>
            )}

            {/* ── Tab: Account (edit only) ── */}
            {activeTab === 'Account' && isEdit && (
              <>
                {accountAction === 'done' && accountInfo ? (
                  <div style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', borderRadius: 10, padding: '12px 16px' }}>
                    <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 2 }}>New temporary password set</div>
                    <div style={{ fontSize: 13, marginBottom: 6 }}>Email: <strong>{accountInfo.email}</strong></div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 800, color: 'var(--color-primary)', letterSpacing: '0.05em' }}>{accountInfo.tempPassword}</div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 6 }}>⚠️ Share this with the employee now — it won't be shown again.</div>
                  </div>
                ) : initial?.user ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '10px 14px' }}>
                    <div>
                      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 1 }}>Login email</div>
                      <div style={{ fontSize: 13.5, fontWeight: 600 }}>{initial.user.email}</div>
                      <div style={{ fontSize: 11.5, color: initial.user.isActive ? 'var(--color-success)' : 'var(--color-danger)', marginTop: 2 }}>
                        {initial.user.isActive ? '● Active' : '● Inactive'}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={accountAction === 'loading'}
                      onClick={handleResetPassword}
                    >
                      {accountAction === 'loading' ? 'Resetting…' : '🔑 Reset Password'}
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--color-surface-2)', border: '1px dashed var(--color-border)', borderRadius: 8, padding: '10px 14px' }}>
                    <div>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--color-text-muted)' }}>No login account</div>
                      <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>This employee can't log in yet</div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={accountAction === 'loading'}
                      onClick={handleCreateAccount}
                    >
                      {accountAction === 'loading' ? 'Creating…' : '＋ Create Account'}
                    </button>
                  </div>
                )}
                {accountError && <div className="error-msg" style={{ marginTop: 8 }}>{accountError}</div>}
              </>
            )}
          </div>
          <div className="modal-footer" style={{ flexShrink: 0 }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Employee'}
            </button>
          </div>
        </form>
        )}
      </div>
    </div>
  );
}

// ── Change Requests Panel ──────────────────────────────────────────────────
const CR_FIELD_LABELS: Record<string, string> = {
  phone: 'Phone',
  address: 'Home Address',
  emergencyContactName: 'Emergency Contact Name',
  emergencyContactPhone: 'Emergency Contact Phone',
};

function ChangeRequestsPanel() {
  const qc = useQueryClient();
  const [collapsed, setCollapsed] = useState(false);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState('');

  const { data: requests = [], isLoading } = useQuery<ProfileChangeRequest[]>({
    queryKey: ['change-requests'],
    queryFn: () => api.get('/employees/change-requests').then(r => r.data),
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.put(`/employees/change-requests/${id}/approve`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['change-requests'] }),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) =>
      api.put(`/employees/change-requests/${id}/reject`, { rejectionNote: note }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['change-requests'] });
      setRejectId(null);
      setRejectNote('');
    },
  });

  const fmtDate = (d: string) =>
    new Date(d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  if (isLoading || requests.length === 0) return null;

  return (
    <div className="card" style={{ marginBottom: 20, borderLeft: '3px solid var(--color-warning, #CA8A04)' }}>
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setCollapsed(c => !c)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 16 }}>📋</span>
          <span style={{ fontWeight: 700, fontSize: 14 }}>Pending Change Requests</span>
          <span className="badge badge-yellow" style={{ fontSize: 11 }}>{requests.length}</span>
        </div>
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{collapsed ? '▼ Show' : '▲ Hide'}</span>
      </div>

      {!collapsed && (
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {requests.map(req => {
            const emp = req.employee;
            return (
              <div key={req.id} style={{
                background: 'var(--color-surface-raised, var(--color-background))',
                border: '1px solid var(--color-border)',
                borderRadius: 10, padding: '14px 16px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {emp && (
                      <div className="emp-avatar" style={{ width: 32, height: 32, fontSize: 12, background: emp.avatarColor, flexShrink: 0 }}>
                        {emp.firstName[0]}{emp.lastName[0]}
                      </div>
                    )}
                    <div>
                      {emp && <div style={{ fontWeight: 700, fontSize: 13.5 }}>{emp.firstName} {emp.lastName}</div>}
                      <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Submitted {fmtDate(req.submittedAt)}</div>
                    </div>
                  </div>

                  {rejectId !== req.id && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        className="btn btn-primary btn-sm"
                        disabled={approveMutation.isPending}
                        onClick={() => approveMutation.mutate(req.id)}
                      >
                        ✓ Approve
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ color: 'var(--color-danger)' }}
                        onClick={() => { setRejectId(req.id); setRejectNote(''); }}
                      >
                        ✕ Reject
                      </button>
                    </div>
                  )}
                </div>

                {/* Changes */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {Object.entries(req.changes).map(([k, v]) => (
                    <div key={k} style={{
                      background: 'var(--color-warning-light, #FFFBEB)',
                      border: '1px solid var(--color-warning, #CA8A04)',
                      borderRadius: 6, padding: '4px 10px', fontSize: 12,
                    }}>
                      <span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>{CR_FIELD_LABELS[k] ?? k}:</span>{' '}
                      <span style={{ fontWeight: 700 }}>{v as string}</span>
                    </div>
                  ))}
                </div>

                {/* Inline reject form */}
                {rejectId === req.id && (
                  <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Rejection Note (optional)</label>
                      <input
                        className="form-control"
                        style={{ fontSize: 13 }}
                        placeholder="Reason for rejection…"
                        value={rejectNote}
                        onChange={e => setRejectNote(e.target.value)}
                      />
                    </div>
                    <button
                      className="btn btn-danger btn-sm"
                      disabled={rejectMutation.isPending}
                      onClick={() => rejectMutation.mutate({ id: req.id, note: rejectNote })}
                    >
                      {rejectMutation.isPending ? 'Rejecting…' : 'Confirm Reject'}
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => setRejectId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Employee Detail Modal ──────────────────────────────────────────────────
function EmployeeDetailModal({ employee: e, onClose, onEdit }: {
  employee: Employee; onClose: () => void; onEdit: () => void;
}) {
  const qc = useQueryClient();
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [activeTab, setActiveTab] = useState('Profile');

  const VIEW_TABS = ['Profile', 'Emergency Contact', 'IDs & Bank', 'Organization'];

  const handlePhotoUpload = async (file: File) => {
    setPhotoError('');
    setPhotoUploading(true);
    try {
      const formData = new FormData();
      formData.append('photo', file);
      await api.post(`/employees/${e.id}/photo`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      qc.invalidateQueries({ queryKey: ['employees'] });
    } catch (err: any) {
      setPhotoError(err?.response?.data?.error ?? 'Upload failed');
    } finally {
      setPhotoUploading(false);
    }
  };

  const handleRemovePhoto = async () => {
    if (!confirm('Remove this employee\'s photo?')) return;
    setPhotoUploading(true);
    try {
      await api.delete(`/employees/${e.id}/photo`);
      qc.invalidateQueries({ queryKey: ['employees'] });
    } finally {
      setPhotoUploading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={ev => ev.target === ev.currentTarget && onClose()}>
      <div className="modal modal-lg" style={{ display: 'flex', flexDirection: 'column', height: 'min(90vh, 860px)' }}>
        <div className="modal-header" style={{ flexShrink: 0 }}>
          <h2 className="modal-title">Employee Profile</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary btn-sm" onClick={onEdit}>Edit</button>
            <button className="icon-btn" onClick={onClose}>✕</button>
          </div>
        </div>
        {/* Pinned profile header — never scrolls */}
        <div style={{ padding: '20px 24px 16px', flexShrink: 0, borderBottom: '1px solid var(--color-border)' }}>
          {/* Profile header — large photo + name, always visible across all tabs */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 24 }}>
            {/* Large portrait photo */}
            <div style={{ flexShrink: 0 }}>
              <div style={{
                width: 240, height: 300, borderRadius: 12,
                background: e.avatarColor, overflow: 'hidden',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 64, fontWeight: 800, color: '#fff',
              }}>
                {e.photoUrl
                  ? <img src={resolvePhotoUrl(e.photoUrl)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }} />
                  : <>{e.firstName[0]}{e.lastName[0]}</>
                }
              </div>
              {/* Photo controls */}
              <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={ev => ev.target.files?.[0] && handlePhotoUpload(ev.target.files[0])}
                />
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ fontSize: 11, padding: '3px 8px', flex: 1 }}
                  disabled={photoUploading}
                  onClick={() => photoInputRef.current?.click()}
                >
                  {photoUploading ? '…' : e.photoUrl ? '📷 Change Photo' : '📷 Add Photo'}
                </button>
                {e.photoUrl && !photoUploading && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ fontSize: 11, padding: '3px 8px', color: 'var(--color-danger)' }}
                    onClick={handleRemovePhoto}
                  >✕</button>
                )}
              </div>
              {photoError && <div style={{ fontSize: 11, color: 'var(--color-danger)', marginTop: 4 }}>{photoError}</div>}
            </div>

            {/* Name / meta column */}
            <div style={{ flex: 1, paddingTop: 4 }}>
              <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.2 }}>{e.firstName} {e.lastName}</div>
              <div style={{ color: 'var(--color-text-secondary)', marginTop: 4, fontSize: 14 }}>{e.position}</div>
              <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>{e.department.name}</div>
              <span className={`badge ${STATUS_COLORS[e.status]}`} style={{ marginTop: 10, display: 'inline-block' }}>{STATUS_LABELS[e.status]}</span>
              {e.client && (
                <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--color-text-muted)' }}>
                  Deployed to <strong style={{ color: 'var(--color-text)' }}>{e.client.name}</strong>
                </div>
              )}
              <div style={{ marginTop: 14 }}>
                <InfoRow label="Emp. No." value={e.employeeNo} mono />
                <InfoRow label="Hire Date" value={formatDate(e.hireDate)} />
                <InfoRow label="Basic Salary" value={`₱${e.basicSalary.toLocaleString('en-PH')}`} />
              </div>
            </div>
          </div>
        </div>
        {/* Pinned tab bar — never scrolls */}
        <div style={{ padding: '0 24px', flexShrink: 0 }}>
          <TabBar tabs={VIEW_TABS} active={activeTab} onChange={setActiveTab} />
        </div>
        {/* Scrollable tab content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px 24px' }}>
          {/* ── Profile tab ── */}
          {activeTab === 'Profile' && (
            <>
              <InfoRow label="Email" value={e.email} />
              <InfoRow label="Phone" value={e.phone ?? '—'} />
              <InfoRow label="Home Address" value={e.address ?? '—'} />
              {e.gender && (
                <InfoRow label="Gender" value={e.gender === 'MALE' ? 'Male' : e.gender === 'FEMALE' ? 'Female' : 'Other'} />
              )}
              {e.manager && (
                <InfoRow label="Reports To" value={`${e.manager.firstName} ${e.manager.lastName} · ${e.manager.position}`} />
              )}
            </>
          )}

          {/* ── Emergency Contact tab — always shown ── */}
          {activeTab === 'Emergency Contact' && (
            <>
              <InfoRow label="Contact Name" value={e.emergencyContactName ?? '—'} />
              <InfoRow label="Contact Phone" value={e.emergencyContactPhone ?? '—'} />
            </>
          )}

          {/* ── IDs & Bank tab ── */}
          {activeTab === 'IDs & Bank' && (
            <>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                Government IDs
              </div>
              <InfoRow label="SSS No." value={e.sssNo ?? '—'} mono />
              <InfoRow label="PhilHealth No." value={e.philhealthNo ?? '—'} mono />
              <InfoRow label="Pag-IBIG No." value={e.pagibigNo ?? '—'} mono />
              <InfoRow label="TIN No." value={e.tinNo ?? '—'} mono />

              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '16px 0 8px' }}>
                Bank Details
              </div>
              <InfoRow label="Bank" value={e.bankName ?? '—'} />
              <InfoRow label="Account No." value={e.bankAccountNo ?? '—'} mono />
              <InfoRow label="Account Name" value={e.bankAccountName ?? '—'} />
            </>
          )}

          {/* ── Organization tab ── */}
          {activeTab === 'Organization' && (
            <>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                Manager
              </div>
              {e.manager ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--color-border)', marginBottom: 16 }}>
                  <div className="emp-avatar" style={{ width: 36, height: 36, fontSize: 13, background: 'var(--color-primary)', flexShrink: 0 }}>
                    {e.manager.firstName[0]}{e.manager.lastName[0]}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13.5 }}>{e.manager.firstName} {e.manager.lastName}</div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{e.manager.position}</div>
                  </div>
                </div>
              ) : (
                <div style={{ color: 'var(--color-text-muted)', fontSize: 13, padding: '8px 0', borderBottom: '1px solid var(--color-border)', marginBottom: 16 }}>
                  No direct manager assigned
                </div>
              )}

              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                Direct Reports {e.subordinates && e.subordinates.length > 0 ? `(${e.subordinates.length})` : ''}
              </div>
              {e.subordinates && e.subordinates.length > 0 ? (
                e.subordinates.map(s => (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--color-border)' }}>
                    <div className="emp-avatar" style={{ width: 28, height: 28, fontSize: 11, background: 'var(--color-primary)' }}>
                      {s.firstName[0]}{s.lastName[0]}
                    </div>
                    <span style={{ fontSize: 13 }}>{s.firstName} {s.lastName} <span style={{ color: 'var(--color-text-muted)' }}>· {s.position}</span></span>
                  </div>
                ))
              ) : (
                <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>No direct reports</div>
              )}

              {(e.resourceCost != null || e.payrollCost != null) && (
                <>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '16px 0 8px' }}>
                    Billing
                  </div>
                  {e.resourceCost != null && <InfoRow label="Resource Cost" value={`₱${e.resourceCost.toLocaleString('en-PH')}`} />}
                  {e.payrollCost != null && <InfoRow label="Payroll Cost" value={`₱${e.payrollCost.toLocaleString('en-PH')}`} />}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--color-border)', fontSize: 13.5 }}>
      <span style={{ color: 'var(--color-text-muted)', fontWeight: 500 }}>{label}</span>
      <span style={{ fontFamily: mono ? 'var(--font-mono)' : undefined, fontSize: mono ? 12.5 : undefined, fontWeight: 600 }}>{value}</span>
    </div>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' });
}
