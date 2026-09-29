import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { canWrite } from '@/lib/permissions';
import { formatPHP } from '@/lib/payroll';
import type { ClearanceItem, LastPayEmployee } from '@/types';

type LPTab = 'clearance' | 'tracking';

export default function LastPay() {
  const { user } = useAuth();
  const isWriter = canWrite(user?.role, 'lastPay');
  const [tab, setTab] = useState<LPTab>('clearance');

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>Last Pay</h1>
        <p style={{ fontSize: 14, color: 'var(--color-text-muted)', marginTop: 4 }}>
          Manage clearance requirements and track last pay for separated employees
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 2, borderBottom: '2px solid var(--color-border)', marginBottom: 24 }}>
        {([
          { key: 'clearance', label: '📋 Clearance Setup' },
          { key: 'tracking', label: '👥 Employee Tracking' },
        ] as { key: LPTab; label: string }[]).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              background: 'none',
              border: 'none',
              borderBottom: tab === t.key ? '2px solid var(--color-primary)' : '2px solid transparent',
              marginBottom: -2,
              padding: '10px 20px',
              fontWeight: tab === t.key ? 700 : 500,
              fontSize: 14,
              color: tab === t.key ? 'var(--color-primary)' : 'var(--color-text-secondary)',
              cursor: 'pointer',
              transition: 'color 0.12s, border-color 0.12s',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'clearance' && <ClearanceSetupTab isWriter={isWriter} />}
      {tab === 'tracking' && <EmployeeTrackingTab isWriter={isWriter} />}
    </div>
  );
}

// ── Clearance Setup Tab ───────────────────────────────────────────────────────

