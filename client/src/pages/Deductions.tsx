import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { useToast } from '@/lib/toast';
import type { Employee, EmployeeLoan, DeductionRecord, OtherDeductionRecord } from '@/types';
import { EmployeeCombobox } from '@/components/EmployeeCombobox';

// ── helpers ───────────────────────────────────────────────────────────────────
const peso = (v: number) =>
  '₱' + v.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });

const periodLabel = (start: string, end: string) =>
  `${fmtDate(start)} – ${fmtDate(end)}`;

// ── API calls ─────────────────────────────────────────────────────────────────
const fetchEmployees = (): Promise<Employee[]> =>
  api.get('/employees?status=ACTIVE,ON_LEAVE').then(r => r.data);

const fetchStatutory = (eid: string): Promise<DeductionRecord[]> =>
  api.get(`/deductions/${eid}/statutory?limit=24`).then(r => r.data);

const fetchOther = (eid: string): Promise<OtherDeductionRecord[]> =>
  api.get(`/deductions/${eid}/other`).then(r => r.data);

const fetchLoans = (eid: string): Promise<EmployeeLoan[]> =>
  api.get(`/deductions/${eid}/loans`).then(r => r.data);

// ── Types ─────────────────────────────────────────────────────────────────────
type Tab = 'statutory' | 'loans' | 'other';

interface LoanFormState {
  type: 'CASH_ADVANCE' | 'LOAN';
  description: string;
  principal: string;
}

interface PaymentFormState {
  loanId: string;
  amount: string;
  note: string;
  paidAt: string;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function Deductions() {
  const qc = useQueryClient();
  const toast = useToast();

  const [tab, setTab] = useState<Tab>('statutory');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [showLoanModal, setShowLoanModal] = useState(false);
  const [paymentModal, setPaymentModal] = useState<PaymentFormState | null>(null);
  const [loanForm, setLoanForm] = useState<LoanFormState>({ type: 'CASH_ADVANCE', description: '', principal: '' });

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: employees = [] } = useQuery({
    queryKey: ['employees-list'],
    queryFn: fetchEmployees,
  });

  const { data: statutory = [], isLoading: statLoading } = useQuery({
    queryKey: ['deductions-statutory', selectedEmployeeId],
    queryFn: () => fetchStatutory(selectedEmployeeId),
    enabled: !!selectedEmployeeId && tab === 'statutory',
  });

  const { data: otherDeds = [], isLoading: otherLoading } = useQuery({
    queryKey: ['deductions-other', selectedEmployeeId],
    queryFn: () => fetchOther(selectedEmployeeId),
    enabled: !!selectedEmployeeId && tab === 'other',
  });

  const { data: loans = [], isLoading: loansLoading } = useQuery({
    queryKey: ['deductions-loans', selectedEmployeeId],
    queryFn: () => fetchLoans(selectedEmployeeId),
    enabled: !!selectedEmployeeId && tab === 'loans',
  });

