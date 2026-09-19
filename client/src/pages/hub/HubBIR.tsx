import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface MonthlyBreakdown {
  month: number;
  grossPay: number;
  withholdingTax: number;
  sssContrib: number;
  philhealthContrib: number;
  pagibigContrib: number;
  netPay: number;
}

interface BIRMyData {
  year: number;
  company: { name: string; taxNumber: string; address: string };
  employee: {
    employeeId: number;
    name: string;
    firstName: string;
    lastName: string;
    middleName: string;
    position: string;
    tinNo: string;
    sssNo: string;
    philhealthNo: string;
    pagibigNo: string;
    basicSalary: number;
    grossPay: number;
    netPay: number;
    withholdingTax: number;
    sssContrib: number;
    philhealthContrib: number;
    pagibigContrib: number;
    monthlyBreakdown: MonthlyBreakdown[];
  };
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function fmt(n: number) {
  return n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function render2316HTML(data: BIRMyData): string {
  const e = data.employee;
  const c = data.company;
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>BIR Form 2316 - ${e.name} - ${data.year}</title>
<style>
  @page { size: A4; margin: 15mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 8.5pt; color: #000; }
  .page { width: 100%; }
  h1 { text-align: center; font-size: 13pt; font-weight: bold; margin-bottom: 2px; }
  h2 { text-align: center; font-size: 10pt; margin-bottom: 8px; }
  .subtitle { text-align: center; font-size: 8pt; margin-bottom: 12px; color: #444; }
  .section { margin-bottom: 10px; }
  .section-title { font-weight: bold; font-size: 8.5pt; background: #ddd; padding: 2px 4px; margin-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; }
  td, th { border: 1px solid #999; padding: 3px 5px; font-size: 8pt; }
  th { background: #eee; font-weight: bold; }
  .label { background: #f5f5f5; font-weight: 600; width: 45%; }
  .val { width: 55%; }
  .totals-row td { font-weight: bold; background: #f0f0f0; }
  .right { text-align: right; }
  .center { text-align: center; }
  .sig-area { margin-top: 20px; display: flex; gap: 40px; }
  .sig-block { flex: 1; border-top: 1px solid #000; padding-top: 4px; font-size: 8pt; }
</style>
</head><body>
<div class="page">
  <h1>BIR FORM 2316</h1>
  <h2>Certificate of Compensation Payment / Tax Withheld</h2>
  <div class="subtitle">For Compensation Payment With or Without Tax Withheld | Calendar Year: ${data.year}</div>

  <div class="section">
    <div class="section-title">EMPLOYER INFORMATION</div>
    <table><tbody>
      <tr><td class="label">Employer's Name</td><td class="val">${c.name}</td></tr>
      <tr><td class="label">TIN</td><td class="val">${c.taxNumber || 'N/A'}</td></tr>
      <tr><td class="label">Address</td><td class="val">${c.address || 'N/A'}</td></tr>
    </tbody></table>
  </div>

  <div class="section">
    <div class="section-title">EMPLOYEE INFORMATION</div>
    <table><tbody>
      <tr><td class="label">Employee Name</td><td class="val">${e.lastName}, ${e.firstName} ${e.middleName}</td></tr>
      <tr><td class="label">Position</td><td class="val">${e.position || 'N/A'}</td></tr>
      <tr><td class="label">TIN</td><td class="val">${e.tinNo || 'N/A'}</td></tr>
      <tr><td class="label">SSS No.</td><td class="val">${e.sssNo || 'N/A'}</td></tr>
      <tr><td class="label">PhilHealth No.</td><td class="val">${e.philhealthNo || 'N/A'}</td></tr>
      <tr><td class="label">Pag-IBIG No.</td><td class="val">${e.pagibigNo || 'N/A'}</td></tr>
    </tbody></table>
  </div>

  <div class="section">
    <div class="section-title">COMPENSATION SUMMARY</div>
    <table><tbody>
      <tr><td class="label">Gross Compensation Income</td><td class="val right">₱ ${fmt(e.grossPay)}</td></tr>
      <tr><td class="label">SSS Contributions</td><td class="val right">₱ ${fmt(e.sssContrib)}</td></tr>
      <tr><td class="label">PhilHealth Contributions</td><td class="val right">₱ ${fmt(e.philhealthContrib)}</td></tr>
      <tr><td class="label">Pag-IBIG Contributions</td><td class="val right">₱ ${fmt(e.pagibigContrib)}</td></tr>
      <tr><td class="label">Tax Withheld (Total)</td><td class="val right">₱ ${fmt(e.withholdingTax)}</td></tr>
      <tr><td class="label">Net Pay</td><td class="val right">₱ ${fmt(e.netPay)}</td></tr>
    </tbody></table>
  </div>

  <div class="section">
    <div class="section-title">MONTHLY BREAKDOWN</div>
    <table>
      <thead><tr>
        <th>Month</th><th class="right">Gross Pay</th><th class="right">SSS</th>
        <th class="right">PhilHealth</th><th class="right">Pag-IBIG</th>
        <th class="right">Tax Withheld</th><th class="right">Net Pay</th>
      </tr></thead>
      <tbody>
        ${e.monthlyBreakdown.map(m => `<tr>
          <td>${MONTHS[m.month - 1]}</td>
          <td class="right">${fmt(m.grossPay)}</td>
          <td class="right">${fmt(m.sssContrib)}</td>
          <td class="right">${fmt(m.philhealthContrib)}</td>
          <td class="right">${fmt(m.pagibigContrib)}</td>
          <td class="right">${fmt(m.withholdingTax)}</td>
          <td class="right">${fmt(m.netPay)}</td>
        </tr>`).join('')}
        <tr class="totals-row">
          <td><strong>TOTAL</strong></td>
          <td class="right">${fmt(e.grossPay)}</td>
          <td class="right">${fmt(e.sssContrib)}</td>
          <td class="right">${fmt(e.philhealthContrib)}</td>
          <td class="right">${fmt(e.pagibigContrib)}</td>
          <td class="right">${fmt(e.withholdingTax)}</td>
          <td class="right">${fmt(e.netPay)}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="sig-area">
    <div class="sig-block">
      <div>${e.lastName}, ${e.firstName} ${e.middleName}</div>
      <div>Employee Signature over Printed Name</div>
    </div>
    <div class="sig-block">
      <div>&nbsp;</div>
      <div>Authorized Representative of Employer</div>
    </div>
  </div>
</div>
<script>window.onload = () => { window.print(); }</script>
</body></html>`;
}

export default function HubBIR() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);

  const years = Array.from({ length: 5 }, (_, i) => currentYear - i);

  const { data, isLoading, isError } = useQuery<BIRMyData>({
    queryKey: ['hub-bir-my', year],
    queryFn: () => api.get(`/bir/my?year=${year}`),
    retry: false,
  });

  const handlePrint2316 = () => {
    if (!data) return;
    const win = window.open('', '_blank', 'width=850,height=1100');
    if (!win) { alert('Please allow popups to print.'); return; }
    win.document.write(render2316HTML(data));
    win.document.close();
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text-primary)', margin: 0 }}>BIR Documents</h1>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '4px 0 0' }}>
            Your tax and contribution records for the selected year
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: 13, color: 'var(--color-text-secondary)', fontWeight: 600 }}>Year:</label>
          <select
            value={year}
            onChange={e => setYear(Number(e.target.value))}
            style={{
              padding: '6px 10px', borderRadius: 7, border: '1px solid var(--color-border)',
              background: 'var(--color-surface)', color: 'var(--color-text-primary)',
              fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {isLoading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '48px 0' }}>
          <div className="spinner" />
        </div>
      )}

      {isError && (
        <div style={{
          background: 'var(--color-surface)', borderRadius: 12, border: '1px solid var(--color-border)',
          padding: '48px 24px', textAlign: 'center',
        }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>📋</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 6 }}>
            No BIR records found for {year}
          </div>
          <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
            Payroll records for this year haven't been processed yet.
          </div>
        </div>
      )}

      {data && !isLoading && (
        <>
          {/* Summary Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14, marginBottom: 24 }}>
            {[
              { label: 'Gross Pay', value: data.employee.grossPay, color: '#2563eb' },
              { label: 'Net Pay', value: data.employee.netPay, color: '#16a34a' },
              { label: 'Tax Withheld', value: data.employee.withholdingTax, color: '#dc2626' },
              { label: 'SSS', value: data.employee.sssContrib, color: '#7c3aed' },
              { label: 'PhilHealth', value: data.employee.philhealthContrib, color: '#0891b2' },
              { label: 'Pag-IBIG', value: data.employee.pagibigContrib, color: '#d97706' },
            ].map(card => (
              <div key={card.label} style={{
                background: 'var(--color-surface)', borderRadius: 10, border: '1px solid var(--color-border)',
                padding: '14px 16px',
              }}>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                  {card.label}
                </div>
                <div style={{ fontSize: 18, fontWeight: 700, color: card.color, fontVariantNumeric: 'tabular-nums' }}>
                  ₱{fmt(card.value)}
                </div>
              </div>
            ))}
          </div>

          {/* Employee Info */}
          <div style={{
            background: 'var(--color-surface)', borderRadius: 12, border: '1px solid var(--color-border)',
            padding: '20px 24px', marginBottom: 20,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text-primary)', margin: 0 }}>
                Form 2316 — Certificate of Compensation
              </h2>
              <button
                onClick={handlePrint2316}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '7px 14px', borderRadius: 7, border: 'none', cursor: 'pointer',
                  background: 'var(--color-primary)', color: '#fff',
                  fontSize: 13, fontWeight: 600,
                }}
              >
                🖨️ Print / Download 2316
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              {[
                { label: 'Full Name', value: `${data.employee.lastName}, ${data.employee.firstName} ${data.employee.middleName}` },
                { label: 'Position', value: data.employee.position || 'N/A' },
                { label: 'TIN', value: data.employee.tinNo || 'Not on file' },
                { label: 'SSS No.', value: data.employee.sssNo || 'Not on file' },
                { label: 'PhilHealth No.', value: data.employee.philhealthNo || 'Not on file' },
                { label: 'Pag-IBIG No.', value: data.employee.pagibigNo || 'Not on file' },
              ].map(row => (
                <div key={row.label}>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>{row.label}</div>
                  <div style={{ fontSize: 13, color: 'var(--color-text-primary)', fontWeight: 500 }}>{row.value}</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--color-border)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              {[
                { label: 'Employer', value: data.company.name },
                { label: 'Employer TIN', value: data.company.taxNumber || 'Not on file' },
                { label: 'Address', value: data.company.address || 'Not on file' },
              ].map(row => (
                <div key={row.label}>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>{row.label}</div>
                  <div style={{ fontSize: 13, color: 'var(--color-text-primary)', fontWeight: 500 }}>{row.value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Monthly Breakdown Table */}
          <div style={{
            background: 'var(--color-surface)', borderRadius: 12, border: '1px solid var(--color-border)',
            overflow: 'hidden',
          }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-border)' }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text-primary)', margin: 0 }}>
                Monthly Breakdown — {year}
              </h2>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--color-surface-2)' }}>
                    {['Month', 'Gross Pay', 'SSS', 'PhilHealth', 'Pag-IBIG', 'Tax Withheld', 'Net Pay'].map(h => (
                      <th key={h} style={{
                        padding: '10px 14px', textAlign: h === 'Month' ? 'left' : 'right',
                        fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)',
                        textTransform: 'uppercase', letterSpacing: 0.4,
                        borderBottom: '1px solid var(--color-border)',
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.employee.monthlyBreakdown.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ padding: '24px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
                        No payroll records for {year}
                      </td>
                    </tr>
                  ) : (
                    <>
                      {data.employee.monthlyBreakdown.map((m, i) => (
                        <tr key={m.month} style={{ background: i % 2 === 0 ? 'transparent' : 'var(--color-surface-2)' }}>
                          <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                            {MONTHS[m.month - 1]}
                          </td>
                          {[m.grossPay, m.sssContrib, m.philhealthContrib, m.pagibigContrib, m.withholdingTax, m.netPay].map((v, j) => (
                            <td key={j} style={{ padding: '10px 14px', textAlign: 'right', fontSize: 13, color: 'var(--color-text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                              {fmt(v)}
                            </td>
                          ))}
                        </tr>
                      ))}
                      <tr style={{ background: 'var(--color-primary-light)', fontWeight: 700 }}>
                        <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 700, color: 'var(--color-primary)' }}>TOTAL</td>
                        {[
                          data.employee.grossPay,
                          data.employee.sssContrib,
                          data.employee.philhealthContrib,
                          data.employee.pagibigContrib,
                          data.employee.withholdingTax,
                          data.employee.netPay,
                        ].map((v, j) => (
                          <td key={j} style={{ padding: '10px 14px', textAlign: 'right', fontSize: 13, fontWeight: 700, color: 'var(--color-primary)', fontVariantNumeric: 'tabular-nums' }}>
                            {fmt(v)}
                          </td>
                        ))}
                      </tr>
                    </>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
