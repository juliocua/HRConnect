import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import type { Employee, Department, EmployeeFormData, EmployeeStatus, Client } from '@/types';

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
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState<Employee | null>(null);
  const [viewTarget, setViewTarget] = useState<Employee | null>(null);

  const { data: employees = [], isLoading } = useQuery<Employee[]>({
    queryKey: ['employees', search, deptFilter, statusFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (deptFilter) params.set('departmentId', deptFilter);
      if (statusFilter) params.set('status', statusFilter);
      return api.get(`/employees?${params}`).then(r => r.data);
    },
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
          <div className="search-box" style={{ flex: 2 }}>
            <svg className="search-box-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              className="form-control"
              placeholder="Search by name, email, or position…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <select className="form-control" style={{ width: 180 }} value={deptFilter} onChange={e => setDeptFilter(e.target.value)}>
            <option value="">All Departments</option>
            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select className="form-control" style={{ width: 150 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All Statuses</option>
            {(Object.keys(STATUS_LABELS) as EmployeeStatus[]).map(s => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>
        </div>
      </div>

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
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Emp. No</th>
                <th>Department</th>
                <th>Position</th>
                <th>Deployed To</th>
                <th>Status</th>
                <th>Hire Date</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {employees.map(e => (
                <tr key={e.id}>
                  <td>
                    <div className="emp-info">
                      <div className="emp-avatar" style={{ background: e.avatarColor, overflow: 'hidden', padding: 0 }}>
                        {e.photoUrl
                          ? <img src={e.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }} />
                          : <>{e.firstName[0]}{e.lastName[0]}</>
                        }
                      </div>
                      <div>
                        <div className="emp-name">{e.firstName} {e.lastName}</div>
                        <div className="emp-role">{e.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="td-mono">{e.employeeNo}</td>
                  <td>{e.department.name}</td>
                  <td>{e.position}</td>
                  <td>
                    {e.client
                      ? <span style={{ fontSize: 13, fontWeight: 600 }}>{e.client.name}</span>
                      : <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>—</span>
                    }
                  </td>
                  <td><span className={`badge ${STATUS_COLORS[e.status]}`}>{STATUS_LABELS[e.status]}</span></td>
                  <td className="text-muted text-sm">{formatDate(e.hireDate)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => setViewTarget(e)}>View</button>
                      <button className="btn btn-secondary btn-sm" onClick={() => openEdit(e)}>Edit</button>
                      {e.status !== 'TERMINATED' && (
                        <button className="btn btn-ghost btn-sm" style={{ color: 'var(--color-danger)' }} onClick={() => handleDelete(e)}>
                          Terminate
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
        avatarColor: initial.avatarColor,
      }
    : {
        firstName: '', lastName: '', email: '', phone: '', position: '',
        departmentId: departments[0]?.id ?? '',
        managerId: '', status: 'ACTIVE', hireDate: new Date().toISOString().slice(0, 10),
        basicSalary: 25000, resourceCost: null, payrollCost: null, clientId: null,
        sssNo: '', philhealthNo: '', pagibigNo: '', tinNo: '',
        avatarColor: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
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

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-lg">
        <div className="modal-header">
          <h2 className="modal-title">{isEdit ? 'Edit Employee' : 'Add Employee'}</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        {tempPassword ? (
          <>
            <div className="modal-body" style={{ gap: 16 }}>
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
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="error-msg">{error}</div>}

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

            <div className="form-grid form-grid-2">
              <div className="form-group">
                <label>Email *</label>
                <input type="email" className="form-control" required value={form.email} onChange={e => set('email', e.target.value)} />
              </div>
              <div className="form-group">
                <label>Phone</label>
                <input className="form-control" placeholder="+63 9XX XXX XXXX" value={form.phone ?? ''} onChange={e => set('phone', e.target.value)} />
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

            <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '8px 0 4px' }}>
              Client Deployment
            </div>

            <div className="form-grid form-grid-2" style={{ gap: 12, marginBottom: 4 }}>
              <div className="form-group" style={{ gridColumn: '1/-1' }}>
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

            <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '8px 0 4px' }}>
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

            {/* Login Account — edit mode only */}
            {isEdit && (
              <>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '8px 0 4px' }}>
                  Login Account
                </div>
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
                {accountError && <div className="error-msg" style={{ marginTop: 0 }}>{accountError}</div>}
              </>
            )}

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
          </div>
          <div className="modal-footer">
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

// ── Employee Detail Modal ──────────────────────────────────────────────────
function EmployeeDetailModal({ employee: e, onClose, onEdit }: {
  employee: Employee; onClose: () => void; onEdit: () => void;
}) {
  const qc = useQueryClient();
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoError, setPhotoError] = useState('');

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
      <div className="modal">
        <div className="modal-header">
          <h2 className="modal-title">Employee Profile</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary btn-sm" onClick={onEdit}>Edit</button>
            <button className="icon-btn" onClick={onClose}>✕</button>
          </div>
        </div>
        <div className="modal-body">
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20, marginBottom: 8 }}>
            {/* Photo / Avatar */}
            <div style={{ flexShrink: 0 }}>
              <div style={{
                width: 80, height: 100, borderRadius: 10,
                background: e.avatarColor, overflow: 'hidden',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 26, fontWeight: 800, color: '#fff',
              }}>
                {e.photoUrl
                  ? <img src={e.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }} />
                  : <>{e.firstName[0]}{e.lastName[0]}</>
                }
              </div>
              {/* Upload / Remove buttons */}
              <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
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
                  style={{ fontSize: 11, padding: '3px 8px' }}
                  disabled={photoUploading}
                  onClick={() => photoInputRef.current?.click()}
                >
                  {photoUploading ? '…' : e.photoUrl ? '📷 Change' : '📷 Add Photo'}
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

            <div>
              <div style={{ fontSize: 20, fontWeight: 800 }}>{e.firstName} {e.lastName}</div>
              <div style={{ color: 'var(--color-text-secondary)', marginTop: 2 }}>{e.position} · {e.department.name}</div>
              <span className={`badge ${STATUS_COLORS[e.status]}`} style={{ marginTop: 6 }}>{STATUS_LABELS[e.status]}</span>
            </div>
          </div>

          <div className="divider" />

          <InfoRow label="Employee No." value={e.employeeNo} mono />
          <InfoRow label="Email" value={e.email} />
          {e.phone && <InfoRow label="Phone" value={e.phone} />}
          <InfoRow label="Hire Date" value={formatDate(e.hireDate)} />
          <InfoRow label="Basic Salary" value={`₱${e.basicSalary.toLocaleString('en-PH')}`} />
          {e.manager && (
            <InfoRow label="Reports To" value={`${e.manager.firstName} ${e.manager.lastName} · ${e.manager.position}`} />
          )}

          {(e.sssNo || e.philhealthNo || e.pagibigNo || e.tinNo) && (
            <>
              <div className="divider" />
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Government IDs</div>
              {e.sssNo && <InfoRow label="SSS" value={e.sssNo} mono />}
              {e.philhealthNo && <InfoRow label="PhilHealth" value={e.philhealthNo} mono />}
              {e.pagibigNo && <InfoRow label="Pag-IBIG" value={e.pagibigNo} mono />}
              {e.tinNo && <InfoRow label="TIN" value={e.tinNo} mono />}
            </>
          )}

          {e.subordinates && e.subordinates.length > 0 && (
            <>
              <div className="divider" />
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                Direct Reports ({e.subordinates.length})
              </div>
              {e.subordinates.map(s => (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <div className="emp-avatar" style={{ width: 28, height: 28, fontSize: 11, background: 'var(--color-primary)' }}>
                    {s.firstName[0]}{s.lastName[0]}
                  </div>
                  <span style={{ fontSize: 13 }}>{s.firstName} {s.lastName} <span style={{ color: 'var(--color-text-muted)' }}>· {s.position}</span></span>
                </div>
              ))}
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