  // ── Mutations ──────────────────────────────────────────────────────────────
  const createLoan = useMutation({
    mutationFn: (body: object) =>
      api.post(`/deductions/${selectedEmployeeId}/loans`, body).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deductions-loans', selectedEmployeeId] });
      setShowLoanModal(false);
      setLoanForm({ type: 'CASH_ADVANCE', description: '', principal: '' });
      toast('success', 'Loan / advance created');
    },
    onError: (e: Error) => toast('error', e.message),
  });

  const addPayment = useMutation({
    mutationFn: ({ loanId, body }: { loanId: string; body: object }) =>
      api.post(`/deductions/loans/${loanId}/payment`, body).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deductions-loans', selectedEmployeeId] });
      setPaymentModal(null);
      toast('success', 'Payment recorded');
    },
    onError: (e: Error) => toast('error', e.message),
  });

  const markSettled = useMutation({
    mutationFn: (loanId: string) =>
      api.patch(`/deductions/loans/${loanId}`, { status: 'SETTLED' }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deductions-loans', selectedEmployeeId] });
      toast('success', 'Marked as settled');
    },
    onError: (e: Error) => toast('error', e.message),
  });

  const deleteLoan = useMutation({
    mutationFn: (loanId: string) =>
      api.delete(`/deductions/loans/${loanId}`).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deductions-loans', selectedEmployeeId] });
      toast('success', 'Loan removed');
    },
    onError: (e: Error) => toast('error', e.message),
  });

  // ── Derived ────────────────────────────────────────────────────────────────
  const statTotals = statutory.reduce(
    (acc, r) => ({
      sss: acc.sss + r.sssContrib,
      phic: acc.phic + r.philhealthContrib,
      hdmf: acc.hdmf + r.pagibigContrib,
      tax: acc.tax + r.withholdingTax,
    }),
    { sss: 0, phic: 0, hdmf: 0, tax: 0 }
  );

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleCreateLoan = () => {
    const principal = parseFloat(loanForm.principal);
    if (!principal || principal <= 0) { toast('error', 'Enter a valid principal amount'); return; }
    createLoan.mutate({ type: loanForm.type, description: loanForm.description || undefined, principal });
  };

  const handleAddPayment = () => {
    if (!paymentModal) return;
    const amount = parseFloat(paymentModal.amount);
    if (!amount || amount <= 0) { toast('error', 'Enter a valid amount'); return; }
    addPayment.mutate({
      loanId: paymentModal.loanId,
      body: { amount, note: paymentModal.note || undefined, paidAt: paymentModal.paidAt || undefined },
    });
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="page-container">
      {/* Header */}
      <div className="page-header" style={{ marginBottom: 24 }}>
        <div>
          <h1 className="page-title">Deduction Monitoring</h1>
          <p className="page-subtitle">Statutory contributions, loans, and other deductions per employee</p>
        </div>
      </div>

      {/* Employee picker */}
      <div style={{ marginBottom: 20, maxWidth: 380 }}>
        <EmployeeCombobox
          employees={employees}
          value={selectedEmployeeId}
          onChange={setSelectedEmployeeId}
          placeholder="Select employee…"
          required
        />
      </div>

      {/* Tabs */}
      <div className="tabs" style={{ marginBottom: 20 }}>
        {(['statutory', 'loans', 'other'] as Tab[]).map(t => (
          <button
            key={t}
            className={`tab-btn${tab === t ? ' active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t === 'statutory' ? 'Statutory Summary' : t === 'loans' ? 'Loans & Advances' : 'Other Deductions'}
          </button>
        ))}
      </div>

      {!selectedEmployeeId ? (
        <div className="empty-state">
          <p>Select an employee to view their deduction history.</p>
        </div>
      ) : (
        <>
          {/* ── Tab: Statutory ─────────────────────────────────────────────── */}
          {tab === 'statutory' && (
            <div className="card">
              {statLoading ? (
                <div className="loading-center"><div className="spinner" /></div>
              ) : statutory.length === 0 ? (
                <div className="empty-state"><p>No payroll records found for this employee.</p></div>
              ) : (
                <>
                  {/* Summary totals */}
                  <div style={{ display: 'flex', gap: 16, padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
                    {[
                      { label: 'SSS Total', value: statTotals.sss },
                      { label: 'PhilHealth Total', value: statTotals.phic },
                      { label: 'Pag-IBIG Total', value: statTotals.hdmf },
                      { label: 'Tax Withheld Total', value: statTotals.tax },
                    ].map(s => (
                      <div key={s.label} className="stat-card" style={{ flex: 1 }}>
                        <div className="stat-label">{s.label}</div>
                        <div className="stat-value">{peso(s.value)}</div>
                      </div>
                    ))}
                  </div>

                  {/* Table */}
                  <div style={{ overflowX: 'auto' }}>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Period</th>
                          <th style={{ textAlign: 'right' }}>Days</th>
                          <th style={{ textAlign: 'right' }}>Basic</th>
                          <th style={{ textAlign: 'right' }}>Gross Pay</th>
                          <th style={{ textAlign: 'right' }}>SSS</th>
                          <th style={{ textAlign: 'right' }}>PhilHealth</th>
                          <th style={{ textAlign: 'right' }}>Pag-IBIG</th>
                          <th style={{ textAlign: 'right' }}>W/Tax</th>
                          <th style={{ textAlign: 'right' }}>Net Pay</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {statutory.map(r => (
                          <tr key={r.id}>
                            <td style={{ fontSize: 12 }}>
                              {periodLabel(r.payrollRun.periodStart, r.payrollRun.periodEnd)}
                            </td>
                            <td style={{ textAlign: 'right' }}>{r.daysWorked}</td>
                            <td style={{ textAlign: 'right' }}>{peso(r.basicSalary)}</td>
                            <td style={{ textAlign: 'right' }}>{peso(r.grossPay)}</td>
                            <td style={{ textAlign: 'right' }}>{peso(r.sssContrib)}</td>
                            <td style={{ textAlign: 'right' }}>{peso(r.philhealthContrib)}</td>
                            <td style={{ textAlign: 'right' }}>{peso(r.pagibigContrib)}</td>
                            <td style={{ textAlign: 'right' }}>{peso(r.withholdingTax)}</td>
                            <td style={{ textAlign: 'right', fontWeight: 600 }}>{peso(r.netPay)}</td>
                            <td>
                              <span className={`badge badge-${r.payrollRun.status === 'PAID' ? 'success' : r.payrollRun.status === 'FINALIZED' ? 'info' : 'warning'}`}>
                                {r.payrollRun.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Tab: Loans & Advances ──────────────────────────────────────── */}
          {tab === 'loans' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
                <button className="btn btn-primary" onClick={() => setShowLoanModal(true)}>
                  + New Loan / Advance
                </button>
              </div>
              {loansLoading ? (
                <div className="loading-center"><div className="spinner" /></div>
              ) : loans.length === 0 ? (
                <div className="card empty-state"><p>No loans or advances on file for this employee.</p></div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {loans.map(loan => {
                    const totalPaid = loan.payments.reduce((s, p) => s + p.amount, 0);
                    const pct = loan.principal > 0 ? Math.min(100, (totalPaid / loan.principal) * 100) : 0;
                    return (
                      <div key={loan.id} className="card" style={{ padding: '16px 20px' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <span style={{ fontWeight: 700, fontSize: 15 }}>
                                {loan.type === 'CASH_ADVANCE' ? 'Cash Advance' : 'Loan'}
                              </span>
                              <span className={`badge badge-${loan.status === 'SETTLED' ? 'success' : 'warning'}`}>
                                {loan.status}
                              </span>
                            </div>
                            {loan.description && (
                              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
                                {loan.description}
                              </div>
                            )}
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                              Created {fmtDate(loan.createdAt)}
                            </div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Principal</div>
                            <div style={{ fontWeight: 700, fontSize: 16 }}>{peso(loan.principal)}</div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Balance</div>
                            <div style={{ fontWeight: 700, fontSize: 16, color: loan.balance > 0 ? 'var(--danger)' : 'var(--success)' }}>
                              {peso(loan.balance)}
                            </div>
                          </div>
                        </div>

                        {/* Progress bar */}
                        <div style={{ height: 6, background: 'var(--border)', borderRadius: 3, marginBottom: 12 }}>
                          <div style={{ height: '100%', width: `${pct}%`, background: 'var(--success)', borderRadius: 3, transition: 'width .3s' }} />
                        </div>

                        {/* Payments ledger */}
                        {loan.payments.length > 0 && (
                          <div style={{ marginBottom: 12 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                              Payment History
                            </div>
                            <table className="data-table" style={{ fontSize: 12 }}>
                              <thead>
                                <tr>
                                  <th>Date</th>
                                  <th style={{ textAlign: 'right' }}>Amount</th>
                                  <th>Note</th>
                                </tr>
                              </thead>
                              <tbody>
                                {loan.payments.map(p => (
                                  <tr key={p.id}>
                                    <td>{fmtDate(p.paidAt)}</td>
                                    <td style={{ textAlign: 'right' }}>{peso(p.amount)}</td>
                                    <td style={{ color: 'var(--text-secondary)' }}>{p.note ?? '—'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}

                        {/* Actions */}
                        <div style={{ display: 'flex', gap: 8 }}>
                          {loan.status === 'ACTIVE' && (
                            <>
                              <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => setPaymentModal({ loanId: loan.id, amount: '', note: '', paidAt: '' })}
                              >
                                Record Payment
                              </button>
                              <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => { if (confirm('Mark this loan as fully settled?')) markSettled.mutate(loan.id); }}
                              >
                                Mark Settled
                              </button>
                            </>
                          )}
                          {loan.payments.length === 0 && (
                            <button
                              className="btn btn-danger btn-sm"
                              onClick={() => { if (confirm('Delete this loan? This cannot be undone.')) deleteLoan.mutate(loan.id); }}
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Tab: Other Deductions ──────────────────────────────────────── */}
          {tab === 'other' && (
            <div className="card">
              {otherLoading ? (
                <div className="loading-center"><div className="spinner" /></div>
              ) : otherDeds.length === 0 ? (
                <div className="empty-state"><p>No other deductions recorded for this employee.</p></div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Period</th>
                        <th style={{ textAlign: 'right' }}>Amount</th>
                        <th>Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {otherDeds.map(r => (
                        <tr key={r.id}>
                          <td style={{ fontSize: 12 }}>
                            {periodLabel(r.payrollRun.periodStart, r.payrollRun.periodEnd)}
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 600 }}>{peso(r.otherDeductions)}</td>
                          <td style={{ color: 'var(--text-secondary)' }}>{r.otherDeductionsNote ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── New Loan Modal ──────────────────────────────────────────────────── */}
      {showLoanModal && (
        <div className="modal-overlay" onClick={() => setShowLoanModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">New Loan / Cash Advance</h2>
              <button className="modal-close" onClick={() => setShowLoanModal(false)}>✕</button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="form-group">
                <label className="form-label">Type</label>
                <select
                  className="form-input"
                  value={loanForm.type}
                  onChange={e => setLoanForm(f => ({ ...f, type: e.target.value as 'CASH_ADVANCE' | 'LOAN' }))}
                >
                  <option value="CASH_ADVANCE">Cash Advance</option>
                  <option value="LOAN">Loan</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Description (optional)</label>
                <input
                  className="form-input"
                  placeholder="e.g. Emergency cash advance Sept 2026"
                  value={loanForm.description}
                  onChange={e => setLoanForm(f => ({ ...f, description: e.target.value }))}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Principal Amount (₱)</label>
                <input
                  className="form-input"
                  type="number"
                  min="1"
                  step="0.01"
                  placeholder="0.00"
                  value={loanForm.principal}
                  onChange={e => setLoanForm(f => ({ ...f, principal: e.target.value }))}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowLoanModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleCreateLoan} disabled={createLoan.isPending}>
                {createLoan.isPending ? 'Saving…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Record Payment Modal ────────────────────────────────────────────── */}
      {paymentModal && (
        <div className="modal-overlay" onClick={() => setPaymentModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Record Payment</h2>
              <button className="modal-close" onClick={() => setPaymentModal(null)}>✕</button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="form-group">
                <label className="form-label">Amount Paid (₱)</label>
                <input
                  className="form-input"
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="0.00"
                  value={paymentModal.amount}
                  onChange={e => setPaymentModal(p => p ? { ...p, amount: e.target.value } : null)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Date Paid</label>
                <input
                  className="form-input"
                  type="date"
                  value={paymentModal.paidAt}
                  onChange={e => setPaymentModal(p => p ? { ...p, paidAt: e.target.value } : null)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Note (optional)</label>
                <input
                  className="form-input"
                  placeholder="e.g. Deducted from September 1st payroll"
                  value={paymentModal.note}
                  onChange={e => setPaymentModal(p => p ? { ...p, note: e.target.value } : null)}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setPaymentModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleAddPayment} disabled={addPayment.isPending}>
                {addPayment.isPending ? 'Saving…' : 'Record'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
