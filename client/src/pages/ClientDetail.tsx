import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { formatPHP } from '@/lib/payroll';
import type { Client, ClientPolicy, Billing, BillingCycle, Employee } from '@/types';

const CYCLE_LABELS: Record<BillingCycle, string> = {
  WEEKLY: 'Weekly', EVERY_15TH: 'Every 15th',
  EVERY_30TH: 'Every 30th', MONTHLY: 'Monthly',
};

const POLICY_TYPES = [
  { value: 'EMPLOYEE_PAY_PERIOD', label: 'Employee Pay Period' },
  { value: 'WORK_HOURS', label: 'Work Hours' },
  { value: 'ATTENDANCE', label: 'Attendance Policy' },
  { value: 'DRESS_CODE', label: 'Dress Code' },
  { value: 'CONFIDENTIALITY', label: 'Confidentiality / NDA' },
  { value: 'DATA_PRIVACY', label: 'Data Privacy' },
  { value: 'TOOLS', label: 'Allowed Tools / Devices' },
  { value: 'REPORTING', label: 'Reporting Requirements' },
  { value: 'OTHER', label: 'Other' },
];

const PAY_PERIOD_VALUES = [
  { value: 'SEMI_MONTHLY', label: 'Semi-Monthly (paid twice a month)' },
  { value: 'MONTHLY', label: 'Monthly (paid once a month)' },
];

type Tab = 'overview' | 'policies' | 'billing';

