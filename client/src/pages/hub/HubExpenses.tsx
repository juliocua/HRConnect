import React, { useState, useRef } from 'react';
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

  const [form, setForm] = useState({ categoryId: '', description: '', amount: '' });
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { data: categories = [] } = useQuery<ExpenseCategory[]>({
    queryKey: ['expense-categories'],
    queryFn: () => api.get('/expenses/categories').then(r => r.data),
  });

  const { data: expenses = [], isLoading } = useQuery<ExpenseRequest[]>({
    queryKey: ['my-expenses'],
    queryFn: () => api.get('/expenses').then(r => r.data),
  });

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
            <div className="form-group">
              <label>Category</label>
              <select
                className="form-control"
                value={form.categoryId}
                onChange={e => setForm(f => ({ ...f, categoryId: e.target.value }))}
              >
                <option value="">— Select category —</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
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
