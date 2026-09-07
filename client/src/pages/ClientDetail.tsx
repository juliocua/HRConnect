import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { formatPHP } from '@/lib/payroll';
import type { Client, ClientPolicy, Billing, BillingCycle } from '@/types';

const CYCLE_LABELS: Record<BillingCycle, string> = {
  WEEKLY: 'Weekly', EVERY_15TH: 'Every 15th',
  EVERY_30TH: 'Every 30th', MONTHLY: 'Monthly',
};

const POLICY_TYPES = [
  { value: 'WORK_HOURS', label: 'Work Hours' },
  { value: 'ATTENDANCE', label: 'Attendance Policy' },
  { value: 'DRESS_CODE', label: 'Dress Code' },
  { value: 'CONFIDENTIALITY', label: 'Confidentiality / NDA' },
  { value: 'DATA_PRIVACY', label: 'Data Privacy' },
  { value: 'TOOLS', label: 'Allowed Tools / Devices' },
  { value: 'REPORTING', label: 'Reporting Requirements' },
  { value: 'OTHER', label: 'Other' },
];

type Tab = 'overview' | 'policies' | 'billing';

export default function ClientDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('overview');
  const [showPolicyModal, setShowPolicyModal] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<ClientPolicy | null>(null);

  const { data: client, isLoading } = useQuery<Client>({
    queryKey: ['client', id],
    queryFn: () => api.get(`/clients/${id}`).then(r => r.data),
    enabled: !!id,
  });

  const markPaid = useMutation({
    mutationFn: (billingId: string) => api.put(`/billing/${billingId}/mark-paid`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['client', id] }),
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
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 6, fontSize: 13, color: 'var(--color-text-muted)' }}>
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
                  <div key={e.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
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
              <table>
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
                                disabled={markPaid.isPending}
                                onClick={() => { if (confirm('Mark this bill as paid?')) markPaid.mutate(b.id); }}
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
    </div>
  );
}

function PolicyModal({ clientId, policy, onClose, onSaved }: {
  clientId: string;
  policy: ClientPolicy | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    type: policy?.type ?? 'WORK_HOURS',
    title: policy?.title ?? '',
    description: policy?.description ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      if (policy) {
        await api.put(`/clients/${clientId}/policies/${policy.id}`, form);
      } else {
        await api.post(`/clients/${clientId}/policies`, form);
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
              <select className="form-control" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                {POLICY_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 12 }}>
              <label>Title *</label>
              <input className="form-control" required value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Standard Work Hours Policy" />
            </div>
            <div className="form-group">
              <label>Details *</label>
              <textarea
                className="form-control"
                required
                rows={5}
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