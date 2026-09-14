import { useState, useMemo, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import api from '@/lib/api';
import { useToast } from '@/lib/toast';
import { DataTable } from '@/components/DataTable';
import { EmployeeCombobox } from '@/components/EmployeeCombobox';
import type { LeaveType, Employee, LeaveBalance, CutOffPeriod, GlobalPayrollPolicy } from '@/types';

// ── Tab Bar (same as Employee modal) ─────────────────────────────────────────
function TabBar({ tabs, active, onChange }: {
  tabs: string[];
  active: string;
  onChange: (t: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const rafId = requestAnimationFrame(checkScroll);
    el.addEventListener('scroll', checkScroll);
    const ro = new ResizeObserver(checkScroll);
    ro.observe(el);
    return () => { cancelAnimationFrame(rafId); el.removeEventListener('scroll', checkScroll); ro.disconnect(); };
  }, [tabs]);

  const scroll = (dir: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir === 'left' ? -120 : 120, behavior: 'smooth' });
  };

  const arrowBtn = (dir: 'left' | 'right', enabled: boolean) => (
    <button
      type="button"
      onClick={() => scroll(dir)}
      style={{
        flexShrink: 0, width: 26, height: 30,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: enabled ? 'var(--color-surface-2)' : 'transparent',
        border: '1px solid var(--color-border)', borderRadius: 6,
        cursor: enabled ? 'pointer' : 'default',
        color: enabled ? 'var(--color-text-secondary)' : 'var(--color-border)',
        fontSize: 14, marginBottom: 20, transition: 'background 0.12s',
      }}
      tabIndex={-1}
    >
      {dir === 'left' ? '‹' : '›'}
    </button>
  );

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
      {arrowBtn('left', canScrollLeft)}
      <div
        ref={scrollRef}
        style={{
          flex: 1, display: 'flex', gap: 2, marginBottom: 20,
          overflowX: 'auto', scrollbarWidth: 'none' as any,
          msOverflowStyle: 'none' as any, padding: '0 2px',
        }}
      >
        {tabs.map(t => (
          <button
            key={t}
            type="button"
            onClick={() => onChange(t)}
            style={{
              background: active === t ? 'var(--color-primary)' : 'transparent',
              border: active === t ? 'none' : '1px solid var(--color-border)',
              borderRadius: '6px 6px 0 0',
              padding: '7px 16px',
              fontSize: 13,
              fontWeight: active === t ? 700 : 500,
              color: active === t ? '#fff' : 'var(--color-text-secondary)',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'background 0.12s, color 0.12s',
            }}
          >
            {t}
          </button>
        ))}
      </div>
      {arrowBtn('right', canScrollRight)}
    </div>
  );
}

// ── Leave Setup sub-component (verbatim from LeaveSetup) ─────────────────────

