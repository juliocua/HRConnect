import { useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

// ── Types ──────────────────────────────────────────────────────────────────────
interface EmployeeBIR {
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
  monthlyBreakdown: Record<number, { grossPay: number; withholdingTax: number; sssContrib: number; philhealthContrib: number; pagibigContrib: number }>;
}

interface MonthlyTotal {
  month: number;
  grossPay: number;
  withholdingTax: number;
  sssContrib: number;
  philhealthContrib: number;
  pagibigContrib: number;
}

interface BIRData {
  year: number;
  company: { name: string; taxNumber: string; address: string };
  employees: EmployeeBIR[];
  monthlyTotals: MonthlyTotal[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function fmt(n: number) {
  return n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function printSection(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(`
    <html><head><title>BIR Form</title>
    <style>
      body { font-family: Arial, sans-serif; font-size: 11px; margin: 16px; color: #000; }
      table { border-collapse: collapse; width: 100%; }
      th, td { border: 1px solid #555; padding: 3px 6px; }
      th { background: #eee; font-weight: bold; text-align: center; }
      .no-border td, .no-border th { border: none; }
      @media print { body { margin: 0; } }
    </style>
    </head><body>${el.innerHTML}</body></html>
  `);
  win.document.close();
  win.focus();
  win.print();
}

function printEmployee2316(emp: EmployeeBIR, company: BIRData['company'], year: number) {
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(`
    <html><head><title>BIR 2316 - ${emp.lastName}, ${emp.firstName}</title>
    <style>
      body { font-family: Arial, sans-serif; font-size: 11px; margin: 16px; color: #000; }
      table { border-collapse: collapse; width: 100%; margin-bottom: 8px; }
      th, td { border: 1px solid #555; padding: 3px 6px; }
      th { background: #eee; font-weight: bold; }
      h2 { font-size: 13px; margin: 4px 0; }
      h3 { font-size: 12px; margin: 8px 0 4px; }
      @media print { body { margin: 0; } }
    </style>
    </head><body>${render2316HTML(emp, company, year)}</body></html>
  `);
  win.document.close();
  win.focus();
  win.print();
}

function render2316HTML(emp: EmployeeBIR, company: BIRData['company'], year: number) {
  return `
    <h2 style="text-align:center">BIR FORM 2316</h2>
    <h2 style="text-align:center">Certificate of Compensation Payment/Tax Withheld</h2>
    <p style="text-align:center">For the Year ${year}</p>
    <table>
      <tr><th colspan="4">EMPLOYER INFORMATION</th></tr>
      <tr>
        <td><b>Company Name:</b> ${company.name}</td>
        <td><b>TIN:</b> ${company.taxNumber}</td>
        <td colspan="2"><b>Address:</b> ${company.address}</td>
      </tr>
    </table>
    <table>
      <tr><th colspan="4">EMPLOYEE INFORMATION</th></tr>
      <tr>
        <td><b>Last Name:</b> ${emp.lastName}</td>
        <td><b>First Name:</b> ${emp.firstName}</td>
        <td><b>Middle Name:</b> ${emp.middleName}</td>
        <td><b>TIN:</b> ${emp.tinNo || '—'}</td>
      </tr>
      <tr>
        <td><b>Position:</b> ${emp.position}</td>
        <td><b>SSS No:</b> ${emp.sssNo || '—'}</td>
        <td><b>PhilHealth No:</b> ${emp.philhealthNo || '—'}</td>
        <td><b>Pag-IBIG No:</b> ${emp.pagibigNo || '—'}</td>
      </tr>
    </table>
    <table>
      <tr><th colspan="2">COMPENSATION AND TAX SUMMARY</th></tr>
      <tr><td>Gross Compensation Income</td><td align="right">₱ ${fmt(emp.grossPay)}</td></tr>
      <tr><td>SSS Contributions</td><td align="right">₱ ${fmt(emp.sssContrib)}</td></tr>
      <tr><td>PhilHealth Contributions</td><td align="right">₱ ${fmt(emp.philhealthContrib)}</td></tr>
      <tr><td>Pag-IBIG Contributions</td><td align="right">₱ ${fmt(emp.pagibigContrib)}</td></tr>
      <tr><td><b>Total Tax Withheld</b></td><td align="right"><b>₱ ${fmt(emp.withholdingTax)}</b></td></tr>
      <tr><td>Net Pay</td><td align="right">₱ ${fmt(emp.netPay)}</td></tr>
    </table>
    <table>
      <tr><th>Month</th><th>Gross Pay</th><th>Withholding Tax</th><th>SSS</th><th>PhilHealth</th><th>Pag-IBIG</th></tr>
      ${Array.from({length:12},(_,i)=>i+1).map(m=>{
        const b = emp.monthlyBreakdown[m];
        if (!b) return `<tr><td>${MONTH_NAMES[m-1]}</td><td align="right">—</td><td align="right">—</td><td align="right">—</td><td align="right">—</td><td align="right">—</td></tr>`;
        return `<tr><td>${MONTH_NAMES[m-1]}</td><td align="right">${fmt(b.grossPay)}</td><td align="right">${fmt(b.withholdingTax)}</td><td align="right">${fmt(b.sssContrib)}</td><td align="right">${fmt(b.philhealthContrib)}</td><td align="right">${fmt(b.pagibigContrib)}</td></tr>`;
      }).join('')}
    </table>
  `;
}

// ── Tabs ───────────────────────────────────────────────────────────────────────
const TABS = [
  { key: '1601c', label: 'BIR 1601-C' },
  { key: '1604c', label: 'BIR 1604-C' },
  { key: 'alphalist', label: 'Annex F / Alphalist' },
  { key: '2316', label: 'BIR 2316' },
];

// ── Main page ──────────────────────────────────────────────────────────────────
export default function BIRReports() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [tab, setTab] = useState('1601c');
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);

  const { data, isLoading, isError } = useQuery<BIRData>({
    queryKey: ['bir', year],
    queryFn: () => api.get(`/bir?year=${year}`),
  });

  const years = Array.from({ length: 5 }, (_, i) => currentYear - i);

  const headerStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 20, flexWrap: 'wrap', gap: 12,
  };

  const tabBarStyle: React.CSSProperties = {
    display: 'flex', borderBottom: '2px solid var(--color-border)', marginBottom: 24, gap: 0,
  };

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '10px 20px', fontWeight: 600, fontSize: 13,
    cursor: 'pointer', background: 'none', border: 'none',
    borderBottom: active ? '2px solid var(--color-primary)' : '2px solid transparent',
    marginBottom: -2,
    color: active ? 'var(--color-primary)' : 'var(--color-text-secondary)',
    transition: 'all 0.15s',
  });

  return (
    <div>
      {/* Header */}
      <div style={headerStyle}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>BIR Reports</h1>
          <p style={{ margin: '4px 0 0', color: 'var(--color-text-muted)', fontSize: 13 }}>
            Bureau of Internal Revenue annual reporting
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <label style={{ fontSize: 13, fontWeight: 600 }}>Year:</label>
          <select
            value={year}
            onChange={e => setYear(Number(e.target.value))}
            style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--color-border)', fontSize: 13 }}
          >
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {isLoading && <div style={{ textAlign: 'center', padding: 40, color: 'var(--color-text-muted)' }}>Loading BIR data…</div>}
      {isError && <div style={{ textAlign: 'center', padding: 40, color: 'var(--color-danger)' }}>Failed to load BIR data.</div>}

      {data && (
        <>
          {/* Tab bar */}
          <div style={tabBarStyle}>
            {TABS.map(t => (
              <button key={t.key} style={tabStyle(tab === t.key)} onClick={() => setTab(t.key)}>
                {t.label}
              </button>
            ))}
          </div>

          {/* ── 1601-C ─────────────────────────────────────────────── */}
          {tab === '1601c' && (
            <Tab1601C
              data={data}
              year={year}
              selectedMonth={selectedMonth}
              setSelectedMonth={setSelectedMonth}
            />
          )}

          {/* ── 1604-C ─────────────────────────────────────────────── */}
          {tab === '1604c' && <Tab1604C data={data} year={year} />}

          {/* ── Alphalist ──────────────────────────────────────────── */}
          {tab === 'alphalist' && <TabAlphalist data={data} year={year} />}

          {/* ── 2316 ───────────────────────────────────────────────── */}
          {tab === '2316' && <Tab2316 data={data} year={year} />}
        </>
      )}
    </div>
  );
}