function ClearanceSetupTab({ isWriter }: { isWriter: boolean }) {
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState<ClearanceItem | null>(null);

  const { data: items = [], isLoading } = useQuery<ClearanceItem[]>({
    queryKey: ['clearanceItems'],
    queryFn: () => api.get('/last-pay/clearance-items').then(r => r.data),
  });

  const deleteItem = useMutation({
    mutationFn: (id: string) => api.delete(`/last-pay/clearance-items/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clearanceItems'] }),
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.put(`/last-pay/clearance-items/${id}`, { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clearanceItems'] }),
  });

  if (isLoading) return <div className="loading-center"><div className="spinner" /></div>;

  const active = items.filter(i => i.isActive);
  const inactive = items.filter(i => !i.isActive);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Clearance Requirements</div>
          <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 2 }}>
            Define items employees must clear before last pay is released. New items are automatically added to all currently tracked employees.
          </div>
        </div>
        {isWriter && (
          <button
            className="btn btn-primary"
            onClick={() => { setEditingItem(null); setShowModal(true); }}
          >
            + Add Item
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📋</div>
          <div className="empty-state-title">No clearance items yet</div>
          <div>Add items like "Company ID returned", "Equipment returned", "Final report submitted"</div>
        </div>
      ) : (
        <>
          {active.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>
                Active ({active.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {active.map((item, idx) => (
                  <div
                    key={item.id}
                    className="card"
                    style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}
                  >
                    <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--color-primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                      {idx + 1}
                    </div>
                    <div style={{ flex: 1, fontWeight: 600, fontSize: 14 }}>{item.name}</div>
                    {isWriter && (
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => { setEditingItem(item); setShowModal(true); }}
                        >
                          Edit
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ color: 'var(--color-text-muted)' }}
                          disabled={toggleActive.isPending}
                          onClick={() => toggleActive.mutate({ id: item.id, isActive: false })}
                        >
                          Disable
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ color: 'var(--color-danger)' }}
                          disabled={deleteItem.isPending}
                          onClick={() => {
                            if (confirm(`Delete "${item.name}"? This will also remove it from all employee clearances.`))
                              deleteItem.mutate(item.id);
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {inactive.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>
                Disabled ({inactive.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {inactive.map(item => (
                  <div
                    key={item.id}
                    className="card"
                    style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, opacity: 0.6 }}
                  >
                    <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0 }}>
                      —
                    </div>
                    <div style={{ flex: 1, fontSize: 14 }}>{item.name}</div>
                    {isWriter && (
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        <button
                          className="btn btn-ghost btn-sm"
                          disabled={toggleActive.isPending}
                          onClick={() => toggleActive.mutate({ id: item.id, isActive: true })}
                        >
                          Re-enable
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ color: 'var(--color-danger)' }}
                          disabled={deleteItem.isPending}
                          onClick={() => {
                            if (confirm(`Delete "${item.name}"?`)) deleteItem.mutate(item.id);
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {showModal && (
        <ClearanceItemModal
          item={editingItem}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); qc.invalidateQueries({ queryKey: ['clearanceItems'] }); }}
        />
      )}
    </div>
  );
}

// ── Employee Tracking Tab ──────────────────────────────────────────────────────

function EmployeeTrackingTab({ isWriter }: { isWriter: boolean }) {
  const qc = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: employees = [], isLoading } = useQuery<LastPayEmployee[]>({
    queryKey: ['lastPayEmployees'],
    queryFn: () => api.get('/last-pay/employees').then(r => r.data),
  });

  const toggleClearance = useMutation({
    mutationFn: ({ clearanceId, isCleared }: { clearanceId: string; isCleared: boolean }) =>
      api.put(`/last-pay/clearances/${clearanceId}`, { isCleared }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lastPayEmployees'] }),
  });

  if (isLoading) return <div className="loading-center"><div className="spinner" /></div>;

  if (employees.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">👥</div>
        <div className="empty-state-title">No employees in last pay tracking</div>
        <div>Employees with a separation date within any Type 10 payroll run will appear here</div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 16, fontSize: 13, color: 'var(--color-text-muted)' }}>
        {employees.length} employee{employees.length !== 1 ? 's' : ''} in last pay tracking
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {employees.map(emp => {
          const cleared = emp.clearances.filter(c => c.isCleared).length;
          const total = emp.clearances.length;
          const allCleared = total > 0 && cleared === total;
          const isExpanded = expandedId === emp.id;

          return (
            <div key={emp.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
              {/* Employee header row */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '14px 16px',
                  cursor: 'pointer',
                  background: isExpanded ? 'var(--color-surface-2)' : 'transparent',
                  transition: 'background 0.12s',
                }}
                onClick={() => setExpandedId(id => id === emp.id ? null : emp.id)}
              >
                {/* Avatar */}
                <div
                  className="emp-avatar"
                  style={{ background: emp.avatarColor ?? '#6366F1', width: 40, height: 40, fontSize: 15, flexShrink: 0 }}
                >
                  {emp.firstName[0]}{emp.lastName[0]}
                </div>

                {/* Name + meta */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{emp.firstName} {emp.lastName}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                    {emp.position} · {emp.client?.name ?? '—'}
                    {emp.separationDate && (
                      <span style={{ marginLeft: 8 }}>
                        · Separated: {new Date(emp.separationDate).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' })}
                      </span>
                    )}
                  </div>
                </div>

                {/* Clearance progress */}
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: allCleared ? 'var(--color-success)' : 'var(--color-text-secondary)' }}>
                    {cleared}/{total} cleared
                  </div>
                  {allCleared && (
                    <span className="badge badge-green" style={{ fontSize: 11 }}>✓ Fully Cleared</span>
                  )}
                  {!allCleared && total > 0 && (
                    <span className="badge badge-yellow" style={{ fontSize: 11 }}>Pending</span>
                  )}
                  {total === 0 && (
                    <span className="badge badge-gray" style={{ fontSize: 11 }}>No items</span>
                  )}
                </div>

                <span style={{ fontSize: 10, color: 'var(--color-text-muted)', marginLeft: 4 }}>
                  {isExpanded ? '▼' : '▶'}
                </span>
              </div>

              {/* Expanded: clearance checklist + pay breakdown */}
              {isExpanded && (
                <div style={{ borderTop: '1px solid var(--color-border)', padding: '16px' }}>
                  <div className="grid-2" style={{ gap: 20 }}>
                    {/* Clearance checklist */}
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>
                        Clearance Checklist
                      </div>
                      {emp.clearances.length === 0 ? (
                        <div style={{ fontSize: 13, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                          No clearance items configured yet
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {emp.clearances.map(c => (
                            <div
                              key={c.id}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 10,
                                padding: '8px 12px',
                                borderRadius: 8,
                                background: c.isCleared ? 'rgba(34,197,94,0.07)' : 'var(--color-surface-2)',
                                border: `1px solid ${c.isCleared ? 'rgba(34,197,94,0.2)' : 'var(--color-border)'}`,
                              }}
                            >
                              {isWriter ? (
                                <input
                                  type="checkbox"
                                  checked={c.isCleared}
                                  disabled={toggleClearance.isPending}
                                  onChange={e => toggleClearance.mutate({ clearanceId: c.id, isCleared: e.target.checked })}
                                  style={{ width: 16, height: 16, accentColor: 'var(--color-success)', cursor: 'pointer', flexShrink: 0 }}
                                />
                              ) : (
                                <span style={{ fontSize: 16, flexShrink: 0 }}>{c.isCleared ? '✅' : '⬜'}</span>
                              )}
                              <div style={{ flex: 1 }}>
                                <div style={{
                                  fontSize: 13,
                                  fontWeight: 600,
                                  textDecoration: c.isCleared ? 'line-through' : 'none',
                                  color: c.isCleared ? 'var(--color-text-muted)' : 'var(--color-text)',
                                }}>
                                  {c.name}
                                </div>
                                {c.isCleared && c.clearedAt && (
                                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 1 }}>
                                    Cleared {new Date(c.clearedAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Pay breakdown */}
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>
                        Last Pay Breakdown
                      </div>
                      {emp.lastPayRecord ? (
                        <LastPayBreakdown record={emp.lastPayRecord} />
                      ) : (
                        <div style={{ fontSize: 13, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                          No payroll run processed yet for this employee
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Last Pay Breakdown ────────────────────────────────────────────────────────

function LastPayBreakdown({ record }: { record: NonNullable<LastPayEmployee['lastPayRecord']> }) {
  const rows: { label: string; value: number; type: 'earning' | 'deduction' | 'net' }[] = [
    { label: 'Remaining Salary Days', value: record.basicSalary, type: 'earning' },
    { label: 'Pro-rated 13th Month', value: record.thirteenthMonthPay ?? 0, type: 'earning' },
    { label: 'SIL Conversion', value: record.silConversion ?? 0, type: 'earning' },
    { label: 'SSS Deduction', value: record.sssContrib, type: 'deduction' },
    { label: 'PhilHealth', value: record.philhealthContrib, type: 'deduction' },
    { label: 'Pag-IBIG', value: record.pagibigContrib, type: 'deduction' },
    { label: 'Withholding Tax', value: record.withholdingTax, type: 'deduction' },
    { label: 'Loan / Other Deductions', value: record.otherDeductions ?? 0, type: 'deduction' },
    { label: 'Net Last Pay', value: record.netPay, type: 'net' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {rows.map(row => {
        if (row.value === 0 && row.type !== 'net') return null;
        return (
          <div
            key={row.label}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '6px 10px',
              borderRadius: row.type === 'net' ? 6 : 4,
              background: row.type === 'net'
                ? 'var(--color-primary)'
                : row.type === 'deduction'
                  ? 'rgba(239,68,68,0.06)'
                  : 'rgba(34,197,94,0.06)',
              marginTop: row.type === 'net' ? 8 : 0,
            }}
          >
            <span style={{
              fontSize: 12,
              color: row.type === 'net' ? '#fff' : row.type === 'deduction' ? 'var(--color-danger)' : 'var(--color-text-secondary)',
              fontWeight: row.type === 'net' ? 700 : 400,
            }}>
              {row.type === 'deduction' ? '− ' : row.type === 'earning' ? '+ ' : ''}{row.label}
            </span>
            <span style={{
              fontSize: 13,
              fontWeight: 700,
              color: row.type === 'net' ? '#fff' : row.type === 'deduction' ? 'var(--color-danger)' : 'inherit',
              fontFamily: 'monospace',
            }}>
              {formatPHP(row.value)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Clearance Item Modal ──────────────────────────────────────────────────────

function ClearanceItemModal({ item, onClose, onSaved }: {
  item: ClearanceItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(item?.name ?? '');
  const [order, setOrder] = useState(item?.order ?? 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('Name is required'); return; }
    setSaving(true); setError('');
    try {
      if (item) {
        await api.put(`/last-pay/clearance-items/${item.id}`, { name: name.trim(), order });
      } else {
        await api.post('/last-pay/clearance-items', { name: name.trim(), order });
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
      <div className="modal" style={{ maxWidth: 440 }}>
        <div className="modal-header">
          <h2 className="modal-title">{item ? 'Edit Clearance Item' : 'Add Clearance Item'}</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="error-msg" style={{ marginBottom: 12 }}>{error}</div>}
            <div className="form-group" style={{ marginBottom: 14 }}>
              <label>Item Name *</label>
              <input
                className="form-control"
                required
                placeholder="e.g. Company ID returned, Laptop returned"
                value={name}
                onChange={e => setName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="form-group">
              <label>Display Order</label>
              <input
                className="form-control"
                type="number"
                min={0}
                value={order}
                onChange={e => setOrder(Number(e.target.value))}
                style={{ width: 100 }}
              />
              <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginTop: 4 }}>
                Lower numbers appear first. Use 0 for default ordering.
              </div>
            </div>
            {!item && (
              <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 8, background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.2)', fontSize: 12, color: 'var(--color-text-secondary)' }}>
                ℹ️ This item will automatically be added to all employees currently being tracked in last pay runs, marked as uncleared.
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : item ? 'Save Changes' : 'Add Item'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
