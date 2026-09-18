import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { useToast } from '@/lib/toast';
import { formatPHP } from '@/lib/payroll';

type ExpenseCategory = { id: string; name: string; isActive: boolean };
type ExpenseRequest = {
  id: string;
  description: string;
  amount: number;
  receiptUrl: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejectionNote: string | null;
  approvedAt: string | null;
  createdAt: string;
  category: ExpenseCategory | null;
  employee: { id: string; firstName: string; lastName: string; client: { id: string; name: string } | null };
  approvedBy: { firstName: string; lastName: string } | null;
  payrollRecord: { id: string; payrollRun: { periodStart: string; periodEnd: string } } | null;
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

const STATUS_BADGE: Record<ExpenseRequest['status'], string> = {
  PENDING: 'badge-yellow',
  APPROVED: 'badge-green',
  REJECTED: 'badge-red',
};

function RejectModal({ expense, onClose, onRejected }: {
  expense: ExpenseRequest;
  onClose: () => void;
  onRejected: () => void;
}) {
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  const handleReject = async () => {
    setLoading(true);
    try {
      await api.patch(`/expenses/${expense.id}/reject`, { rejectionNote: note });
      toast('success', 'Expense rejected');
      onRejected();
      onClose();
    } catch {
      toast('error', 'Failed to reject expense');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Reject Expense</div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <p style={{ marginBottom: 12, fontSize: 14 }}>
            Rejecting <strong>{expense.employee.firstName} {expense.employee.lastName}</strong>'s expense of{' '}
            <strong>{formatPHP(expense.amount)}</strong> — {expense.description}
          </p>
          <div className="form-group">
            <label>Rejection reason (optional)</label>
            <textarea
              className="form-control"
              rows={3}
              placeholder="Explain why this is being rejected…"
              value={note}
              onChange={e => setNote(e.target.value)}
            />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-danger" onClick={handleReject} disabled={loading}>
            {loading ? 'Rejecting…' : 'Reject Expense'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Expenses() {
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<'requests' | 'history' | 'categories'>('requests');
  const [rejectTarget, setRejectTarget] = useState<ExpenseRequest | null>(null);

  // Category management state
  const [newCatName, setNewCatName] = useState('');
  const [addingCat, setAddingCat] = useState(false);

  const { data: expenses = [], isLoading } = useQuery<ExpenseRequest[]>({
    queryKey: ['expenses-all'],
    queryFn: () => api.get('/expenses').then(r => r.data),
  });

  const { data: categories = [], isLoading: catsLoading } = useQuery<ExpenseCategory[]>({
    queryKey: ['expense-categories-all'],
    queryFn: () => api.get('/expenses/categories/all').then(r => r.data),
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/expenses/${id}/approve`),
    onSuccess: () => {
      toast('success', 'Expense approved');
      qc.invalidateQueries({ queryKey: ['expenses-all'] });
    },
    onError: () => toast('error', 'Failed to approve'),
  });

  const toggleCatMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch(`/expenses/categories/${id}`, { isActive }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expense-categories-all'] });
      qc.invalidateQueries({ queryKey: ['expense-categories'] });
    },
    onError: () => toast('error', 'Failed to update category'),
  });

  const addCatMutation = useMutation({
    mutationFn: (name: string) => api.post('/expenses/categories', { name }),
    onSuccess: () => {
      toast('success', 'Category added');
      setNewCatName('');
      setAddingCat(false);
      qc.invalidateQueries({ queryKey: ['expense-categories-all'] });
      qc.invalidateQueries({ queryKey: ['expense-categories'] });
    },
    onError: () => toast('error', 'Failed to add category'),
  });

  const pending = expenses.filter(e => e.status === 'PENDING');
  const history = expenses.filter(e => e.status !== 'PENDING');

  const ExpenseTable = ({ rows }: { rows: ExpenseRequest[] }) => (
    rows.length === 0 ? (
      <div className="empty-state" style={{ padding: '40px 0' }}>
        <div className="empty-state-icon">🧾</div>
        <div>No expense requests</div>
      </div>
    ) : (
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Employee</th>
              <th>Client</th>
              <th>Category</th>
              <th>Description</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Receipt</th>
              {tab === 'requests' && <th>Actions</th>}
              {tab === 'history' && <th>Processed</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map(exp => (
              <tr key={exp.id}>
                <td style={{ fontSize: 13, whiteSpace: 'nowrap' }}>{fmtDate(exp.createdAt)}</td>
                <td style={{ fontWeight: 600 }}>{exp.employee.firstName} {exp.employee.lastName}</td>
                <td style={{ fontSize: 13 }}>{exp.employee.client?.name ?? '—'}</td>
                <td style={{ fontSize: 13 }}>{exp.category?.name ?? '—'}</td>
                <td style={{ maxWidth: 180, fontSize: 13 }}>{exp.description}</td>
                <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{formatPHP(exp.amount)}</td>
                <td>
                  <span className={`badge ${STATUS_BADGE[exp.status]}`}>{exp.status}</span>
                </td>
                <td>
                  {exp.receiptUrl ? (
                    <a
                      href={`${import.meta.env.VITE_API_URL ?? ''}${exp.receiptUrl}`}
                      target="_blank"
                      rel="noreferrer"
                      className="btn btn-ghost btn-sm"
                      style={{ fontSize: 11, textDecoration: 'none' }}
                    >
                      🖼 View
                    </a>
                  ) : '—'}
                </td>
                {tab === 'requests' && (
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        className="btn btn-success btn-sm"
                        style={{ fontSize: 11 }}
                        disabled={approveMutation.isPending}
                        onClick={() => approveMutation.mutate(exp.id)}
                      >
                        ✓ Approve
                      </button>
                      <button
                        className="btn btn-danger-outline btn-sm"
                        style={{ fontSize: 11 }}
                        onClick={() => setRejectTarget(exp)}
                      >
                        ✕ Reject
                      </button>
                    </div>
                  </td>
                )}
                {tab === 'history' && (
                  <td style={{ fontSize: 12 }}>
                    {exp.approvedAt ? fmtDate(exp.approvedAt) : '—'}
                    {exp.approvedBy && (
                      <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                        by {exp.approvedBy.firstName} {exp.approvedBy.lastName}
                      </div>
                    )}
                    {exp.status === 'REJECTED' && exp.rejectionNote && (
                      <div style={{ fontSize: 11, color: 'var(--color-danger)', marginTop: 2 }}>
                        {exp.rejectionNote}
                      </div>
                    )}
                    {exp.status === 'APPROVED' && exp.payrollRecord && (
                      <div style={{ fontSize: 11, color: 'var(--color-success)', marginTop: 2 }}>
                        Added to payroll
                      </div>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Expense Reimbursements</h1>
          <p className="page-desc">Review and approve employee expense requests</p>
        </div>
      </div>

      <div style={{ border: '1px solid var(--color-border)', borderRadius: 12, overflow: 'hidden', background: 'var(--color-surface)' }}>
        {/* Tabs */}
        <div style={{ padding: '12px 20px 0', background: 'var(--color-surface-2)', borderBottom: '1px solid var(--color-border)', display: 'flex', gap: 2 }}>
          {(['requests', 'history', 'categories'] as const).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              style={{
                background: tab === t ? 'var(--color-primary)' : 'transparent',
                border: tab === t ? 'none' : '1px solid var(--color-border)',
                borderRadius: '6px 6px 0 0',
                padding: '7px 16px',
                fontSize: 13,
                fontWeight: tab === t ? 700 : 500,
                color: tab === t ? '#fff' : 'var(--color-text-secondary)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {t === 'requests' ? 'Requests' : t === 'history' ? 'History' : 'Categories'}
              {t === 'requests' && pending.length > 0 && (
                <span style={{
                  background: tab === t ? 'rgba(255,255,255,0.25)' : 'var(--color-primary)',
                  color: '#fff', borderRadius: 999, fontSize: 10, padding: '1px 7px', fontWeight: 700,
                }}>
                  {pending.length}
                </span>
              )}
            </button>
          ))}
        </div>

        <div style={{ padding: 24 }}>
          {/* Requests tab */}
          {tab === 'requests' && (
            <div>
              <div className="card-header" style={{ marginBottom: 16 }}>
                <div className="card-title">Pending Requests</div>
              </div>
              {isLoading ? (
                <div className="loading-center" style={{ padding: 32 }}><div className="spinner" /></div>
              ) : (
                <ExpenseTable rows={pending} />
              )}
            </div>
          )}

          {/* History tab */}
          {tab === 'history' && (
            <div>
              <div className="card-header" style={{ marginBottom: 16 }}>
                <div className="card-title">All Expenses</div>
              </div>
              {isLoading ? (
                <div className="loading-center" style={{ padding: 32 }}><div className="spinner" /></div>
              ) : (
                <ExpenseTable rows={expenses} />
              )}
            </div>
          )}

          {/* Categories tab */}
          {tab === 'categories' && (
            <div>
              <div className="card-header" style={{ marginBottom: 16 }}>
                <div className="card-title">Expense Categories</div>
                <button className="btn btn-primary btn-sm" onClick={() => setAddingCat(true)}>+ Add Category</button>
              </div>

              {addingCat && (
                <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
                  <input
                    type="text"
                    className="form-control"
                    style={{ maxWidth: 280 }}
                    placeholder="Category name"
                    value={newCatName}
                    autoFocus
                    onChange={e => setNewCatName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') addCatMutation.mutate(newCatName); if (e.key === 'Escape') setAddingCat(false); }}
                  />
                  <button className="btn btn-primary btn-sm" onClick={() => addCatMutation.mutate(newCatName)} disabled={!newCatName.trim() || addCatMutation.isPending}>
                    Save
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => { setAddingCat(false); setNewCatName(''); }}>Cancel</button>
                </div>
              )}

              {catsLoading ? (
                <div className="loading-center" style={{ padding: 32 }}><div className="spinner" /></div>
              ) : categories.length === 0 ? (
                <div className="empty-state" style={{ padding: '32px 0' }}>
                  <div className="empty-state-icon">🏷️</div>
                  <div>No categories yet — add one above</div>
                </div>
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Category Name</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {categories.map(cat => (
                        <tr key={cat.id}>
                          <td style={{ fontWeight: 600 }}>{cat.name}</td>
                          <td>
                            <span className={`badge ${cat.isActive ? 'badge-green' : 'badge-red'}`}>
                              {cat.isActive ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td>
                            <button
                              className={`btn btn-sm ${cat.isActive ? 'btn-danger-outline' : 'btn-success'}`}
                              style={{ fontSize: 11 }}
                              disabled={toggleCatMutation.isPending}
                              onClick={() => toggleCatMutation.mutate({ id: cat.id, isActive: !cat.isActive })}
                            >
                              {cat.isActive ? 'Deactivate' : 'Activate'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {rejectTarget && (
        <RejectModal
          expense={rejectTarget}
          onClose={() => setRejectTarget(null)}
          onRejected={() => qc.invalidateQueries({ queryKey: ['expenses-all'] })}
        />
      )}
    </div>
  );
}
