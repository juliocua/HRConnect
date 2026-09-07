import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import type { Client, BillingCycle } from '@/types';

const CYCLE_LABELS: Record<BillingCycle, string> = {
  WEEKLY: 'Weekly',
  EVERY_15TH: 'Every 15th',
  EVERY_30TH: 'Every 30th',
  MONTHLY: 'Monthly',
};

const BLANK: Partial<Client> = {
  name: '', address: '', contactName: '', contactEmail: '', contactPhone: '',
  servicesOffered: '', specificRequest: '', billingCycle: 'MONTHLY',
  billingDate: null, activeContract: true,
};

export default function Clients() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);

  const { data: clients = [], isLoading } = useQuery<Client[]>({
    queryKey: ['clients'],
    queryFn: () => api.get('/clients').then(r => r.data),
  });

  const filtered = clients.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.contactName ?? '').toLowerCase().includes(search.toLowerCase())
  );

  const openNew = () => { setEditing(null); setShowModal(true); };
  const openEdit = (c: Client, e: React.MouseEvent) => { e.stopPropagation(); setEditing(c); setShowModal(true); };

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

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="filter-bar">
          <input
            className="form-control"
            placeholder="Search clients…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ maxWidth: 300 }}
          />
          <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
            {filtered.length} client{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {isLoading ? (
        <div className="loading-center"><div className="spinner" /></div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🏢</div>
          <div className="empty-state-title">{search ? 'No clients found' : 'No clients yet'}</div>
          {!search && <div>Add your first client record to get started</div>}
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Client</th>
                <th>Contact</th>
                <th>Billing Cycle</th>
                <th>Resources</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr
                  key={c.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/clients/${c.id}`)}
                >
                  <td>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{c.name}</div>
                    {c.address && <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{c.address}</div>}
                  </td>
                  <td>
                    {c.contactName && <div style={{ fontSize: 13, fontWeight: 600 }}>{c.contactName}</div>}
                    {c.contactEmail && <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{c.contactEmail}</div>}
                    {c.contactPhone && <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{c.contactPhone}</div>}
                  </td>
                  <td>
                    <span style={{ fontSize: 13 }}>{CYCLE_LABELS[c.billingCycle]}</span>
                    {c.billingDate && c.billingCycle === 'MONTHLY' && (
                      <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Day {c.billingDate}</div>
                    )}
                  </td>
                  <td>
                    <span style={{ fontWeight: 700 }}>{c._count?.employees ?? 0}</span>
                    <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}> deployed</span>
                  </td>
                  <td>
                    <span className={`badge ${c.activeContract ? 'badge-green' : 'badge-gray'}`}>
                      {c.activeContract ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>
                    <button className="btn btn-ghost btn-sm" onClick={e => openEdit(c, e)}>Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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