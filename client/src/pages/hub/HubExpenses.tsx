import React, { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { useToast } from '@/lib/toast';
import { formatPHP } from '@/lib/payroll';

type ExpenseCategory = { id: string; name: string };
type ExpenseRequest = {
  id: string;
  categoryId: string | null;
  category: ExpenseCategory | null;
  description: string;
  amount: number;
  receiptUrl: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejectionNote: string | null;
  approvedAt: string | null;
  approvedBy: { firstName: string; lastName: string } | null;
  payrollRecord: { id: string; payrollRun: { periodStart: string; periodEnd: string } } | null;
  createdAt: string;
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

const STATUS_BADGE: Record<ExpenseRequest['status'], string> = {
  PENDING: 'badge-yellow',
  APPROVED: 'badge-green',
  REJECTED: 'badge-red',
};

export default function HubExpenses() {
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const catRef = useRef<HTMLDivElement>(null);

  const [form, setForm] = useState({ categoryId: '', description: '', amount: '' });
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [catOpen, setCatOpen] = useState(false);
  const [catSearch, setCatSearch] = useState('');

  const { data: categories = [] } = useQuery<ExpenseCategory[]>({
    queryKey: ['expense-categories'],
    queryFn: () => api.get('/expenses/categories').then(r => r.data),
  });

  const { data: expenses = [], isLoading } = useQuery<ExpenseRequest[]>({
    queryKey: ['my-expenses'],
    queryFn: () => api.get('/expenses').then(r => r.data),
  });

  // Close category combobox when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (catRef.current && !catRef.current.contains(e.target as Node)) {
        setCatOpen(false);
        setCatSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selectedCat = categories.find(c => c.id === form.categoryId) ?? null;
  const filteredCats = catSearch.trim()
    ? categories.filter(c => c.name.toLowerCase().includes(catSearch.toLowerCase()))
    : categories;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.description.trim()) return toast('error', 'Description is required');
    if (!form.amount || isNaN(Number(form.amount)) || Number(form.amount) <= 0) return toast('error', 'Enter a valid amount');
    if (!file) return toast('error', 'Receipt is required');

    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('description', form.description.trim());
      fd.append('amount', form.amount);
      if (form.categoryId) fd.append('categoryId', form.categoryId);
      fd.append('receipt', file);

      await api.post('/expenses', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast('success', 'Expense submitted');
      setForm({ categoryId: '', description: '', amount: '' });
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      qc.invalidateQueries({ queryKey: ['my-expenses'] });
    } catch {
      toast('error', 'Failed to submit expense');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Expense Reimbursement</h1>
          <p className="page-desc">Submit expenses for reimbursement</p>
        </div>
      </div>

      {/* Submit form */}
      <div style={{ border: '1px solid var(--color-border)', borderRadius: 12, background: 'var(--color-surface)', padding: 24, marginBottom: 24 }}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 16 }}>New Expense Request</div>
        <form onSubmit={handleSubmit}>
          <div className="form-grid form-grid-2" style={{ gap: 14, marginBottom: 14 }}>
            {/* Category combobox */}
            <div className="form-group">
              <label>Category</label>
              <div ref={catRef} style={{ position: 'relative' }}>
                {/* Trigger */}
                <div
                  onClick={() => { setCatOpen(o => !o); setCatSearch(''); }}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 7,
                    background: 'var(--color-surface)', cursor: 'pointer', minHeight: 38,
                    fontSize: 14, color: selectedCat ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                    userSelect: 'none',
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {selectedCat ? selectedCat.name : '— Select category —'}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                    {selectedCat && (
                      <span
                        onClick={e => { e.stopPropagation(); setForm(f => ({ ...f, categoryId: '' })); }}
                        style={{ cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: 16, lineHeight: 1, padding: '0 2px' }}
                        title="Clear"
                      >×</span>
                    )}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                      style={{ color: 'var(--color-text-muted)', transform: catOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </div>
                </div>

                {/* Dropdown */}
                {catOpen && (
                  <div style={{
                    position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
                    background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                    borderRadius: 8, boxShadow: '0 6px 20px rgba(0,0,0,0.12)',
                    zIndex: 200, overflow: 'hidden',
                  }}>
                    {/* Search input */}
                    <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--color-border)' }}>
                      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                          style={{ position: 'absolute', left: 8, width: 14, height: 14, color: 'var(--color-text-muted)', pointerEvents: 'none' }}>
                          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                        </svg>
                        <input
                          autoFocus
                          type="text"
                          placeholder="Search categories…"
                          value={catSearch}
                          onChange={e => setCatSearch(e.target.value)}
                          style={{
                            width: '100%', paddingLeft: 30, paddingRight: 10, paddingTop: 6, paddingBottom: 6,
                            border: '1px solid var(--color-border)', borderRadius: 6, fontSize: 13,
                            background: 'var(--color-surface)', color: 'var(--color-text-primary)',
                            outline: 'none',
                          }}
                        />
                      </div>
                    </div>
                    {/* Options list */}
                    <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                      {filteredCats.length === 0 ? (
                        <div style={{ padding: '10px 14px', fontSize: 13, color: 'var(--color-text-muted)' }}>No categories found</div>
                      ) : (
                        filteredCats.map(c => (
                          <div
                            key={c.id}
                            onClick={() => { setForm(f => ({ ...f, categoryId: c.id })); setCatOpen(false); setCatSearch(''); }}
                            style={{
                              padding: '9px 14px', fontSize: 14, cursor: 'pointer',
                              background: form.categoryId === c.id ? 'var(--color-primary-light)' : 'transparent',
                              color: form.categoryId === c.id ? 'var(--color-primary)' : 'var(--color-text-primary)',
                              fontWeight: form.categoryId === c.id ? 600 : 400,
                            }}
                            onMouseEnter={e => { if (form.categoryId !== c.id) (e.currentTarget as HTMLDivElement).style.background = 'var(--color-surface-2)'; }}
                            onMouseLeave={e => { if (form.categoryId !== c.id) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                          >
                            {c.name}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="form-group">
              <label>Amount (PHP) *</label>
              <input
                type="number"
                className="form-control"
                placeholder="0.00"
                min="0.01"
                step="0.01"
                value={form.amount}
                onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
              />
            </div>
          </div>
          <div className="form-group" style={{ marginBottom: 14 }}>
            <label>Description *</label>
            <textarea
              className="form-control"
              placeholder="What was this expense for?"
              rows={3}
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            />
          </div>
          <div className="form-group" style={{ marginBottom: 18 }}>
            <label>Receipt / Proof *</label>
            <input
              ref={fileRef}
              type="file"
              className="form-control"
              accept="image/*,application/pdf"
              onChange={e => setFile(e.target.files?.[0] ?? null)}
            />
            {file && (
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
                {file.name} ({(file.size / 1024).toFixed(0)} KB)
              </div>
            )}
          </div>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Submitting…' : 'Submit Expense'}
          </button>
        </form>
      </div>

      {/* My submissions */}
      <div style={{ border: '1px solid var(--color-border)', borderRadius: 12, background: 'var(--color-surface)', padding: 24 }}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 16 }}>My Submissions</div>
        {isLoading ? (
          <div className="loading-center" style={{ padding: 32 }}><div className="spinner" /></div>
        ) : expenses.length === 0 ? (
          <div className="empty-state" style={{ padding: '40px 0' }}>
            <div className="empty-state-icon">🧾</div>
            <div>No expense requests yet</div>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Category</th>
                  <th>Description</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Receipt</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map(exp => (
                  <tr key={exp.id}>
                    <td style={{ fontSize: 13, whiteSpace: 'nowrap' }}>{fmtDate(exp.createdAt)}</td>
                    <td style={{ fontSize: 13 }}>{exp.category?.name ?? '—'}</td>
                    <td style={{ maxWidth: 200 }}>{exp.description}</td>
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
                    <td style={{ fontSize: 12, color: 'var(--color-danger)' }}>
                      {exp.status === 'REJECTED' && exp.rejectionNote ? exp.rejectionNote : ''}
                      {exp.status === 'APPROVED' && exp.payrollRecord ? (
                        <span style={{ color: 'var(--color-success)', fontSize: 11 }}>
                          Added to payroll
                        </span>
                      ) : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
