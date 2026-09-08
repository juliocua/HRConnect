import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import type { LeaveType, Employee, LeaveBalance } from '@/types';

const BLANK_FORM = {
  code: '',
  name: '',
  daysPerYear: 5,
  isPaid: true,
  legalBasis: '',
  applicableGender: 'ALL' as 'ALL' | 'MALE' | 'FEMALE',
  resetsAnnually: true,
  accruesMonthly: false,
  isManual: false,
  isActive: true,
};

export default function LeaveSetup() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'types' | 'balances'>('types');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<LeaveType | null>(null);
  const [form, setForm] = useState({ ...BLANK_FORM });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // SIL balance editor state
  const [silEmployeeId, setSilEmployeeId] = useState('');
  const [silLeaveTypeId, setSilLeaveTypeId] = useState('');
  const [silDays, setSilDays] = useState('');
  const [silYear, setSilYear] = useState(new Date().getFullYear());
  const [silMsg, setSilMsg] = useState('');

  const { data: types = [], isLoading } = useQuery<LeaveType[]>({
    queryKey: ['leave-types-all'],
    queryFn: () => api.get('/leave/types/all').then(r => r.data),
  });

  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ['employees'],
    queryFn: () => api.get('/employees').then(r => r.data),
    enabled: tab === 'balances',
  });

  const { data: empBalances = [] } = useQuery<LeaveBalance[]>({
    queryKey: ['leave-balances', silEmployeeId, silYear],
    queryFn: () => api.get(`/leave/balances/${silEmployeeId}?year=${silYear}`).then(r => r.data),
    enabled: !!silEmployeeId,
  });

  const manualTypes = types.filter(t => t.isManual);

  function openCreate() {
    setEditing(null);
    setForm({ ...BLANK_FORM });
    setError('');
    setShowForm(true);
  }

  function openEdit(lt: LeaveType) {
    setEditing(lt);
    setForm({
      code: lt.code,
      name: lt.name,
      daysPerYear: lt.daysPerYear,
      isPaid: lt.isPaid,
      legalBasis: lt.legalBasis ?? '',
      applicableGender: lt.applicableGender,
      resetsAnnually: lt.resetsAnnually,
      accruesMonthly: lt.accruesMonthly,
      isManual: lt.isManual,
      isActive: lt.isActive,
    });
    setError('');
    setShowForm(true);
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      const payload = {
        ...form,
        legalBasis: form.legalBasis || null,
      };
      if (editing) {
        await api.put(`/leave/types/${editing.id}`, payload);
      } else {
        await api.post('/leave/types', payload);
      }
      qc.invalidateQueries({ queryKey: ['leave-types-all'] });
      qc.invalidateQueries({ queryKey: ['leave-types'] });
      setShowForm(false);
    } catch (e: any) {
      setError(e.response?.data?.error ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate(lt: LeaveType) {
    if (!confirm(`Deactivate "${lt.name}"? It will no longer appear in leave requests.`)) return;
    await api.delete(`/leave/types/${lt.id}`);
    qc.invalidateQueries({ queryKey: ['leave-types-all'] });
    qc.invalidateQueries({ queryKey: ['leave-types'] });
  }

  async function handleReactivate(lt: LeaveType) {
    await api.put(`/leave/types/${lt.id}`, { isActive: true });
    qc.invalidateQueries({ queryKey: ['leave-types-all'] });
    qc.invalidateQueries({ queryKey: ['leave-types'] });
  }

  async function handleSilSave() {
    if (!silEmployeeId || !silLeaveTypeId || silDays === '') return;
    setSilMsg('');
    try {
      await api.put(`/leave/balances/${silEmployeeId}/${silLeaveTypeId}`, {
        totalDays: parseFloat(silDays),
        year: silYear,
      });
      setSilMsg('Balance updated.');
      qc.invalidateQueries({ queryKey: ['leave-balances', silEmployeeId, silYear] });
      setTimeout(() => setSilMsg(''), 3000);
    } catch (e: any) {
      setSilMsg(e.response?.data?.error ?? 'Failed to update balance');
    }
  }

  const setField = (k: keyof typeof form, v: any) => setForm(f => ({ ...f, [k]: v }));

  const genderLabel = (g: string) => ({ ALL: 'All', MALE: 'Male only', FEMALE: 'Female only' }[g] ?? g);

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Leave Setup</h1>
          <p className="page-subtitle">Manage leave types and employee leave balances</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="tab-bar" style={{ marginBottom: 24 }}>
        <button
          className={`tab-btn${tab === 'types' ? ' active' : ''}`}
          onClick={() => setTab('types')}
        >Leave Types</button>
        <button
          className={`tab-btn${tab === 'balances' ? ' active' : ''}`}
          onClick={() => setTab('balances')}
        >Manual Balances (SIL)</button>
      </div>

      {/* ── Leave Types Tab ───────────────────────────────────────────────────── */}
      {tab === 'types' && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Leave Types</h2>
            <button className="btn btn-primary btn-sm" onClick={openCreate}>+ Add Leave Type</button>
          </div>

          {isLoading ? (
            <div className="loading-center"><div className="spinner" /></div>
          ) : (
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Name</th>
                    <th>Days/Year</th>
                    <th>Paid?</th>
                    <th>Gender</th>
                    <th>Accrues</th>
                    <th>Resets Jan</th>
                    <th>Manual</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {types.length === 0 && (
                    <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--color-text-muted)', padding: '32px 0' }}>No leave types yet</td></tr>
                  )}
                  {types.map(lt => (
                    <tr key={lt.id} style={{ opacity: lt.isActive ? 1 : 0.5 }}>
                      <td><strong>{lt.code}</strong></td>
                      <td>{lt.name}</td>
                      <td>{lt.daysPerYear}</td>
                      <td>{lt.isPaid ? '✓' : '—'}</td>
                      <td>{genderLabel(lt.applicableGender)}</td>
                      <td>{lt.accruesMonthly ? 'Monthly' : lt.isManual ? 'Manual' : '—'}</td>
                      <td>{lt.resetsAnnually ? '✓' : '—'}</td>
                      <td>{lt.isManual ? '✓' : '—'}</td>
                      <td>
                        <span className={`badge ${lt.isActive ? 'badge-success' : 'badge-neutral'}`}>
                          {lt.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn btn-sm btn-secondary" onClick={() => openEdit(lt)}>Edit</button>
                          {lt.isActive
                            ? <button className="btn btn-sm btn-danger-outline" onClick={() => handleDeactivate(lt)}>Deactivate</button>
                            : <button className="btn btn-sm btn-secondary" onClick={() => handleReactivate(lt)}>Activate</button>
                          }
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Manual Balances Tab ───────────────────────────────────────────────── */}
      {tab === 'balances' && (
        <div className="card">
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Set Manual Leave Balance</h2>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 20 }}>
            Use this to manually set leave balances for leave types that do not accrue automatically (e.g. Service Incentive Leave).
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16, marginBottom: 20 }}>
            <div className="form-group">
              <label className="form-label">Employee</label>
              <select
                className="form-control"
                value={silEmployeeId}
                onChange={e => { setSilEmployeeId(e.target.value); setSilLeaveTypeId(''); setSilDays(''); setSilMsg(''); }}
              >
                <option value="">Select employee…</option>
                {employees.map(e => (
                  <option key={e.id} value={e.id}>{e.lastName}, {e.firstName}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Leave Type</label>
              <select
                className="form-control"
                value={silLeaveTypeId}
                onChange={e => { setSilLeaveTypeId(e.target.value); setSilDays(''); setSilMsg(''); }}
                disabled={!silEmployeeId}
              >
                <option value="">Select leave type…</option>
                {manualTypes.map(lt => (
                  <option key={lt.id} value={lt.id}>{lt.name}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Year</label>
              <input
                type="number"
                className="form-control"
                value={silYear}
                onChange={e => setSilYear(parseInt(e.target.value))}
                min={2020}
                max={2099}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Total Days to Set</label>
              <input
                type="number"
                className="form-control"
                value={silDays}
                onChange={e => setSilDays(e.target.value)}
                min={0}
                step={0.5}
                placeholder="e.g. 5"
                disabled={!silLeaveTypeId}
              />
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              className="btn btn-primary"
              onClick={handleSilSave}
              disabled={!silEmployeeId || !silLeaveTypeId || silDays === ''}
            >
              Set Balance
            </button>
            {silMsg && <span style={{ fontSize: 13, color: 'var(--color-success)' }}>{silMsg}</span>}
          </div>

          {/* Current balances for selected employee */}
          {silEmployeeId && (
            <div style={{ marginTop: 28 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>
                Current Balances — {silYear}
              </h3>
              {empBalances.length === 0 ? (
                <p style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>No balances recorded for this year.</p>
              ) : (
                <div className="table-container">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Leave Type</th>
                        <th>Total Days</th>
                        <th>Used</th>
                        <th>Pending</th>
                        <th>Available</th>
                      </tr>
                    </thead>
                    <tbody>
                      {empBalances.map(b => (
                        <tr key={b.id}>
                          <td>{b.leaveType?.name ?? b.leaveTypeId}</td>
                          <td>{b.totalDays}</td>
                          <td>{b.usedDays}</td>
                          <td>{b.pendingDays}</td>
                          <td><strong>{b.totalDays - b.usedDays - b.pendingDays}</strong></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Leave Type Modal ──────────────────────────────────────────────────── */}
      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">{editing ? 'Edit Leave Type' : 'New Leave Type'}</h2>
              <button className="modal-close" onClick={() => setShowForm(false)}>✕</button>
            </div>
            <div className="modal-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>

              <div className="form-group">
                <label className="form-label">Code *</label>
                <input className="form-control" value={form.code} onChange={e => setField('code', e.target.value)} placeholder="e.g. SL" maxLength={20} />
              </div>

              <div className="form-group">
                <label className="form-label">Name *</label>
                <input className="form-control" value={form.name} onChange={e => setField('name', e.target.value)} placeholder="e.g. Sick Leave" />
              </div>

              <div className="form-group">
                <label className="form-label">Days Per Year</label>
                <input className="form-control" type="number" min={0} value={form.daysPerYear} onChange={e => setField('daysPerYear', parseInt(e.target.value) || 0)} />
              </div>

              <div className="form-group">
                <label className="form-label">Applicable Gender</label>
                <select className="form-control" value={form.applicableGender} onChange={e => setField('applicableGender', e.target.value)}>
                  <option value="ALL">All employees</option>
                  <option value="MALE">Male only</option>
                  <option value="FEMALE">Female only</option>
                </select>
              </div>

              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label className="form-label">Legal Basis (optional)</label>
                <input className="form-control" value={form.legalBasis} onChange={e => setField('legalBasis', e.target.value)} placeholder="e.g. RA 8972 Solo Parents Act" />
              </div>

              <div style={{ gridColumn: '1 / -1', display: 'flex', flexWrap: 'wrap', gap: 20 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.isPaid} onChange={e => setField('isPaid', e.target.checked)} />
                  Paid leave
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.accruesMonthly} onChange={e => setField('accruesMonthly', e.target.checked)} />
                  Accrues monthly (daysPerYear ÷ 12)
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.resetsAnnually} onChange={e => setField('resetsAnnually', e.target.checked)} />
                  Resets every January
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.isManual} onChange={e => setField('isManual', e.target.checked)} />
                  Manually allocated (e.g. SIL)
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.isActive} onChange={e => setField('isActive', e.target.checked)} />
                  Active
                </label>
              </div>

              {error && (
                <div className="alert alert-error" style={{ gridColumn: '1 / -1' }}>{error}</div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving || !form.code || !form.name}>
                {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create Leave Type'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
