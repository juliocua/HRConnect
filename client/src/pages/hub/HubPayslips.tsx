import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { formatPHP } from '@/lib/payroll';
import type { MyPayrollRecord, PayrollStatus } from '@/types';

const STATUS_COLORS: Record<PayrollStatus, string> = {
  DRAFT: 'badge-yellow', POSTED: 'badge-blue', PAID: 'badge-green',
};

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

export default function HubPayslips() {
  const [showSlip, setShowSlip] = useState<MyPayrollRecord | null>(null);

  const { data: records = [], isLoading } = useQuery<MyPayrollRecord[]>({
    queryKey: ['hub-payslips'],
    queryFn: () => api.get('/payroll/me').then(r => r.data),
  });

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>My Payslips</h1>
      <p style={{ color: 'var(--color-text-secondary)', fontSize: 14, marginBottom: 24 }}>
        Your payroll history — {records.length} payslip{records.length !== 1 ? 's' : ''}
      </p>

      {isLoading ? (
        <div className="loading-center"><div className="spinner" /></div>
      ) : records.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">💰</div>
          <div className="empty-state-title">No payslips yet</div>
          <div>Your payslips will appear here once payroll is processed</div>
        </div>
      ) : (
        <>
          {/* Summary card */}
          {records[0] && (
            <div className="card" style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Latest Payslip</div>
                  <div style={{ fontSize: 18, fontWeight: 800 }}>{records[0].payrollRun.period.replace('-', ' ').replace(/(\d{4})(\d{2})/, '$1')}</div>
                  <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 2 }}>
                    {MONTHS[(records[0].payrollRun.month || 1) - 1]} {records[0].payrollRun.year}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                  {[
                    { label: 'Gross Pay', value: formatPHP(records[0].grossPay), bold: false },
                    { label: 'Deductions', value: formatPHP(records[0].totalDeductions), bold: false },
                    { label: 'Net Pay', value: formatPHP(records[0].netPay), bold: true },
                  ].map(s => (
                    <div key={s.label} style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{s.label}</div>
                      <div style={{ fontWeight: s.bold ? 800 : 600, fontSize: s.bold ? 20 : 14, color: s.bold ? 'var(--color-primary)' : undefined }}>{s.value}</div>
                    </div>
                  ))}
                </div>
                <button className="btn btn-primary" onClick={() => setShowSlip(records[0])}>View Payslip</button>
              </div>
            </div>
          )}

          {/* History table */}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Days</th>
                  <th>Gross Pay</th>
                  <th>Deductions</th>
                  <th>Net Pay</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {records.map(r => (
                  <tr key={r.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{MONTHS[(r.payrollRun.month || 1) - 1]} {r.payrollRun.year}</div>
                    </td>
                    <td>{r.daysWorked}</td>
                    <td className="td-mono">{formatPHP(r.grossPay)}</td>
                    <td className="td-mono text-muted">{formatPHP(r.totalDeductions)}</td>
                    <td className="td-mono" style={{ fontWeight: 800, color: 'var(--color-primary)' }}>{formatPHP(r.netPay)}</td>
                    <td><span className={`badge ${STATUS_COLORS[r.payrollRun.status]}`}>{r.payrollRun.status}</span></td>
                    <td>
                      <button className="btn btn-ghost btn-sm" onClick={() => setShowSlip(r)}>View</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {showSlip && <PayslipModal record={showSlip} onClose={() => setShowSlip(null)} />}
    </div>
  );
}

function PayslipModal({ record: r, onClose }: { record: MyPayrollRecord; onClose: () => void }) {
  const period = `${MONTHS[(r.payrollRun.month || 1) - 1]} ${r.payrollRun.year}`;

  const handlePrint = () => window.print();

  return (
    <div className="modal-overlay" onClick={ev => ev.target === ev.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h2 className="modal-title">Payslip — {period}</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary btn-sm" onClick={handlePrint}>🖨️ Print</button>
            <button className="icon-btn" onClick={onClose}>✕</button>
          </div>
        </div>
        <div className="modal-body">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>Pay Period</div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{period}</div>
            </div>
            <span className={`badge ${STATUS_COLORS[r.payrollRun.status]}`}>{r.payrollRun.status}</span>
          </div>

          {/* Earnings */}
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Earnings</div>
          <div className="payslip-row"><span>Basic Salary</span><span>{formatPHP(r.basicSalary)}</span></div>
          <div className="payslip-row"><span>Days Worked ({r.daysWorked} days)</span><span>{formatPHP(r.basicSalary / 22 * r.daysWorked)}</span></div>
          {r.overtimePay > 0 && <div className="payslip-row"><span>Overtime Pay</span><span>{formatPHP(r.overtimePay)}</span></div>}
          {r.allowances > 0 && <div className="payslip-row"><span>Allowances</span><span>{formatPHP(r.allowances)}</span></div>}
          <div className="payslip-row" style={{ fontWeight: 700 }}><span>Gross Pay</span><span>{formatPHP(r.grossPay)}</span></div>

          <div className="divider" />

          {/* Deductions */}
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Deductions</div>
          <div className="payslip-row"><span>SSS Contribution</span><span style={{ color: 'var(--color-danger)' }}>({formatPHP(r.sssContrib)})</span></div>
          <div className="payslip-row"><span>PhilHealth Contribution</span><span style={{ color: 'var(--color-danger)' }}>({formatPHP(r.philhealthContrib)})</span></div>
          <div className="payslip-row"><span>Pag-IBIG Contribution</span><span style={{ color: 'var(--color-danger)' }}>({formatPHP(r.pagibigContrib)})</span></div>
          <div className="payslip-row"><span>Taxable Income</span><span>{formatPHP(r.taxableIncome)}</span></div>
          <div className="payslip-row"><span>Withholding Tax (TRAIN Law)</span><span style={{ color: 'var(--color-danger)' }}>({formatPHP(r.withholdingTax)})</span></div>
          <div className="payslip-row" style={{ fontWeight: 700 }}><span>Total Deductions</span><span style={{ color: 'var(--color-danger)' }}>({formatPHP(r.totalDeductions)})</span></div>

          <div className="divider" />

          <div className="payslip-total">
            <span>NET PAY</span>
            <span>{formatPHP(r.netPay)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