const BLANK_LEAVE_FORM = {
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

function LeaveSetupContent() {
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState('Leave Types');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<LeaveType | null>(null);
  const [form, setForm] = useState({ ...BLANK_LEAVE_FORM });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

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
    enabled: tab === 'Manual Balances (SIL)',
  });
  const { data: empBalances = [] } = useQuery<LeaveBalance[]>({
    queryKey: ['leave-balances', silEmployeeId, silYear],
    queryFn: () => api.get(`/leave/balances/${silEmployeeId}?year=${silYear}`).then(r => r.data),
    enabled: !!silEmployeeId,
  });

  function openCreate() { setEditing(null); setForm({ ...BLANK_LEAVE_FORM }); setError(''); setShowForm(true); }
  function openEdit(lt: LeaveType) {
    setEditing(lt);
    setForm({ code: lt.code, name: lt.name, daysPerYear: lt.daysPerYear, isPaid: lt.isPaid,
      legalBasis: lt.legalBasis ?? '', applicableGender: lt.applicableGender,
      resetsAnnually: lt.resetsAnnually, accruesMonthly: lt.accruesMonthly,
      isManual: lt.isManual, isActive: lt.isActive });
    setError(''); setShowForm(true);
  }

  async function handleSave() {
    setSaving(true); setError('');
    try {
      const payload = { ...form, legalBasis: form.legalBasis || null };
      if (editing) { await api.put(`/leave/types/${editing.id}`, payload); }
      else { await api.post('/leave/types', payload); }
      qc.invalidateQueries({ queryKey: ['leave-types-all'] });
      qc.invalidateQueries({ queryKey: ['leave-types'] });
      toast('success', 'Leave type saved');
      setShowForm(false);
    } catch (e: any) {
      setError(e.response?.data?.error ?? 'Save failed');
      toast('error', 'Failed to save leave type');
    } finally { setSaving(false); }
  }

  async function handleDeactivate(lt: LeaveType) {
    if (!confirm(`Deactivate "${lt.name}"? It will no longer appear in leave requests.`)) return;
    try {
      await api.delete(`/leave/types/${lt.id}`);
      qc.invalidateQueries({ queryKey: ['leave-types-all'] });
      qc.invalidateQueries({ queryKey: ['leave-types'] });
      toast('success', 'Leave type deactivated');
    } catch { toast('error', 'Failed to deactivate leave type'); }
  }

  async function handleReactivate(lt: LeaveType) {
    try {
      await api.put(`/leave/types/${lt.id}`, { isActive: true });
      qc.invalidateQueries({ queryKey: ['leave-types-all'] });
      qc.invalidateQueries({ queryKey: ['leave-types'] });
      toast('success', 'Leave type reactivated');
    } catch { toast('error', 'Failed to reactivate leave type'); }
  }

  async function handleSilSave() {
    if (!silEmployeeId || !silLeaveTypeId || silDays === '') return;
    setSilMsg('');
    try {
      await api.put(`/leave/balances/${silEmployeeId}/${silLeaveTypeId}`, { totalDays: parseFloat(silDays), year: silYear });
      setSilMsg('Balance updated.');
      qc.invalidateQueries({ queryKey: ['leave-balances', silEmployeeId, silYear] });
      setTimeout(() => setSilMsg(''), 3000);
      toast('success', 'Balance updated');
    } catch (e: any) {
      const msg = e.response?.data?.error ?? 'Failed to update balance';
      setSilMsg(msg);
      toast('error', 'Failed to update balance');
    }
  }

  const setField = (k: keyof typeof form, v: any) => setForm(f => ({ ...f, [k]: v }));
  const genderLabel = (g: string) => ({ ALL: 'All', MALE: 'Male only', FEMALE: 'Female only' }[g] ?? g);

  const columns = useMemo<ColumnDef<LeaveType>[]>(() => [
    { accessorKey: 'code', header: 'Code', cell: ({ row }) => <strong>{row.original.code}</strong> },
    { accessorKey: 'name', header: 'Name' },
    { accessorKey: 'daysPerYear', header: 'Days/Year' },
    { id: 'isPaid', header: 'Paid', accessorFn: row => row.isPaid ? 'Yes' : 'No' },
    { id: 'gender', header: 'Gender', accessorFn: row => genderLabel(row.applicableGender) },
    { id: 'accrues', header: 'Accrues', accessorFn: row => row.accruesMonthly ? 'Monthly' : row.isManual ? 'Manual' : '—' },
    { id: 'resets', header: 'Resets Jan', accessorFn: row => row.resetsAnnually ? 'Yes' : 'No' },
    { id: 'manual', header: 'Manual', accessorFn: row => row.isManual ? 'Yes' : 'No' },
    {
      id: 'status', header: 'Status', accessorFn: row => row.isActive ? 'Active' : 'Inactive',
      cell: ({ row }) => <span className={`badge ${row.original.isActive ? 'badge-success' : 'badge-neutral'}`}>{row.original.isActive ? 'Active' : 'Inactive'}</span>,
    },
    {
      id: 'actions', header: 'Actions',
      cell: ({ row }) => (
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn btn-sm btn-secondary" onClick={() => openEdit(row.original)}>Edit</button>
          {row.original.isActive
            ? <button className="btn btn-sm btn-danger-outline" onClick={() => handleDeactivate(row.original)}>Deactivate</button>
            : <button className="btn btn-sm btn-secondary" onClick={() => handleReactivate(row.original)}>Activate</button>}
        </div>
      ),
    },
  ], [types]);

  const balanceColumns = useMemo<ColumnDef<LeaveBalance>[]>(() => [
    { accessorFn: row => row.leaveType?.name ?? row.leaveTypeId, id: 'leaveType', header: 'Leave Type' },
    { accessorKey: 'totalDays', header: 'Total Days' },
    { accessorKey: 'usedDays', header: 'Used' },
    { accessorKey: 'pendingDays', header: 'Pending' },
    { id: 'available', header: 'Available', accessorFn: row => row.totalDays - row.usedDays - row.pendingDays,
      cell: ({ getValue }) => <strong>{getValue() as number}</strong> },
  ], []);

  return (
    <>
      <TabBar tabs={['Leave Types', 'Manual Balances (SIL)']} active={tab} onChange={setTab} />

      {tab === 'Leave Types' && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Leave Types</h2>
            <button className="btn btn-primary btn-sm" onClick={openCreate}>+ Add Leave Type</button>
          </div>
          {isLoading ? <div className="loading-center"><div className="spinner" /></div> : (
            <DataTable data={types} columns={columns} globalFilterPlaceholder="Search leave types…" exportFilename="leave-types" />
          )}
        </div>
      )}

      {tab === 'Manual Balances (SIL)' && (
        <div className="card">
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Set Manual Leave Balance</h2>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 20 }}>
            Use this to manually set leave balances for leave types that do not accrue automatically (e.g. Service Incentive Leave).
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16, marginBottom: 20 }}>
            <div className="form-group">
              <label className="form-label">Employee</label>
              <EmployeeCombobox employees={employees} value={silEmployeeId} onChange={id => { setSilEmployeeId(id); setSilLeaveTypeId(''); setSilDays(''); setSilMsg(''); }} placeholder="Select employee…" required />
            </div>
            <div className="form-group">
              <label className="form-label">Leave Type</label>
              <select className="form-control" value={silLeaveTypeId} onChange={e => { setSilLeaveTypeId(e.target.value); setSilDays(''); setSilMsg(''); }} disabled={!silEmployeeId}>
                <option value="">Select leave type…</option>
                {types.map(lt => <option key={lt.id} value={lt.id}>{lt.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Year</label>
              <input type="number" className="form-control" value={silYear} onChange={e => setSilYear(parseInt(e.target.value))} min={2020} max={2099} />
            </div>
            <div className="form-group">
              <label className="form-label">Total Days to Set</label>
              <input type="number" className="form-control" value={silDays} onChange={e => setSilDays(e.target.value)} min={0} step={0.5} placeholder="e.g. 5" disabled={!silLeaveTypeId} />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button className="btn btn-primary" onClick={handleSilSave} disabled={!silEmployeeId || !silLeaveTypeId || silDays === ''}>Set Balance</button>
            {silMsg && <span style={{ fontSize: 13, color: 'var(--color-success)' }}>{silMsg}</span>}
          </div>
          {silEmployeeId && (
            <div style={{ marginTop: 28 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Current Balances — {silYear}</h3>
              {empBalances.length === 0 ? (
                <p style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>No balances recorded for this year.</p>
              ) : (
                <DataTable data={empBalances} columns={balanceColumns} globalFilterPlaceholder="Search balances…" exportFilename="leave-balances" pageSize={10} />
              )}
            </div>
          )}
        </div>
      )}

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
                {([
                  ['isPaid', 'Paid leave'],
                  ['accruesMonthly', 'Accrues monthly (daysPerYear ÷ 12)'],
                  ['resetsAnnually', 'Resets every January'],
                  ['isManual', 'Manually allocated (e.g. SIL)'],
                  ['isActive', 'Active'],
                ] as [keyof typeof form, string][]).map(([key, label]) => (
                  <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer' }}>
                    <input type="checkbox" checked={form[key] as boolean} onChange={e => setField(key, e.target.checked)} />
                    {label}
                  </label>
                ))}
              </div>
              {error && <div className="alert alert-error" style={{ gridColumn: '1 / -1' }}>{error}</div>}
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
    </>
  );
}

// ── Payroll Setup sub-component ───────────────────────────────────────────────

const BLANK_CUTOFF_FORM = {
  name: '',
  cutOffFromDay: 26,
  cutOffFromIsPrevMonth: true,
  cutOffToDay: 10,
  payDay: 15,
  payDayIsNextMonth: false,
  sortOrder: 0,
  isActive: true,
};

const DEDUCTION_TYPES = [
  { type: 'SSS_DEDUCTION', label: 'SSS Deduction' },
  { type: 'PHIC_DEDUCTION', label: 'PhilHealth (PHIC) Deduction' },
  { type: 'HDMF_DEDUCTION', label: 'Pag-IBIG (HDMF) Deduction' },
  { type: 'TAX_DEDUCTION', label: 'Withholding Tax Deduction' },
] as const;

function PayrollSetupContent() {
  const qc = useQueryClient();
  const toast = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editingPeriod, setEditingPeriod] = useState<CutOffPeriod | null>(null);
  const [form, setForm] = useState({ ...BLANK_CUTOFF_FORM });
  const [saving, setSaving] = useState(false);

  const { data: periods = [], isLoading: periodsLoading } = useQuery<CutOffPeriod[]>({
    queryKey: ['cutoff-periods'],
    queryFn: () => api.get('/global-setup/cutoff-periods').then(r => r.data),
  });

  const { data: policies = [] } = useQuery<GlobalPayrollPolicy[]>({
    queryKey: ['global-payroll-policies'],
    queryFn: () => api.get('/global-setup/payroll-policies').then(r => r.data),
  });

  function openCreate() { setEditingPeriod(null); setForm({ ...BLANK_CUTOFF_FORM }); setShowForm(true); }
  function openEdit(p: CutOffPeriod) {
    setEditingPeriod(p);
    setForm({ name: p.name, cutOffFromDay: p.cutOffFromDay, cutOffFromIsPrevMonth: p.cutOffFromIsPrevMonth,
      cutOffToDay: p.cutOffToDay, payDay: p.payDay, payDayIsNextMonth: p.payDayIsNextMonth,
      sortOrder: p.sortOrder, isActive: p.isActive });
    setShowForm(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      if (editingPeriod) { await api.put(`/global-setup/cutoff-periods/${editingPeriod.id}`, form); }
      else { await api.post('/global-setup/cutoff-periods', form); }
      qc.invalidateQueries({ queryKey: ['cutoff-periods'] });
      toast('success', 'Cut-off period saved');
      setShowForm(false);
    } catch (e: any) {
      toast('error', e.response?.data?.error ?? 'Save failed');
    } finally { setSaving(false); }
  }

  async function handleDelete(p: CutOffPeriod) {
    if (!confirm(`Delete cut-off period "${p.name}"?`)) return;
    try {
      await api.delete(`/global-setup/cutoff-periods/${p.id}`);
      qc.invalidateQueries({ queryKey: ['cutoff-periods'] });
      toast('success', 'Cut-off period deleted');
    } catch (e: any) {
      toast('error', e.response?.data?.error ?? 'Delete failed');
    }
  }

  async function handlePolicyChange(type: string, cutOffPeriodId: string | null) {
    try {
      await api.put('/global-setup/payroll-policies', { type, cutOffPeriodId });
      qc.invalidateQueries({ queryKey: ['global-payroll-policies'] });
      toast('success', 'Policy updated');
    } catch {
      toast('error', 'Failed to update policy');
    }
  }

  const getPolicyPeriodId = (type: string) =>
    policies.find((p: GlobalPayrollPolicy) => p.type === type)?.cutOffPeriodId ?? '';

  const setField = (k: keyof typeof form, v: any) => setForm(f => ({ ...f, [k]: v }));

  const periodColumns = useMemo<ColumnDef<CutOffPeriod>[]>(() => [
    { accessorKey: 'name', header: 'Name' },
    {
      id: 'cutOffFrom', header: 'Cut Off From',
      accessorFn: row => `${row.cutOffFromIsPrevMonth ? 'Prev month ' : ''}Day ${row.cutOffFromDay}`,
    },
    { id: 'cutOffTo', header: 'Cut Off To', accessorFn: row => `Day ${row.cutOffToDay}` },
    {
      id: 'payDay', header: 'Pay Date',
      accessorFn: row => `Day ${row.payDay}${row.payDayIsNextMonth ? ' (next month)' : ''}`,
    },
    { id: 'sortOrder', header: 'Order', accessorKey: 'sortOrder' },
    {
      id: 'status', header: 'Status',
      cell: ({ row }) => (
        <span className={`badge ${row.original.isActive ? 'badge-success' : 'badge-neutral'}`}>
          {row.original.isActive ? 'Active' : 'Inactive'}
        </span>
      ),
    },
    {
      id: 'actions', header: 'Actions',
      cell: ({ row }) => (
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn btn-sm btn-secondary" onClick={() => openEdit(row.original)}>Edit</button>
          <button className="btn btn-sm btn-danger-outline" onClick={() => handleDelete(row.original)}>Delete</button>
        </div>
      ),
    },
  ], [periods]);

  return (
    <>
      {/* Cut-Off Periods Table */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Cut-Off Periods</h2>
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 4, marginBottom: 0 }}>
              Define the attendance cut-off windows used for each deduction type.
            </p>
          </div>
          <button className="btn btn-primary btn-sm" onClick={openCreate}>+ Add Period</button>
        </div>
        {periodsLoading ? <div className="loading-center"><div className="spinner" /></div> : (
          <DataTable data={periods} columns={periodColumns} globalFilterPlaceholder="Search periods…" exportFilename="cutoff-periods" />
        )}
      </div>

      {/* Global Deduction Policies */}
      <div className="card">
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Global Deduction Cut-Off Policy</h2>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 20 }}>
          Select which cut-off period's attendance is used when computing each statutory deduction.
          Per-client overrides can be set in the Client's Policy tab.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {DEDUCTION_TYPES.map(({ type, label }) => (
            <div className="form-group" key={type}>
              <label className="form-label">{label}</label>
              <select
                className="form-control"
                value={getPolicyPeriodId(type)}
                onChange={e => handlePolicyChange(type, e.target.value || null)}
              >
                <option value="">— No override —</option>
                {periods.filter(p => p.isActive).map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </div>

      {/* Cut-Off Period Modal */}
      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" style={{ maxWidth: 540 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">{editingPeriod ? 'Edit Cut-Off Period' : 'New Cut-Off Period'}</h2>
              <button className="modal-close" onClick={() => setShowForm(false)}>✕</button>
            </div>
            <div className="modal-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label className="form-label">Name *</label>
                <input className="form-control" value={form.name} onChange={e => setField('name', e.target.value)} placeholder="e.g. 1st Half (26th–10th)" />
              </div>
              <div className="form-group">
                <label className="form-label">Cut-Off From Day</label>
                <input type="number" className="form-control" min={1} max={31} value={form.cutOffFromDay} onChange={e => setField('cutOffFromDay', parseInt(e.target.value) || 1)} />
              </div>
              <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 28 }}>
                <input type="checkbox" id="prevMonth" checked={form.cutOffFromIsPrevMonth} onChange={e => setField('cutOffFromIsPrevMonth', e.target.checked)} />
                <label htmlFor="prevMonth" style={{ fontSize: 14, cursor: 'pointer', marginBottom: 0 }}>From previous month</label>
              </div>
              <div className="form-group">
                <label className="form-label">Cut-Off To Day</label>
                <input type="number" className="form-control" min={1} max={31} value={form.cutOffToDay} onChange={e => setField('cutOffToDay', parseInt(e.target.value) || 1)} />
              </div>
              <div className="form-group">
                <label className="form-label">Pay Day</label>
                <input type="number" className="form-control" min={1} max={31} value={form.payDay} onChange={e => setField('payDay', parseInt(e.target.value) || 1)} />
              </div>
              <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 28 }}>
                <input type="checkbox" id="nextMonth" checked={form.payDayIsNextMonth} onChange={e => setField('payDayIsNextMonth', e.target.checked)} />
                <label htmlFor="nextMonth" style={{ fontSize: 14, cursor: 'pointer', marginBottom: 0 }}>Pay day is next month</label>
              </div>
              <div className="form-group">
                <label className="form-label">Sort Order</label>
                <input type="number" className="form-control" min={0} value={form.sortOrder} onChange={e => setField('sortOrder', parseInt(e.target.value) || 0)} />
              </div>
              <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 28 }}>
                <input type="checkbox" id="isActive" checked={form.isActive} onChange={e => setField('isActive', e.target.checked)} />
                <label htmlFor="isActive" style={{ fontSize: 14, cursor: 'pointer', marginBottom: 0 }}>Active</label>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving || !form.name}>
                {saving ? 'Saving…' : editingPeriod ? 'Save Changes' : 'Create Period'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Main GlobalSetup page ─────────────────────────────────────────────────────

export default function GlobalSetup() {
  const [outerTab, setOuterTab] = useState('Leave');

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Global Setup</h1>
          <p className="page-subtitle">Configure leave types, balances, and payroll cut-off periods</p>
        </div>
      </div>

      {/* Outer tabs */}
      <TabBar tabs={['Leave', 'Payroll']} active={outerTab} onChange={setOuterTab} />

      {outerTab === 'Leave' && <LeaveSetupContent />}
      {outerTab === 'Payroll' && <PayrollSetupContent />}
    </div>
  );
}