// ── 1601-C Tab ────────────────────────────────────────────────────────────────
function Tab1601C({ data, year, selectedMonth, setSelectedMonth }: { data: BIRData; year: number; selectedMonth: number; setSelectedMonth: (m: number) => void }) {
  const mt = data.monthlyTotals.find(m => m.month === selectedMonth) || { month: selectedMonth, grossPay: 0, withholdingTax: 0, sssContrib: 0, philhealthContrib: 0, pagibigContrib: 0 };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>BIR Form 1601-C</h2>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--color-text-muted)' }}>Monthly Remittance Return of Creditable Income Taxes Withheld (Expanded)</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <select
            value={selectedMonth}
            onChange={e => setSelectedMonth(Number(e.target.value))}
            style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--color-border)', fontSize: 13 }}
          >
            {MONTHS.map((m, i) => <option key={i+1} value={i+1}>{m} {year}</option>)}
          </select>
          <button
            onClick={() => printSection('bir-1601c')}
            style={{ padding: '6px 14px', borderRadius: 6, background: 'var(--color-primary)', color: '#fff', border: 'none', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
          >🖨️ Print</button>
        </div>
      </div>

      <div id="bir-1601c" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, padding: 24 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
          <tbody>
            <tr>
              <td colSpan={4} style={{ textAlign: 'center', fontWeight: 700, fontSize: 14, padding: '8px 0', border: 'none' }}>
                BIR FORM 1601-C
              </td>
            </tr>
            <tr>
              <td colSpan={4} style={{ textAlign: 'center', fontSize: 12, paddingBottom: 12, border: 'none' }}>
                Monthly Remittance Return of Creditable Income Taxes Withheld (Expanded)<br />
                For the Month of {MONTH_NAMES[selectedMonth - 1]} {year}
              </td>
            </tr>
            <tr style={{ borderTop: '1px solid #ccc', borderBottom: '1px solid #ccc' }}>
              <th style={{ padding: '6px 8px', textAlign: 'left', background: '#f5f5f5', border: '1px solid #ccc', width: '50%' }}>Taxpayer / Employer Name</th>
              <td style={{ padding: '6px 8px', border: '1px solid #ccc' }} colSpan={3}>{data.company.name}</td>
            </tr>
            <tr>
              <th style={{ padding: '6px 8px', textAlign: 'left', background: '#f5f5f5', border: '1px solid #ccc' }}>TIN</th>
              <td style={{ padding: '6px 8px', border: '1px solid #ccc' }} colSpan={3}>{data.company.taxNumber || '—'}</td>
            </tr>
            <tr>
              <th style={{ padding: '6px 8px', textAlign: 'left', background: '#f5f5f5', border: '1px solid #ccc' }}>Address</th>
              <td style={{ padding: '6px 8px', border: '1px solid #ccc' }} colSpan={3}>{data.company.address || '—'}</td>
            </tr>
            <tr><td colSpan={4} style={{ border: 'none', padding: '10px 0 4px', fontWeight: 700 }}>REMITTANCE SUMMARY</td></tr>
            <tr>
              <th style={{ padding: '6px 8px', background: '#f5f5f5', border: '1px solid #ccc', width: '40%' }}>Item</th>
              <th style={{ padding: '6px 8px', background: '#f5f5f5', border: '1px solid #ccc', textAlign: 'right' }}>Amount (₱)</th>
              <th style={{ padding: '6px 8px', background: '#f5f5f5', border: '1px solid #ccc', width: '40%' }}>Item</th>
              <th style={{ padding: '6px 8px', background: '#f5f5f5', border: '1px solid #ccc', textAlign: 'right' }}>Amount (₱)</th>
            </tr>
            <tr>
              <td style={{ padding: '6px 8px', border: '1px solid #ccc' }}>Total Gross Compensation</td>
              <td style={{ padding: '6px 8px', border: '1px solid #ccc', textAlign: 'right' }}>{fmt(mt.grossPay)}</td>
              <td style={{ padding: '6px 8px', border: '1px solid #ccc' }}>SSS Contributions</td>
              <td style={{ padding: '6px 8px', border: '1px solid #ccc', textAlign: 'right' }}>{fmt(mt.sssContrib)}</td>
            </tr>
            <tr>
              <td style={{ padding: '6px 8px', border: '1px solid #ccc' }}>Total Tax Withheld</td>
              <td style={{ padding: '6px 8px', border: '1px solid #ccc', textAlign: 'right', fontWeight: 700 }}>{fmt(mt.withholdingTax)}</td>
              <td style={{ padding: '6px 8px', border: '1px solid #ccc' }}>PhilHealth Contributions</td>
              <td style={{ padding: '6px 8px', border: '1px solid #ccc', textAlign: 'right' }}>{fmt(mt.philhealthContrib)}</td>
            </tr>
            <tr>
              <td style={{ padding: '6px 8px', border: '1px solid #ccc' }}></td>
              <td style={{ padding: '6px 8px', border: '1px solid #ccc' }}></td>
              <td style={{ padding: '6px 8px', border: '1px solid #ccc' }}>Pag-IBIG Contributions</td>
              <td style={{ padding: '6px 8px', border: '1px solid #ccc', textAlign: 'right' }}>{fmt(mt.pagibigContrib)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── 1604-C Tab ────────────────────────────────────────────────────────────────
function Tab1604C({ data, year }: { data: BIRData; year: number }) {
  const totals = data.monthlyTotals.reduce((acc, m) => ({
    grossPay: acc.grossPay + m.grossPay,
    withholdingTax: acc.withholdingTax + m.withholdingTax,
    sssContrib: acc.sssContrib + m.sssContrib,
    philhealthContrib: acc.philhealthContrib + m.philhealthContrib,
    pagibigContrib: acc.pagibigContrib + m.pagibigContrib,
  }), { grossPay: 0, withholdingTax: 0, sssContrib: 0, philhealthContrib: 0, pagibigContrib: 0 });

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>BIR Form 1604-C</h2>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--color-text-muted)' }}>Annual Information Return of Income Taxes Withheld on Compensation — Year {year}</p>
        </div>
        <button
          onClick={() => printSection('bir-1604c')}
          style={{ padding: '6px 14px', borderRadius: 6, background: 'var(--color-primary)', color: '#fff', border: 'none', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
        >🖨️ Print</button>
      </div>

      <div id="bir-1604c" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, padding: 24 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
          <tbody>
            <tr><td colSpan={14} style={{ textAlign: 'center', fontWeight: 700, fontSize: 14, padding: '8px 0', border: 'none' }}>BIR FORM 1604-C — Annual Information Return</td></tr>
            <tr><td colSpan={14} style={{ textAlign: 'center', paddingBottom: 8, border: 'none' }}>Taxable Year Ended December 31, {year}</td></tr>
            <tr>
              <th style={{ padding: '6px 8px', background: '#f5f5f5', border: '1px solid #ccc' }}>Employer</th>
              <td style={{ padding: '6px 8px', border: '1px solid #ccc' }} colSpan={5}>{data.company.name}</td>
              <th style={{ padding: '6px 8px', background: '#f5f5f5', border: '1px solid #ccc' }}>TIN</th>
              <td style={{ padding: '6px 8px', border: '1px solid #ccc' }} colSpan={7}>{data.company.taxNumber || '—'}</td>
            </tr>
          </tbody>
        </table>

        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12, marginTop: 12 }}>
          <thead>
            <tr style={{ background: '#f0f0f0' }}>
              <th style={{ padding: '6px 8px', border: '1px solid #ccc' }}>Month</th>
              <th style={{ padding: '6px 8px', border: '1px solid #ccc', textAlign: 'right' }}>Gross Pay</th>
              <th style={{ padding: '6px 8px', border: '1px solid #ccc', textAlign: 'right' }}>W/Tax</th>
              <th style={{ padding: '6px 8px', border: '1px solid #ccc', textAlign: 'right' }}>SSS</th>
              <th style={{ padding: '6px 8px', border: '1px solid #ccc', textAlign: 'right' }}>PhilHealth</th>
              <th style={{ padding: '6px 8px', border: '1px solid #ccc', textAlign: 'right' }}>Pag-IBIG</th>
            </tr>
          </thead>
          <tbody>
            {data.monthlyTotals.map(mt => (
              <tr key={mt.month}>
                <td style={{ padding: '5px 8px', border: '1px solid #ccc' }}>{MONTH_NAMES[mt.month - 1]}</td>
                <td style={{ padding: '5px 8px', border: '1px solid #ccc', textAlign: 'right' }}>{fmt(mt.grossPay)}</td>
                <td style={{ padding: '5px 8px', border: '1px solid #ccc', textAlign: 'right' }}>{fmt(mt.withholdingTax)}</td>
                <td style={{ padding: '5px 8px', border: '1px solid #ccc', textAlign: 'right' }}>{fmt(mt.sssContrib)}</td>
                <td style={{ padding: '5px 8px', border: '1px solid #ccc', textAlign: 'right' }}>{fmt(mt.philhealthContrib)}</td>
                <td style={{ padding: '5px 8px', border: '1px solid #ccc', textAlign: 'right' }}>{fmt(mt.pagibigContrib)}</td>
              </tr>
            ))}
            <tr style={{ fontWeight: 700, background: '#f5f5f5' }}>
              <td style={{ padding: '5px 8px', border: '1px solid #ccc' }}>TOTAL</td>
              <td style={{ padding: '5px 8px', border: '1px solid #ccc', textAlign: 'right' }}>{fmt(totals.grossPay)}</td>
              <td style={{ padding: '5px 8px', border: '1px solid #ccc', textAlign: 'right' }}>{fmt(totals.withholdingTax)}</td>
              <td style={{ padding: '5px 8px', border: '1px solid #ccc', textAlign: 'right' }}>{fmt(totals.sssContrib)}</td>
              <td style={{ padding: '5px 8px', border: '1px solid #ccc', textAlign: 'right' }}>{fmt(totals.philhealthContrib)}</td>
              <td style={{ padding: '5px 8px', border: '1px solid #ccc', textAlign: 'right' }}>{fmt(totals.pagibigContrib)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Alphalist Tab ─────────────────────────────────────────────────────────────
function TabAlphalist({ data, year }: { data: BIRData; year: number }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Annex F — Alphalist of Employees</h2>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--color-text-muted)' }}>Annual alphalist per employee — Year {year}</p>
        </div>
        <button
          onClick={() => printSection('bir-alphalist')}
          style={{ padding: '6px 14px', borderRadius: 6, background: 'var(--color-primary)', color: '#fff', border: 'none', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
        >🖨️ Print</button>
      </div>

      <div id="bir-alphalist" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, padding: 24, overflowX: 'auto' }}>
        <p style={{ fontSize: 12, marginBottom: 8, fontWeight: 700 }}>
          {data.company.name} | TIN: {data.company.taxNumber || '—'} | Year: {year}
        </p>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11 }}>
          <thead>
            <tr style={{ background: '#f0f0f0' }}>
              <th style={{ padding: '5px 6px', border: '1px solid #ccc' }}>#</th>
              <th style={{ padding: '5px 6px', border: '1px solid #ccc' }}>Employee Name</th>
              <th style={{ padding: '5px 6px', border: '1px solid #ccc' }}>TIN</th>
              <th style={{ padding: '5px 6px', border: '1px solid #ccc' }}>Position</th>
              <th style={{ padding: '5px 6px', border: '1px solid #ccc', textAlign: 'right' }}>Gross Pay</th>
              <th style={{ padding: '5px 6px', border: '1px solid #ccc', textAlign: 'right' }}>W/Tax</th>
              <th style={{ padding: '5px 6px', border: '1px solid #ccc', textAlign: 'right' }}>SSS</th>
              <th style={{ padding: '5px 6px', border: '1px solid #ccc', textAlign: 'right' }}>PhilHealth</th>
              <th style={{ padding: '5px 6px', border: '1px solid #ccc', textAlign: 'right' }}>Pag-IBIG</th>
              <th style={{ padding: '5px 6px', border: '1px solid #ccc', textAlign: 'right' }}>Net Pay</th>
            </tr>
          </thead>
          <tbody>
            {data.employees.sort((a, b) => a.lastName.localeCompare(b.lastName)).map((emp, i) => (
              <tr key={emp.employeeId} style={{ background: i % 2 === 0 ? 'transparent' : 'var(--color-surface-2)' }}>
                <td style={{ padding: '4px 6px', border: '1px solid #ccc', textAlign: 'center' }}>{i + 1}</td>
                <td style={{ padding: '4px 6px', border: '1px solid #ccc' }}>{emp.lastName}, {emp.firstName} {emp.middleName}</td>
                <td style={{ padding: '4px 6px', border: '1px solid #ccc' }}>{emp.tinNo || '—'}</td>
                <td style={{ padding: '4px 6px', border: '1px solid #ccc' }}>{emp.position || '—'}</td>
                <td style={{ padding: '4px 6px', border: '1px solid #ccc', textAlign: 'right' }}>{fmt(emp.grossPay)}</td>
                <td style={{ padding: '4px 6px', border: '1px solid #ccc', textAlign: 'right' }}>{fmt(emp.withholdingTax)}</td>
                <td style={{ padding: '4px 6px', border: '1px solid #ccc', textAlign: 'right' }}>{fmt(emp.sssContrib)}</td>
                <td style={{ padding: '4px 6px', border: '1px solid #ccc', textAlign: 'right' }}>{fmt(emp.philhealthContrib)}</td>
                <td style={{ padding: '4px 6px', border: '1px solid #ccc', textAlign: 'right' }}>{fmt(emp.pagibigContrib)}</td>
                <td style={{ padding: '4px 6px', border: '1px solid #ccc', textAlign: 'right' }}>{fmt(emp.netPay)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── 2316 Tab ──────────────────────────────────────────────────────────────────
function Tab2316({ data, year }: { data: BIRData; year: number }) {
  const printAll = () => {
    const win = window.open('', '_blank');
    if (!win) return;
    const pages = data.employees
      .sort((a, b) => a.lastName.localeCompare(b.lastName))
      .map(emp => render2316HTML(emp, data.company, year))
      .join('<div style="page-break-after:always"></div>');
    win.document.write(`
      <html><head><title>BIR 2316 - All Employees - ${year}</title>
      <style>
        body { font-family: Arial, sans-serif; font-size: 11px; margin: 16px; color: #000; }
        table { border-collapse: collapse; width: 100%; margin-bottom: 8px; }
        th, td { border: 1px solid #555; padding: 3px 6px; }
        th { background: #eee; font-weight: bold; }
        h2 { font-size: 13px; margin: 4px 0; }
        h3 { font-size: 12px; margin: 8px 0 4px; }
        @media print { body { margin: 0; } }
      </style>
      </head><body>${pages}</body></html>
    `);
    win.document.close();
    win.focus();
    win.print();
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>BIR Form 2316</h2>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--color-text-muted)' }}>Certificate of Compensation Payment/Tax Withheld — Year {year}</p>
        </div>
        <button
          onClick={printAll}
          style={{ padding: '6px 14px', borderRadius: 6, background: 'var(--color-primary)', color: '#fff', border: 'none', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
        >🖨️ Print All</button>
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        {data.employees.sort((a, b) => a.lastName.localeCompare(b.lastName)).map(emp => (
          <div key={emp.employeeId} style={{
            background: 'var(--color-surface)', border: '1px solid var(--color-border)',
            borderRadius: 8, padding: '14px 18px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12,
          }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{emp.lastName}, {emp.firstName} {emp.middleName}</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                TIN: {emp.tinNo || '—'} &nbsp;·&nbsp; Position: {emp.position || '—'}
              </div>
              <div style={{ fontSize: 12, marginTop: 4, display: 'flex', gap: 20 }}>
                <span>Gross: ₱{fmt(emp.grossPay)}</span>
                <span>W/Tax: ₱{fmt(emp.withholdingTax)}</span>
                <span>Net: ₱{fmt(emp.netPay)}</span>
              </div>
            </div>
            <button
              onClick={() => printEmployee2316(emp, data.company, year)}
              style={{
                padding: '6px 14px', borderRadius: 6,
                background: 'var(--color-surface-2)', color: 'var(--color-text-primary)',
                border: '1px solid var(--color-border)', fontWeight: 600, fontSize: 13, cursor: 'pointer',
              }}
            >🖨️ Print 2316</button>
          </div>
        ))}
        {data.employees.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--color-text-muted)' }}>
            No payroll data found for {year}.
          </div>
        )}
      </div>
    </div>
  );
}