export default function ClientDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('overview');
  const [showEditModal, setShowEditModal] = useState(false);
  const [showPolicyModal, setShowPolicyModal] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<ClientPolicy | null>(null);
  const [quickEmpId, setQuickEmpId] = useState<string | null>(null);
  const [markPaidBillingId, setMarkPaidBillingId] = useState<string | null>(null);

  const { data: client, isLoading } = useQuery<Client>({
    queryKey: ['client', id],
    queryFn: () => api.get(`/clients/${id}`).then(r => r.data),
    enabled: !!id,
  });

  const resendBill = useMutation({
    mutationFn: (billingId: string) => api.post(`/billing/${billingId}/resend`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['client', id] }),
  });

  const deletePolicy = useMutation({
    mutationFn: (policyId: string) => api.delete(`/clients/${id}/policies/${policyId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['client', id] }),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['client', id] });

  if (isLoading) return <div className="loading-center"><div className="spinner" /></div>;
  if (!client) return <div className="empty-state"><div className="empty-state-title">Client not found</div></div>;

  const totalBilled = (client.billings ?? []).reduce((s, b) => s + b.amount, 0);
  const totalPaid = (client.billings ?? []).filter(b => b.status === 'PAID').reduce((s, b) => s + b.amount, 0);
  const totalPending = (client.billings ?? []).filter(b => b.status === 'PENDING').reduce((s, b) => s + b.amount, 0);

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 24 }}>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/clients')} style={{ marginTop: 4 }}>← Back</button>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>{client.name}</h1>
            <span className={`badge ${client.activeContract ? 'badge-green' : 'badge-gray'}`}>
              {client.activeContract ? 'Active Contract' : 'Inactive'}
            </span>
            <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setShowEditModal(true)}>
              ✏️ Edit
            </button>
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 6, fontSize: 13, color: 'var(--color-text-muted)', flexWrap: 'wrap' }}>
            {client.address && <span>📍 {client.address}</span>}
            <span>🔄 Billing: {CYCLE_LABELS[client.billingCycle]}{client.billingDate && client.billingCycle === 'MONTHLY' ? ` (day ${client.billingDate})` : ''}</span>
            <span>👥 {client.employees?.length ?? 0} deployed</span>
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid-4" style={{ marginBottom: 24 }}>
        {[
          { label: 'Total Billed', value: formatPHP(totalBilled), icon: '📋', color: '#EFF6FF' },
          { label: 'Collected', value: formatPHP(totalPaid), icon: '✅', color: '#F0FDF4' },
          { label: 'Outstanding', value: formatPHP(totalPending), icon: '⏳', color: '#FEF2F2' },
          { label: 'Resources', value: client.employees?.length ?? 0, icon: '👥', color: '#FFFBEB' },
        ].map(s => (
          <div key={s.label} className="stat-card">
            <div className="stat-icon" style={{ background: s.color, fontSize: 20 }}>{s.icon}</div>
            <div>
              <div className="stat-label">{s.label}</div>
              <div className="stat-value" style={{ fontSize: 16 }}>{s.value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--color-border)', marginBottom: 24 }}>
        {(['overview', 'policies', 'billing'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: '10px 18px', fontSize: 14, fontWeight: tab === t ? 700 : 500,
              color: tab === t ? 'var(--color-primary)' : 'var(--color-text-secondary)',
              borderBottom: tab === t ? '2px solid var(--color-primary)' : '2px solid transparent',
              marginBottom: -1,
            }}
          >
            {t === 'overview' ? 'Overview' : t === 'policies' ? `Policies (${client.policies?.length ?? 0})` : `Billing History (${client.billings?.length ?? 0})`}
          </button>
        ))}
      </div>

      {/* Tab: Overview */}
      {tab === 'overview' && (
        <div className="grid-2">
          {/* Contact */}
          <div className="card">
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 14 }}>Contact Person</div>
            {client.contactName ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{client.contactName}</div>
                {client.contactEmail && <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>✉️ {client.contactEmail}</div>}
                {client.contactPhone && <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>📞 {client.contactPhone}</div>}
              </div>
            ) : <div className="text-muted text-sm">No contact person set</div>}

            {(client.servicesOffered || client.specificRequest) && (
              <>
                <div style={{ height: 1, background: 'var(--color-border)', margin: '16px 0' }} />
                {client.servicesOffered && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>Services</div>
                    <div style={{ fontSize: 13 }}>{client.servicesOffered}</div>
                  </div>
                )}
                {client.specificRequest && (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>Specific Request</div>
                    <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{client.specificRequest}</div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Deployed employees */}
          <div className="card">
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 14 }}>Deployed Resources</div>
            {(client.employees ?? []).length === 0 ? (
              <div className="empty-state" style={{ padding: '24px 0' }}>
                <div className="empty-state-icon">👥</div>
                <div>No employees deployed yet</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {client.employees!.map(e => (
                  <div
                    key={e.id}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', borderRadius: 8, padding: '6px 8px', transition: 'background 0.12s' }}
                    onClick={() => setQuickEmpId(e.id)}
                    onMouseEnter={ev => (ev.currentTarget.style.background = 'var(--color-surface-2)')}
                    onMouseLeave={ev => (ev.currentTarget.style.background = 'transparent')}
                  >
                    <div className="emp-info">
                      <div className="emp-avatar" style={{ background: e.avatarColor }}>
                        {e.firstName[0]}{e.lastName[0]}
                      </div>
                      <div>
                        <div className="emp-name">{e.firstName} {e.lastName}</div>
                        <div className="emp-role">{e.position}</div>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      {e.resourceCost != null && (
                        <div style={{ fontSize: 13, fontWeight: 700 }}>{formatPHP(e.resourceCost)}</div>
                      )}
                      {e.payrollCost != null && (
                        <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Cost: {formatPHP(e.payrollCost)}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab: Policies */}
      {tab === 'policies' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
            <button className="btn btn-primary" onClick={() => { setEditingPolicy(null); setShowPolicyModal(true); }}>
              + Add Policy
            </button>
          </div>
          {(client.policies ?? []).length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">📋</div>
              <div className="empty-state-title">No policies yet</div>
              <div>Add client requirements and policies</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {client.policies!.map(p => (
                <div key={p.id} className="card" style={{ padding: '16px 20px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <span className="badge badge-blue" style={{ fontSize: 11 }}>
                          {POLICY_TYPES.find(t => t.value === p.type)?.label ?? p.type}
                        </span>
                        <span style={{ fontWeight: 700, fontSize: 14 }}>{p.title}</span>
                        {p.type === 'EMPLOYEE_PAY_PERIOD' && p.value && (
                          <span className="badge badge-green" style={{ fontSize: 11 }}>
                            {PAY_PERIOD_VALUES.find(v => v.value === p.value)?.label?.split(' (')[0] ?? p.value}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{p.description}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => { setEditingPolicy(p); setShowPolicyModal(true); }}>Edit</button>
                      <button className="btn btn-ghost btn-sm" style={{ color: 'var(--color-danger)' }}
                        onClick={() => { if (confirm('Delete this policy?')) deletePolicy.mutate(p.id); }}>
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab: Billing History */}
      {tab === 'billing' && (
        <div>
          {(client.billings ?? []).length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">💳</div>
              <div className="empty-state-title">No billing records</div>
              <div>Go to Client Billing to generate invoices</div>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data-table" style={{ minWidth: '100%' }}>
                <thead>
                  <tr>
                    <th>Billing Date</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Paid At</th>
                    <th>Payment Ref</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {client.billings!.map(b => (
                    <tr key={b.id}>
                      <td style={{ fontWeight: 600 }}>{fmtDate(b.billingDate)}</td>
                      <td className="td-mono" style={{ fontWeight: 700 }}>{formatPHP(b.amount)}</td>
                      <td>
                        <span className={`badge ${b.status === 'PAID' ? 'badge-green' : b.status === 'CANCELLED' ? 'badge-gray' : 'badge-yellow'}`}>
                          {b.status}
                        </span>
                      </td>
                      <td style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                        {b.paidAt ? fmtDate(b.paidAt) : '—'}
                      </td>
                      <td style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--color-text-muted)' }}>
                        {b.paymentRef ?? '—'}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          {b.paymentLinkUrl && (
                            <a
                              href={b.paymentLinkUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="btn btn-ghost btn-sm"
                              style={{ textDecoration: 'none' }}
                            >
                              🔗 Pay Link
                            </a>
                          )}
                          {b.status === 'PENDING' && (
                            <>
                              <button
                                className="btn btn-ghost btn-sm"
                                disabled={resendBill.isPending}
                                onClick={() => resendBill.mutate(b.id)}
                              >
                                Resend
                              </button>
                              <button
                                className="btn btn-success btn-sm"
                                onClick={() => setMarkPaidBillingId(b.id)}
                              >
                                Mark Paid
                              </button>
                            </>
                          )}
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

      {showPolicyModal && (
        <PolicyModal
          clientId={client.id}
          policy={editingPolicy}
          onClose={() => setShowPolicyModal(false)}
          onSaved={() => { setShowPolicyModal(false); invalidate(); }}
        />
      )}

      {showEditModal && (
        <ClientModal
          client={client}
          onClose={() => setShowEditModal(false)}
          onSaved={() => { setShowEditModal(false); invalidate(); }}
        />
      )}

      {quickEmpId && (
        <QuickEmployeeModal
          employeeId={quickEmpId}
          onClose={() => setQuickEmpId(null)}
        />
      )}

      {markPaidBillingId && (
        <MarkPaidModal
          billingId={markPaidBillingId}
          onClose={() => setMarkPaidBillingId(null)}
          onSaved={() => { setMarkPaidBillingId(null); invalidate(); }}
        />
      )}
    </div>
  );
}

// ── Quick Employee Modal (read-only) ──────────────────────────────────────────

function QuickEmployeeModal({ employeeId, onClose }: { employeeId: string; onClose: () => void }) {
  const { data: emp, isLoading } = useQuery<Employee>({
    queryKey: ['employee', employeeId],
    queryFn: () => api.get(`/employees/${employeeId}`).then(r => r.data),
  });

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <h2 className="modal-title">Employee Details</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {isLoading ? (
            <div className="loading-center" style={{ padding: 32 }}><div className="spinner" /></div>
          ) : !emp ? (
            <div className="empty-state">Employee not found</div>
          ) : (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
                {emp.photoUrl ? (
                  <img src={emp.photoUrl} alt="" style={{ width: 64, height: 80, borderRadius: 8, objectFit: 'cover', objectPosition: 'top', flexShrink: 0 }} />
                ) : (
                  <div className="emp-avatar" style={{ background: emp.avatarColor, width: 64, height: 64, fontSize: 22, flexShrink: 0 }}>
                    {emp.firstName[0]}{emp.lastName[0]}
                  </div>
                )}
                <div>
                  <div style={{ fontWeight: 800, fontSize: 18 }}>{emp.firstName} {emp.lastName}</div>
                  <div style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>{emp.position}</div>
                  <div style={{ marginTop: 6 }}>
                    <span className={`badge ${emp.status === 'ACTIVE' ? 'badge-green' : emp.status === 'ON_LEAVE' ? 'badge-yellow' : 'badge-gray'}`}>
                      {emp.status?.replace('_', ' ')}
                    </span>
                  </div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {[
                  { label: 'Employee No', value: emp.employeeNo },
                  { label: 'Department', value: (emp.department as any)?.name ?? '—' },
                  { label: 'Email', value: emp.email },
                  { label: 'Phone', value: emp.phone ?? '—' },
                  { label: 'Hire Date', value: emp.hireDate ? new Date(emp.hireDate).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) : '—' },
                  { label: 'Basic Salary', value: formatPHP(emp.basicSalary) },
                  { label: 'Resource Cost', value: emp.resourceCost != null ? formatPHP(emp.resourceCost) : '—' },
                  { label: 'Payroll Cost', value: emp.payrollCost != null ? formatPHP(emp.payrollCost) : '—' },
                ].map(item => (
                  <div key={item.label}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>{item.label}</div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{item.value}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Mark Paid Modal ────────────────────────────────────────────────────────────

function MarkPaidModal({ billingId, onClose, onSaved }: {
  billingId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [paymentRef, setPaymentRef] = useState('');
  const [screenshotFile, setScreenshotFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentRef.trim()) { setError('Payment reference is required'); return; }
    setSaving(true); setError('');
    try {
      let paymentScreenshotUrl: string | undefined;
      if (screenshotFile) {
        setUploading(true);
        const form = new FormData();
        form.append('screenshot', screenshotFile);
        const res = await api.post(`/billing/${billingId}/payment-proof`, form, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        paymentScreenshotUrl = res.data.url;
        setUploading(false);
      }
      await api.put(`/billing/${billingId}/mark-paid`, { paymentRef: paymentRef.trim(), paymentScreenshotUrl });
      onSaved();
    } catch (err: any) {
      setUploading(false);
      setError(err?.response?.data?.error ?? 'Failed to mark as paid');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 460 }}>
        <div className="modal-header">
          <h2 className="modal-title">Mark as Paid</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="error-msg" style={{ marginBottom: 12 }}>{error}</div>}
            <div className="form-group" style={{ marginBottom: 14 }}>
              <label>Payment Reference *</label>
              <input
                className="form-control"
                required
                placeholder="e.g. GCash ref, bank transfer no."
                value={paymentRef}
                onChange={e => setPaymentRef(e.target.value)}
              />
              <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginTop: 4 }}>
                Enter the transaction or reference number from the payment
              </div>
            </div>
            <div className="form-group">
              <label>Payment Screenshot (optional)</label>
              <input
                type="file"
                accept="image/*"
                className="form-control"
                onChange={e => setScreenshotFile(e.target.files?.[0] ?? null)}
              />
              <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginTop: 4 }}>
                Upload proof of payment (JPEG, PNG — max 10 MB)
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-success" disabled={saving || uploading}>
              {uploading ? 'Uploading…' : saving ? 'Saving…' : '✓ Confirm Payment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Policy Modal ───────────────────────────────────────────────────────────────

function PolicyModal({ clientId, policy, onClose, onSaved }: {
  clientId: string;
  policy: ClientPolicy | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    type: policy?.type ?? 'EMPLOYEE_PAY_PERIOD',
    title: policy?.title ?? '',
    description: policy?.description ?? '',
    value: policy?.value ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      const payload: any = { ...form };
      if (form.type !== 'EMPLOYEE_PAY_PERIOD') delete payload.value;
      if (policy) {
        await api.put(`/clients/${clientId}/policies/${policy.id}`, payload);
      } else {
        await api.post(`/clients/${clientId}/policies`, payload);
      }
      onSaved();
    } catch (err: any) {
      setError(err?.response?.data?.error ?? 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 540 }}>
        <div className="modal-header">
          <h2 className="modal-title">{policy ? 'Edit Policy' : 'Add Policy'}</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="error-msg" style={{ marginBottom: 12 }}>{error}</div>}
            <div className="form-group" style={{ marginBottom: 12 }}>
              <label>Policy Type</label>
              <select className="form-control" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value, value: '' }))}>
                {POLICY_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            {form.type === 'EMPLOYEE_PAY_PERIOD' && (
              <div className="form-group" style={{ marginBottom: 12 }}>
                <label>Pay Period Type *</label>
                <select
                  className="form-control"
                  required
                  value={form.value}
                  onChange={e => setForm(f => ({ ...f, value: e.target.value }))}
                >
                  <option value="">— Select pay period —</option>
                  {PAY_PERIOD_VALUES.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
                </select>
                <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginTop: 4 }}>
                  How frequently this client's employees are paid
                </div>
              </div>
            )}
            <div className="form-group" style={{ marginBottom: 12 }}>
              <label>Title *</label>
              <input className="form-control" required value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Standard Work Hours Policy" />
            </div>
            <div className="form-group">
              <label>Details *</label>
              <textarea
                className="form-control"
                required
                rows={4}
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Describe the policy in full…"
              />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : policy ? 'Save Changes' : 'Add Policy'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

const BLANK: Partial<Client> = {
  name: '', address: '', contactName: '', contactEmail: '', contactPhone: '',
  servicesOffered: '', specificRequest: '', billingCycle: 'MONTHLY',
  billingDate: null, activeContract: true,
};

function ClientModal({ client, onClose, onSaved }: {
  client: Client | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<any>(client ?? { ...BLANK });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      if (client) {
        await api.put(`/clients/${client.id}`, form);
      } else {
        await api.post('/clients', form);
      }
      onSaved();
    } catch (err: any) {
      setError(err?.response?.data?.error ?? 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 600 }}>
        <div className="modal-header">
          <h2 className="modal-title">{client ? 'Edit Client' : 'New Client'}</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="error-msg" style={{ marginBottom: 12 }}>{error}</div>}

            <SectionLabel>Client Information</SectionLabel>
            <div className="form-grid form-grid-2" style={{ gap: 12 }}>
              <div className="form-group" style={{ gridColumn: '1/-1' }}>
                <label>Client Name *</label>
                <input className="form-control" required value={form.name} onChange={e => set('name', e.target.value)} />
              </div>
              <div className="form-group" style={{ gridColumn: '1/-1' }}>
                <label>Address</label>
                <input className="form-control" value={form.address ?? ''} onChange={e => set('address', e.target.value)} />
              </div>
              <div className="form-group" style={{ gridColumn: '1/-1' }}>
                <label>Services Offered</label>
                <input className="form-control" placeholder="e.g. IT Outsourcing, BPO" value={form.servicesOffered ?? ''} onChange={e => set('servicesOffered', e.target.value)} />
              </div>
              <div className="form-group" style={{ gridColumn: '1/-1' }}>
                <label>Specific Request / Notes</label>
                <textarea className="form-control" rows={2} value={form.specificRequest ?? ''} onChange={e => set('specificRequest', e.target.value)} />
              </div>
            </div>

            <SectionLabel>Main Contact Person</SectionLabel>
            <div className="form-grid form-grid-2" style={{ gap: 12 }}>
              <div className="form-group" style={{ gridColumn: '1/-1' }}>
                <label>Full Name</label>
                <input className="form-control" value={form.contactName ?? ''} onChange={e => set('contactName', e.target.value)} />
              </div>
              <div className="form-group">
                <label>Email Address</label>
                <input type="email" className="form-control" value={form.contactEmail ?? ''} onChange={e => set('contactEmail', e.target.value)} />
              </div>
              <div className="form-group">
                <label>Contact Number</label>
                <input className="form-control" value={form.contactPhone ?? ''} onChange={e => set('contactPhone', e.target.value)} />
              </div>
            </div>

            <SectionLabel>Billing</SectionLabel>
            <div className="form-grid form-grid-2" style={{ gap: 12 }}>
              <div className="form-group">
                <label>Billing Cycle</label>
                <select className="form-control" value={form.billingCycle ?? 'MONTHLY'} onChange={e => set('billingCycle', e.target.value)}>
                  <option value="WEEKLY">Weekly (every Monday)</option>
                  <option value="EVERY_15TH">Every 15th</option>
                  <option value="EVERY_30TH">Every 30th</option>
                  <option value="MONTHLY">Monthly (specific day)</option>
                </select>
              </div>
              {form.billingCycle === 'MONTHLY' && (
                <div className="form-group">
                  <label>Billing Day of Month</label>
                  <input
                    type="number" min={1} max={31} className="form-control"
                    value={form.billingDate ?? ''}
                    onChange={e => set('billingDate', e.target.value ? parseInt(e.target.value) : null)}
                    placeholder="e.g. 1"
                  />
                </div>
              )}
              <div className="form-group">
                <label>Contract Status</label>
                <select className="form-control" value={form.activeContract ? 'true' : 'false'} onChange={e => set('activeContract', e.target.value === 'true')}>
                  <option value="true">Active Contract</option>
                  <option value="false">Inactive / Ended</option>
                </select>
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : client ? 'Save Changes' : 'Create Client'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10, marginTop: 20 }}>
      {children}
    </div>
  );
}
