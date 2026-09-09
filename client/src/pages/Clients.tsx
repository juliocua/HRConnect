import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { type ColumnDef } from '@tanstack/react-table';
import api from '@/lib/api';
import { DataTable } from '@/components/DataTable';
import type { Client, BillingCycle } from '@/types';

const CYCLE_LABELS: Record<BillingCycle, string> = {
  WEEKLY: 'Weekly',
  EVERY_15TH: 'Every 15th',
  EVERY_30TH: 'Every 30th',
  MONTHLY: 'Monthly',
};

const PAY_PERIOD_LABELS: Record<number, string> = {
  1: 'Semi-monthly (1st/2nd)',
  2: 'Semi-monthly (2nd)',
  7: 'Special Pay',
  9: '13th Month Only',
};

const BLANK: Partial<Client> = {
  name: '', address: '', contactName: '', contactEmail: '', contactPhone: '',
  servicesOffered: '', specificRequest: '', billingCycle: 'MONTHLY',
  billingDate: null, activeContract: true,
  adminFeeRate: null, isVatable: false, hasEwt: false, billingTerms: '',
};

export default function Clients() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);

  const { data: clients = [], isLoading } = useQuery<Client[]>({
    queryKey: ['clients'],
    queryFn: () => api.get('/clients').then(r => r.data),
  });

  const openNew = () => { setEditing(null); setShowModal(true); };
  const openEdit = (c: Client, e: React.MouseEvent) => { e.stopPropagation(); setEditing(c); setShowModal(true); };

  const columns = useMemo<ColumnDef<Client>[]>(() => [
    {
      id: 'name',
      accessorFn: row => row.name,
      header: 'Client',
      cell: ({ row: { original: c } }) => (
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{c.name}</div>
          {c.address && <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{c.address}</div>}
        </div>
      ),
    },
    {
      id: 'contact',
      accessorFn: row => `${row.contactName ?? ''} ${row.contactEmail ?? ''}`.trim(),
      header: 'Contact',
      cell: ({ row: { original: c } }) => (
        <div>
          {c.contactName && <div style={{ fontSize: 13, fontWeight: 600 }}>{c.contactName}</div>}
          {c.contactEmail && <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{c.contactEmail}</div>}
          {c.contactPhone && <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{c.contactPhone}</div>}
        </div>
      ),
    },
    {
      id: 'billing',
      accessorFn: row => CYCLE_LABELS[row.billingCycle],
      header: 'Billing',
      cell: ({ row: { original: c } }) => (
        <div>
          <span style={{ fontSize: 13 }}>{CYCLE_LABELS[c.billingCycle]}</span>
          {c.billingDate && c.billingCycle === 'MONTHLY' && (
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Day {c.billingDate}</div>
          )}
          {c.adminFeeRate != null && (
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{c.adminFeeRate}% admin fee</div>
          )}
          <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
            {c.isVatable && <span className="badge badge-blue" style={{ fontSize: 10 }}>VAT</span>}
            {c.hasEwt && <span className="badge badge-yellow" style={{ fontSize: 10 }}>EWT</span>}
          </div>
        </div>
      ),
    },
    {
      id: 'resources',
      accessorFn: row => row._count?.employees ?? 0,
      header: 'Resources',
      cell: ({ getValue }) => (
        <span>
          <strong>{getValue() as number}</strong>
          <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}> deployed</span>
        </span>
      ),
    },
    {
      accessorKey: 'activeContract',
      header: 'Status',
      cell: ({ getValue }) => {
        const active = getValue() as boolean;
        return <span className={`badge ${active ? 'badge-green' : 'badge-gray'}`}>{active ? 'Active' : 'Inactive'}</span>;
      },
    },
    {
      id: 'actions',
      header: '',
      enableSorting: false,
      cell: ({ row: { original: c } }) => (
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn btn-ghost btn-sm" onClick={e => openEdit(c, e)}>Edit</button>
        </div>
      ),
    },
  ], [navigate]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Client Records</h1>
          <p className="page-desc">Companies where your employees are deployed</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <a href="/import?type=client" className="btn btn-ghost">⬆ Import CSV</a>
          <button className="btn btn-primary" onClick={openNew}>+ New Client</button>
        </div>
      </div>

      {isLoading ? (
        <div className="loading-center"><div className="spinner" /></div>
      ) : clients.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🏢</div>
          <div className="empty-state-title">No clients yet</div>
          <div>Add your first client record to get started</div>
        </div>
      ) : (
        <div className="card">
          <DataTable
            data={clients}
            columns={columns}
            globalFilterPlaceholder="Search clients…"
            exportFilename="Clients"
            onRowClick={c => navigate(`/clients/${c.id}`)}
          />
        </div>
      )}

      {showModal && (
        <ClientModal
          client={editing}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); qc.invalidateQueries({ queryKey: ['clients'] }); }}
        />
      )}
    </div>
  );
}

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
      <div className="modal" style={{ maxWidth: 620 }}>
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

            <SectionLabel>Billing & Rates</SectionLabel>
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
                <label>Admin Fee Rate (%)</label>
                <input
                  type="number" min={0} max={100} step={0.01} className="form-control"
                  placeholder="e.g. 15.00"
                  value={form.adminFeeRate ?? ''}
                  onChange={e => set('adminFeeRate', e.target.value ? parseFloat(e.target.value) : null)}
                />
              </div>
              <div className="form-group">
                <label>Billing Terms</label>
                <input
                  className="form-control"
                  placeholder="e.g. Net 30, Due on receipt"
                  value={form.billingTerms ?? ''}
                  onChange={e => set('billingTerms', e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Tax Flags</label>
                <div style={{ display: 'flex', gap: 16, paddingTop: 6 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 14 }}>
                    <input type="checkbox" checked={form.isVatable ?? false} onChange={e => set('isVatable', e.target.checked)} />
                    VATable (12% VAT)
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 14 }}>
                    <input type="checkbox" checked={form.hasEwt ?? false} onChange={e => set('hasEwt', e.target.checked)} />
                    Subject to EWT
                  </label>
                </div>
              </div>
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
