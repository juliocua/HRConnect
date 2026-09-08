import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { formatPHP } from '@/lib/payroll';
import type { Client, Employee } from '@/types';

type ReportType = 'billing-summary' | 'margin' | 'deployment' | 'attendance-summary';

const REPORT_TYPES: { key: ReportType; label: string; icon: string; desc: string }[] = [
  { key: 'billing-summary', label: 'Billing Summary', icon: '📄', desc: 'Invoice totals and payment status by client and date range' },
  { key: 'margin', label: 'Payroll vs Billing Margin', icon: '💹', desc: 'Compare resource cost billed vs payroll cost per employee' },
  { key: 'deployment', label: 'Employee Deployment', icon: '🏢', desc: 'Which employees are deployed to which clients' },
  { key: 'attendance-summary', label: 'Attendance Summary', icon: '📅', desc: 'Attendance rates and leave statistics by date range' },
];

const GROUP_BY_OPTIONS: Record<ReportType, { value: string; label: string }[]> = {
  'billing-summary': [],
  'margin': [
    { value: 'client', label: 'Client' },
    { value: 'department', label: 'Department' },
  ],
  'deployment': [
    { value: 'client', label: 'Client' },
    { value: 'department', label: 'Department' },
    { value: 'status', label: 'Status' },
  ],
  'attendance-summary': [
    { value: 'client', label: 'Client' },
    { value: 'department', label: 'Department' },
  ],
};

function MultiSelect({ label, options, selected, onChange }: {
  label: string;
  options: { id: string; name: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const toggle = (id: string) => {
    if (selected.includes(id)) onChange(selected.filter(x => x !== id));
    else onChange([...selected, id]);
  };
  const [open, setOpen] = useState(false);
  const displayText = selected.length === 0
    ? `All ${label}`
    : selected.length === 1
      ? options.find(o => o.id === selected[0])?.name ?? '1 selected'
      : `${selected.length} selected`;

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        className="form-control"
        style={{ textAlign: 'left', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
        onClick={() => setOpen(v => !v)}
      >
        <span style={{ color: selected.length === 0 ? 'var(--color-text-muted)' : undefined }}>{displayText}</span>
        <span style={{ fontSize: 10 }}>▼</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
          background: 'var(--color-surface)', border: '1px solid var(--color-border)',
          borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', maxHeight: 220, overflowY: 'auto',
        }}>
          {options.length === 0 && (
            <div style={{ padding: '10px 14px', fontSize: 13, color: 'var(--color-text-muted)' }}>No options</div>
          )}
          {options.map(o => (
            <label key={o.id} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px',
              cursor: 'pointer', fontSize: 13,
              background: selected.includes(o.id) ? 'var(--color-primary-light)' : undefined,
            }}>
              <input type="checkbox" checked={selected.includes(o.id)} onChange={() => toggle(o.id)} />
              {o.name}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Report result types ────────────────────────────────────────────────────────
interface BillingSummaryRow {
  client: { id: string; name: string };
  totalBilled: number;
  totalPaid: number;
  totalPending: number;
  invoiceCount: number;
}

interface MarginRow {
  employee: { id: string; firstName: string; lastName: string; position: string; department: { name: string } | null };
  client: { id: string; name: string } | null;
  resourceCost: number;
  payrollCost: number;
  margin: number;
  marginPct: number;
}

interface DeploymentRow {
  employee: { id: string; firstName: string; lastName: string; position: string; status: string; avatarColor: string; department: { name: string } | null };
  client: { id: string; name: string } | null;
  resourceCost: number | null;
  payrollCost: number | null;
}

interface AttendanceSummaryRow {
  employee: { id: string; firstName: string; lastName: string; position: string; department: { name: string } | null };
  client?: { id: string; name: string } | null;
  present: number;
  late: number;
  absent: number;
  onLeave: number;
  total: number;
  attendanceRate: number;
}

// ── Grouping helper ────────────────────────────────────────────────────────────
function groupRows<T, G>(
  data: T[],
  keyFn: (row: T) => string,
  aggFn: (groupName: string, rows: T[]) => G,
): (G & { _rows: T[] })[] {
  const map = new Map<string, T[]>();
  for (const row of data) {
    const key = keyFn(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(row);
  }
  return [...map.entries()].map(([key, rows]) => ({ ...aggFn(key, rows), _rows: rows }));
}

// Shared expand toggle button
function ExpandToggle({ expanded }: { expanded: boolean }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 20, height: 20, borderRadius: 4,
      background: 'var(--color-surface-2)', fontSize: 10,
      transition: 'transform 0.15s', transform: expanded ? 'rotate(90deg)' : 'none',
      flexShrink: 0,
    }}>▶</span>
  );
}

// Shared group row style
const GROUP_ROW_STYLE: React.CSSProperties = {
  cursor: 'pointer',
  background: 'var(--color-surface-2)',
  fontWeight: 700,
};

// Shared detail row style
const DETAIL_ROW_STYLE: React.CSSProperties = {
  background: 'var(--color-surface)',
};

// ── CSV export helper ──────────────────────────────────────────────────────────
function exportCSV(rows: Record<string, string | number>[], filename: string) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csvContent = [
    headers.join(','),
    ...rows.map(r => headers.map(h => {
      const val = String(r[h] ?? '');
      return val.includes(',') || val.includes('"') || val.includes('\n')
        ? `"${val.replace(/"/g, '""')}"`
        : val;
    }).join(','))
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function buildCSVRows(reportType: ReportType, data: any[]): Record<string, string | number>[] {
  if (!data || !data.length) return [];
  if (reportType === 'billing-summary') {
    return (data as BillingSummaryRow[]).map(r => ({
      Client: r.client.name,
      Invoices: r.invoiceCount,
      'Total Billed': r.totalBilled,
      Collected: r.totalPaid,
      Outstanding: r.totalPending,
      'Collection Rate %': r.totalBilled > 0 ? Math.round((r.totalPaid / r.totalBilled) * 100) : 0,
    }));
  }
  if (reportType === 'margin') {
    return (data as MarginRow[]).map(r => ({
      Employee: `${r.employee.firstName} ${r.employee.lastName}`,
      Position: r.employee.position,
      Department: r.employee.department?.name ?? '',
      Client: r.client?.name ?? '',
      'Resource Cost': r.resourceCost,
      'Payroll Cost': r.payrollCost,
      Margin: r.margin,
      'Margin %': r.marginPct.toFixed(2),
    }));
  }
  if (reportType === 'deployment') {
    return (data as DeploymentRow[]).map(r => ({
      Employee: `${r.employee.firstName} ${r.employee.lastName}`,
      Position: r.employee.position,
      Department: r.employee.department?.name ?? '',
      Status: r.employee.status,
      Client: r.client?.name ?? 'On Bench',
      'Resource Cost': r.resourceCost ?? 0,
      'Payroll Cost': r.payrollCost ?? 0,
    }));
  }
  if (reportType === 'attendance-summary') {
    return (data as AttendanceSummaryRow[]).map(r => ({
      Employee: `${r.employee.firstName} ${r.employee.lastName}`,
      Position: r.employee.position,
      Department: r.employee.department?.name ?? '',
      Client: r.client?.name ?? '',
      Present: r.present,
      Late: r.late,
      Absent: r.absent,
      'On Leave': r.onLeave,
      'Total Days': r.total,
      'Attendance Rate %': r.attendanceRate.toFixed(2),
    }));
  }
  return [];
}

export default function Reports() {
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 8) + '01';

  const [reportType, setReportType] = useState<ReportType>('billing-summary');
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [clientIds, setClientIds] = useState<string[]>([]);
  const [employeeIds, setEmployeeIds] = useState<string[]>([]);
  const [hasRun, setHasRun] = useState(false);
  const [queryParams, setQueryParams] = useState<Record<string, string>>({});
  const [groupBy, setGroupBy] = useState('');

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ['clients'],
    queryFn: () => api.get('/clients').then(r => r.data),
  });

  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ['employees'],
    queryFn: () => api.get('/employees').then(r => r.data),
  });

  const buildParams = (): Record<string, string> => {
    const p: Record<string, string> = {};
    if (from) p.from = from;
    if (to) p.to = to;
    if (clientIds.length) p.clientIds = clientIds.join(',');
    if (employeeIds.length) p.employeeIds = employeeIds.join(',');
    return p;
  };

  const { data: reportData, isFetching, refetch } = useQuery({
    queryKey: ['report', reportType, queryParams],
    queryFn: () => {
      const params = new URLSearchParams(queryParams).toString();
      return api.get(`/billing/reports/${reportType}?${params}`).then(r => r.data);
    },
    enabled: hasRun,
  });

  const runReport = () => {
    setQueryParams(buildParams());
    setHasRun(true);
    setTimeout(() => refetch(), 0);
  };

  const selectedType = REPORT_TYPES.find(r => r.key === reportType)!;
  const needsDates = reportType === 'billing-summary' || reportType === 'attendance-summary';
  const needsClients = reportType === 'billing-summary' || reportType === 'margin' || reportType === 'deployment' || reportType === 'attendance-summary';
  const needsEmployees = reportType === 'margin' || reportType === 'deployment' || reportType === 'attendance-summary';
  const groupByOptions = GROUP_BY_OPTIONS[reportType];

  const rowCount = reportData && Array.isArray(reportData) ? reportData.length : 0;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Reports</h1>
          <p className="page-desc">Generate and export insights across billing, payroll, and attendance</p>
        </div>
      </div>

      {/* Report type selector */}
      <div className="grid-4" style={{ marginBottom: 20 }}>
        {REPORT_TYPES.map(r => (
          <div
            key={r.key}
            onClick={() => { setReportType(r.key); setHasRun(false); setGroupBy(''); }}
            style={{
              padding: '14px', borderRadius: 12, cursor: 'pointer',
              background: reportType === r.key ? 'var(--color-primary-light)' : 'var(--color-surface)',
              border: `2px solid ${reportType === r.key ? 'var(--color-primary)' : 'var(--color-border)'}`,
              transition: 'all 0.15s',
            }}
          >
            <div style={{ fontSize: 22, marginBottom: 6 }}>{r.icon}</div>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 3 }}>{r.label}</div>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', lineHeight: 1.4 }}>{r.desc}</div>
          </div>
        ))}
      </div>

      {/* Compact Filters */}
      <div className="card" style={{ marginBottom: 20, padding: '14px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-muted)', whiteSpace: 'nowrap', marginRight: 4 }}>
            {selectedType.icon} {selectedType.label}:
          </span>

          {needsDates && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <label style={{ fontSize: 12, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>From</label>
                <input type="date" className="form-control" style={{ width: 140, fontSize: 13, padding: '5px 8px' }} value={from} onChange={e => setFrom(e.target.value)} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <label style={{ fontSize: 12, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>To</label>
                <input type="date" className="form-control" style={{ width: 140, fontSize: 13, padding: '5px 8px' }} value={to} onChange={e => setTo(e.target.value)} />
              </div>
            </>
          )}

          {needsClients && (
            <div style={{ minWidth: 160 }}>
              <MultiSelect
                label="Clients"
                options={clients.map(c => ({ id: c.id, name: c.name }))}
                selected={clientIds}
                onChange={setClientIds}
              />
            </div>
          )}

          {needsEmployees && (
            <div style={{ minWidth: 160 }}>
              <MultiSelect
                label="Employees"
                options={employees.map(e => ({ id: e.id, name: `${e.firstName} ${e.lastName}` }))}
                selected={employeeIds}
                onChange={setEmployeeIds}
              />
            </div>
          )}

          {groupByOptions.length > 0 && (
            <select
              className="form-control"
              style={{ width: 160, fontSize: 13, padding: '5px 8px' }}
              value={groupBy}
              onChange={e => setGroupBy(e.target.value)}
            >
              <option value="">No Grouping</option>
              {groupByOptions.map(o => (
                <option key={o.value} value={o.value}>Group by {o.label}</option>
              ))}
            </select>
          )}

          <button
            className="btn btn-primary"
            style={{ whiteSpace: 'nowrap' }}
            onClick={runReport}
            disabled={isFetching}
          >
            {isFetching ? '⏳ Generating…' : '▶ Run Report'}
          </button>
        </div>
      </div>

      {/* Results */}
      {hasRun && (
        <div className="card">
          <div className="card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div className="card-title">
                Results
              </div>
              {groupBy && (
                <span style={{
                  fontSize: 12, fontWeight: 600,
                  background: 'var(--color-primary-light)', color: 'var(--color-primary)',
                  padding: '2px 10px', borderRadius: 99,
                }}>
                  Grouped by {groupByOptions.find(o => o.value === groupBy)?.label}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {rowCount > 0 && (
                <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{rowCount} row{rowCount !== 1 ? 's' : ''}</span>
              )}
              {reportData && Array.isArray(reportData) && reportData.length > 0 && (
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ fontSize: 12 }}
                  onClick={() => {
                    const rows = buildCSVRows(reportType, reportData);
                    exportCSV(rows, `${reportType}-${new Date().toISOString().slice(0, 10)}.csv`);
                  }}
                >
                  ⬇ CSV
                </button>
              )}
            </div>
          </div>
          {isFetching ? (
            <div className="loading-center" style={{ padding: 48 }}><div className="spinner" /></div>
          ) : !reportData ? (
            <div className="empty-state"><div>No data returned</div></div>
          ) : reportType === 'billing-summary' ? (
            <BillingSummaryTable data={reportData as BillingSummaryRow[]} />
          ) : reportType === 'margin' ? (
            <MarginTable data={reportData as MarginRow[]} groupBy={groupBy} />
          ) : reportType === 'deployment' ? (
            <DeploymentTable data={reportData as DeploymentRow[]} groupBy={groupBy} />
          ) : (
            <AttendanceTable data={reportData as AttendanceSummaryRow[]} groupBy={groupBy} />
          )}
        </div>
      )}
    </div>
  );
}

// ── Billing Summary Table ──────────────────────────────────────────────────────
function BillingSummaryTable({ data }: { data: BillingSummaryRow[] }) {
  if (data.length === 0) return <EmptyResult />;
  const totalBilled = data.reduce((s, r) => s + r.totalBilled, 0);
  const totalPaid = data.reduce((s, r) => s + r.totalPaid, 0);
  const totalPending = data.reduce((s, r) => s + r.totalPending, 0);
  return (
    <div>
      <div className="grid-4" style={{ marginBottom: 16 }}>
        <SummaryBox label="Total Billed" value={formatPHP(totalBilled)} color="#EFF6FF" />
        <SummaryBox label="Collected" value={formatPHP(totalPaid)} color="#F0FDF4" />
        <SummaryBox label="Outstanding" value={formatPHP(totalPending)} color="#FEF2F2" />
        <SummaryBox label="Invoices" value={String(data.reduce((s, r) => s + r.invoiceCount, 0))} color="#FFFBEB" />
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Client</th>
              <th style={{ textAlign: 'right' }}>Invoices</th>
              <th style={{ textAlign: 'right' }}>Total Billed</th>
              <th style={{ textAlign: 'right' }}>Collected</th>
              <th style={{ textAlign: 'right' }}>Outstanding</th>
              <th style={{ textAlign: 'right' }}>Collection Rate</th>
            </tr>
          </thead>
          <tbody>
            {data.map(r => (
              <tr key={r.client.id}>
                <td style={{ fontWeight: 600 }}>{r.client.name}</td>
                <td style={{ textAlign: 'right' }}>{r.invoiceCount}</td>
                <td style={{ textAlign: 'right' }}>{formatPHP(r.totalBilled)}</td>
                <td style={{ textAlign: 'right', color: 'var(--color-success)', fontWeight: 600 }}>{formatPHP(r.totalPaid)}</td>
                <td style={{ textAlign: 'right', color: r.totalPending > 0 ? 'var(--color-danger)' : undefined }}>{formatPHP(r.totalPending)}</td>
                <td style={{ textAlign: 'right' }}>
                  <span style={{ fontWeight: 700 }}>
                    {r.totalBilled > 0 ? Math.round((r.totalPaid / r.totalBilled) * 100) : 0}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Margin Table ───────────────────────────────────────────────────────────────
function MarginTable({ data, groupBy }: { data: MarginRow[]; groupBy: string }) {
  if (data.length === 0) return <EmptyResult />;
  const totalRC = data.reduce((s, r) => s + r.resourceCost, 0);
  const totalPC = data.reduce((s, r) => s + r.payrollCost, 0);
  const totalMargin = totalRC - totalPC;

  if (groupBy === 'client' || groupBy === 'department') {
    type MarginGroup = {
      name: string;
      count: number;
      totalRC: number;
      totalPC: number;
      totalMargin: number;
      avgMarginPct: number;
    };
    const keyFn = groupBy === 'client'
      ? (r: MarginRow) => r.client?.name ?? '— Not Deployed —'
      : (r: MarginRow) => r.employee.department?.name ?? '— No Department —';

    const groups = groupRows<MarginRow, MarginGroup>(data, keyFn, (name, rows) => {
      const rc = rows.reduce((s, r) => s + r.resourceCost, 0);
      const pc = rows.reduce((s, r) => s + r.payrollCost, 0);
      const margin = rc - pc;
      return { name, count: rows.length, totalRC: rc, totalPC: pc, totalMargin: margin, avgMarginPct: rc > 0 ? (margin / rc) * 100 : 0 };
    }).sort((a, b) => b.totalRC - a.totalRC);

    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const toggle = (name: string) => setExpanded(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });

    return (
      <div>
        <div className="grid-4" style={{ marginBottom: 16 }}>
          <SummaryBox label="Total Billed to Clients" value={formatPHP(totalRC)} color="#EFF6FF" />
          <SummaryBox label="Total Payroll Cost" value={formatPHP(totalPC)} color="#FEF2F2" />
          <SummaryBox label="Net Margin" value={formatPHP(totalMargin)} color={totalMargin >= 0 ? '#F0FDF4' : '#FEF2F2'} />
          <SummaryBox label="Groups" value={String(groups.length)} color="#FFFBEB" />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{groupBy === 'client' ? 'Client' : 'Department'}</th>
                <th style={{ textAlign: 'right' }}>Employees</th>
                <th style={{ textAlign: 'right' }}>Total Billed</th>
                <th style={{ textAlign: 'right' }}>Total Payroll</th>
                <th style={{ textAlign: 'right' }}>Net Margin</th>
                <th style={{ textAlign: 'right' }}>Margin %</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(g => {
                const isOpen = expanded.has(g.name);
                return (
                  <React.Fragment key={g.name}>
                    <tr style={GROUP_ROW_STYLE} onClick={() => toggle(g.name)}>
                      <td><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><ExpandToggle expanded={isOpen} />{g.name}</div></td>
                      <td style={{ textAlign: 'right' }}>{g.count}</td>
                      <td style={{ textAlign: 'right' }}>{g.totalRC > 0 ? formatPHP(g.totalRC) : '—'}</td>
                      <td style={{ textAlign: 'right' }}>{g.totalPC > 0 ? formatPHP(g.totalPC) : '—'}</td>
                      <td style={{ textAlign: 'right', color: g.totalMargin >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                        {g.totalRC > 0 || g.totalPC > 0 ? formatPHP(g.totalMargin) : '—'}
                      </td>
                      <td style={{ textAlign: 'right' }}>{g.totalRC > 0 ? `${g.avgMarginPct.toFixed(1)}%` : '—'}</td>
                    </tr>
                    {isOpen && g._rows.map(r => (
                      <tr key={r.employee.id} style={DETAIL_ROW_STYLE}>
                        <td style={{ paddingLeft: 40 }}>
                          <div style={{ fontSize: 13 }}>{r.employee.firstName} {r.employee.lastName}</div>
                          <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{r.employee.position}{groupBy === 'client' && r.employee.department ? ` · ${r.employee.department.name}` : ''}{groupBy === 'department' && r.client ? ` · ${r.client.name}` : ''}</div>
                        </td>
                        <td style={{ textAlign: 'right' }}>—</td>
                        <td style={{ textAlign: 'right' }}>{r.resourceCost > 0 ? formatPHP(r.resourceCost) : <span style={{ color: 'var(--color-text-muted)' }}>—</span>}</td>
                        <td style={{ textAlign: 'right' }}>{r.payrollCost > 0 ? formatPHP(r.payrollCost) : <span style={{ color: 'var(--color-text-muted)' }}>—</span>}</td>
                        <td style={{ textAlign: 'right', color: r.margin >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                          {r.resourceCost > 0 || r.payrollCost > 0 ? formatPHP(r.margin) : '—'}
                        </td>
                        <td style={{ textAlign: 'right' }}>{r.resourceCost > 0 ? `${r.marginPct.toFixed(1)}%` : '—'}</td>
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // Flat (no grouping)
  return (
    <div>
      <div className="grid-4" style={{ marginBottom: 16 }}>
        <SummaryBox label="Total Billed to Clients" value={formatPHP(totalRC)} color="#EFF6FF" />
        <SummaryBox label="Total Payroll Cost" value={formatPHP(totalPC)} color="#FEF2F2" />
        <SummaryBox label="Net Margin" value={formatPHP(totalMargin)} color={totalMargin >= 0 ? '#F0FDF4' : '#FEF2F2'} />
        <SummaryBox label="Avg Margin %" value={totalRC > 0 ? `${Math.round((totalMargin / totalRC) * 100)}%` : '—'} color="#FFFBEB" />
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Employee</th>
              <th>Client</th>
              <th style={{ textAlign: 'right' }}>Billed (Resource Cost)</th>
              <th style={{ textAlign: 'right' }}>Payroll Cost</th>
              <th style={{ textAlign: 'right' }}>Margin</th>
              <th style={{ textAlign: 'right' }}>Margin %</th>
            </tr>
          </thead>
          <tbody>
            {data.map(r => (
              <tr key={r.employee.id}>
                <td>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{r.employee.firstName} {r.employee.lastName}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{r.employee.position}</div>
                </td>
                <td style={{ color: r.client ? undefined : 'var(--color-text-muted)', fontSize: 13 }}>
                  {r.client?.name ?? '— Not deployed —'}
                </td>
                <td style={{ textAlign: 'right' }}>{r.resourceCost > 0 ? formatPHP(r.resourceCost) : <span style={{ color: 'var(--color-text-muted)' }}>—</span>}</td>
                <td style={{ textAlign: 'right' }}>{r.payrollCost > 0 ? formatPHP(r.payrollCost) : <span style={{ color: 'var(--color-text-muted)' }}>—</span>}</td>
                <td style={{ textAlign: 'right', color: r.margin >= 0 ? 'var(--color-success)' : 'var(--color-danger)', fontWeight: 700 }}>
                  {r.resourceCost > 0 || r.payrollCost > 0 ? formatPHP(r.margin) : '—'}
                </td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>
                  {r.resourceCost > 0 ? `${r.marginPct.toFixed(1)}%` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Deployment Table ───────────────────────────────────────────────────────────
function DeploymentTable({ data, groupBy }: { data: DeploymentRow[]; groupBy: string }) {
  if (data.length === 0) return <EmptyResult />;
  const deployed = data.filter(r => r.client).length;
  const bench = data.length - deployed;

  if (groupBy === 'client' || groupBy === 'department' || groupBy === 'status') {
    type DeployGroup = {
      name: string;
      count: number;
      deployedCount: number;
      totalRC: number;
      totalPC: number;
    };
    const keyFn =
      groupBy === 'client' ? (r: DeploymentRow) => r.client?.name ?? '— On Bench —'
      : groupBy === 'department' ? (r: DeploymentRow) => r.employee.department?.name ?? '— No Department —'
      : (r: DeploymentRow) => r.employee.status.replace(/_/g, ' ');

    const groups = groupRows<DeploymentRow, DeployGroup>(data, keyFn, (name, rows) => ({
      name,
      count: rows.length,
      deployedCount: rows.filter(r => r.client).length,
      totalRC: rows.reduce((s, r) => s + (r.resourceCost ?? 0), 0),
      totalPC: rows.reduce((s, r) => s + (r.payrollCost ?? 0), 0),
    })).sort((a, b) => b.count - a.count);

    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const toggle = (name: string) => setExpanded(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });

    return (
      <div>
        <div className="grid-4" style={{ marginBottom: 16 }}>
          <SummaryBox label="Total Employees" value={String(data.length)} color="#EFF6FF" />
          <SummaryBox label="Deployed" value={String(deployed)} color="#F0FDF4" />
          <SummaryBox label="On Bench" value={String(bench)} color="#FFFBEB" />
          <SummaryBox label="Groups" value={String(groups.length)} color="#F5F3FF" />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{groupBy === 'client' ? 'Client' : groupBy === 'department' ? 'Department' : 'Status'}</th>
                <th style={{ textAlign: 'right' }}>Employees</th>
                {groupBy !== 'status' && <th style={{ textAlign: 'right' }}>Deployed</th>}
                {groupBy !== 'status' && <th style={{ textAlign: 'right' }}>Deployment %</th>}
                <th style={{ textAlign: 'right' }}>Total Resource Cost</th>
                <th style={{ textAlign: 'right' }}>Total Payroll Cost</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(g => {
                const isOpen = expanded.has(g.name);
                return (
                  <React.Fragment key={g.name}>
                    <tr style={GROUP_ROW_STYLE} onClick={() => toggle(g.name)}>
                      <td><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><ExpandToggle expanded={isOpen} />{g.name}</div></td>
                      <td style={{ textAlign: 'right' }}>{g.count}</td>
                      {groupBy !== 'status' && <td style={{ textAlign: 'right' }}>{g.deployedCount}</td>}
                      {groupBy !== 'status' && (
                        <td style={{ textAlign: 'right', color: g.count > 0 && (g.deployedCount / g.count) >= 0.8 ? 'var(--color-success)' : undefined }}>
                          {g.count > 0 ? `${Math.round((g.deployedCount / g.count) * 100)}%` : '—'}
                        </td>
                      )}
                      <td style={{ textAlign: 'right' }}>{g.totalRC > 0 ? formatPHP(g.totalRC) : '—'}</td>
                      <td style={{ textAlign: 'right' }}>{g.totalPC > 0 ? formatPHP(g.totalPC) : '—'}</td>
                    </tr>
                    {isOpen && g._rows.map(r => (
                      <tr key={r.employee.id} style={DETAIL_ROW_STYLE}>
                        <td style={{ paddingLeft: 40 }}>
                          <div className="emp-info">
                            <div className="emp-avatar" style={{ background: r.employee.avatarColor, width: 26, height: 26, fontSize: 10 }}>
                              {r.employee.firstName[0]}{r.employee.lastName[0]}
                            </div>
                            <div>
                              <div style={{ fontSize: 13 }}>{r.employee.firstName} {r.employee.lastName}</div>
                              <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                                {r.employee.position}
                                {groupBy === 'client' && r.employee.department ? ` · ${r.employee.department.name}` : ''}
                                {groupBy === 'department' && r.client ? ` · ${r.client.name}` : ''}
                                {groupBy === 'status' && r.client ? ` · ${r.client.name}` : ' · On Bench'}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td style={{ textAlign: 'right' }}>—</td>
                        {groupBy !== 'status' && <td style={{ textAlign: 'right' }}>{r.client ? <span className="badge badge-green" style={{ fontSize: 10 }}>Yes</span> : <span className="badge badge-gray" style={{ fontSize: 10 }}>No</span>}</td>}
                        {groupBy !== 'status' && <td style={{ textAlign: 'right' }}>—</td>}
                        <td style={{ textAlign: 'right' }}>{r.resourceCost != null && r.resourceCost > 0 ? formatPHP(r.resourceCost) : <span style={{ color: 'var(--color-text-muted)' }}>—</span>}</td>
                        <td style={{ textAlign: 'right' }}>{r.payrollCost != null && r.payrollCost > 0 ? formatPHP(r.payrollCost) : <span style={{ color: 'var(--color-text-muted)' }}>—</span>}</td>
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // Flat (no grouping)
  return (
    <div>
      <div className="grid-4" style={{ marginBottom: 16 }}>
        <SummaryBox label="Total Employees" value={String(data.length)} color="#EFF6FF" />
        <SummaryBox label="Deployed" value={String(deployed)} color="#F0FDF4" />
        <SummaryBox label="On Bench" value={String(bench)} color="#FFFBEB" />
        <SummaryBox label="Deployment Rate" value={data.length > 0 ? `${Math.round((deployed / data.length) * 100)}%` : '—'} color="#F5F3FF" />
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Employee</th>
              <th>Status</th>
              <th>Deployed To</th>
              <th style={{ textAlign: 'right' }}>Resource Cost (Billed)</th>
              <th style={{ textAlign: 'right' }}>Payroll Cost</th>
            </tr>
          </thead>
          <tbody>
            {data.map(r => (
              <tr key={r.employee.id}>
                <td>
                  <div className="emp-info">
                    <div className="emp-avatar" style={{ background: r.employee.avatarColor, width: 32, height: 32, fontSize: 12 }}>
                      {r.employee.firstName[0]}{r.employee.lastName[0]}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{r.employee.firstName} {r.employee.lastName}</div>
                      <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{r.employee.position}</div>
                    </div>
                  </div>
                </td>
                <td>
                  <span className={`badge ${r.employee.status === 'ACTIVE' ? 'badge-green' : r.employee.status === 'ON_LEAVE' ? 'badge-yellow' : 'badge-gray'}`}>
                    {r.employee.status.replace('_', ' ')}
                  </span>
                </td>
                <td>
                  {r.client
                    ? <span style={{ fontWeight: 600 }}>{r.client.name}</span>
                    : <span className="badge badge-gray">On Bench</span>
                  }
                </td>
                <td style={{ textAlign: 'right' }}>
                  {r.resourceCost != null && r.resourceCost > 0 ? formatPHP(r.resourceCost) : <span style={{ color: 'var(--color-text-muted)' }}>—</span>}
                </td>
                <td style={{ textAlign: 'right' }}>
                  {r.payrollCost != null && r.payrollCost > 0 ? formatPHP(r.payrollCost) : <span style={{ color: 'var(--color-text-muted)' }}>—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Attendance Summary Table ───────────────────────────────────────────────────
function AttendanceTable({ data, groupBy }: { data: AttendanceSummaryRow[]; groupBy: string }) {
  if (data.length === 0) return <EmptyResult />;
  const avgRate = data.length > 0 ? data.reduce((s, r) => s + r.attendanceRate, 0) / data.length : 0;

  type AttGroup = {
    name: string;
    count: number;
    totalPresent: number;
    totalAbsent: number;
    totalOnLeave: number;
    totalDays: number;
    avgRate: number;
  };

  const makeGroupFn = (keyFn: (r: AttendanceSummaryRow) => string) =>
    groupRows<AttendanceSummaryRow, AttGroup>(data, keyFn, (name, rows) => {
      const totalPresent = rows.reduce((s, r) => s + r.present, 0);
      const totalAbsent = rows.reduce((s, r) => s + r.absent, 0);
      const totalOnLeave = rows.reduce((s, r) => s + r.onLeave, 0);
      const totalDays = rows.reduce((s, r) => s + r.total, 0);
      const avg = rows.length > 0 ? rows.reduce((s, r) => s + r.attendanceRate, 0) / rows.length : 0;
      return { name, count: rows.length, totalPresent, totalAbsent, totalOnLeave, totalDays, avgRate: avg };
    }).sort((a, b) => b.avgRate - a.avgRate);

  if (groupBy === 'department' || groupBy === 'client') {
    const keyFn = groupBy === 'client'
      ? (r: AttendanceSummaryRow) => r.client?.name ?? '— No Client —'
      : (r: AttendanceSummaryRow) => r.employee.department?.name ?? '— No Department —';

    const groups = makeGroupFn(keyFn);

    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const toggle = (name: string) => setExpanded(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });

    return (
      <div>
        <div className="grid-4" style={{ marginBottom: 16 }}>
          <SummaryBox label="Employees" value={String(data.length)} color="#EFF6FF" />
          <SummaryBox label="Avg Attendance Rate" value={`${avgRate.toFixed(1)}%`} color="#F0FDF4" />
          <SummaryBox label="Total Absent Days" value={String(data.reduce((s, r) => s + r.absent, 0))} color="#FEF2F2" />
          <SummaryBox label={groupBy === 'client' ? 'Clients' : 'Departments'} value={String(groups.length)} color="#FFFBEB" />
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{groupBy === 'client' ? 'Client' : 'Department'}</th>
                <th style={{ textAlign: 'right' }}>Employees</th>
                <th style={{ textAlign: 'right' }}>Present</th>
                <th style={{ textAlign: 'right' }}>Absent</th>
                <th style={{ textAlign: 'right' }}>On Leave</th>
                <th style={{ textAlign: 'right' }}>Total Days</th>
                <th style={{ textAlign: 'right' }}>Avg Attendance</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(g => {
                const isOpen = expanded.has(g.name);
                return (
                  <React.Fragment key={g.name}>
                    <tr style={GROUP_ROW_STYLE} onClick={() => toggle(g.name)}>
                      <td><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><ExpandToggle expanded={isOpen} />{g.name}</div></td>
                      <td style={{ textAlign: 'right' }}>{g.count}</td>
                      <td style={{ textAlign: 'right', color: 'var(--color-success)' }}>{g.totalPresent}</td>
                      <td style={{ textAlign: 'right', color: g.totalAbsent > 0 ? 'var(--color-danger)' : undefined }}>{g.totalAbsent}</td>
                      <td style={{ textAlign: 'right' }}>{g.totalOnLeave}</td>
                      <td style={{ textAlign: 'right' }}>{g.totalDays}</td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                          <div style={{ width: 48, background: 'var(--color-surface-2)', borderRadius: 99, height: 6, overflow: 'hidden' }}>
                            <div style={{ width: `${g.avgRate}%`, background: g.avgRate >= 90 ? 'var(--color-success)' : g.avgRate >= 75 ? 'var(--color-warning)' : 'var(--color-danger)', height: '100%' }} />
                          </div>
                          <span style={{ fontWeight: 700, minWidth: 38 }}>{g.avgRate.toFixed(1)}%</span>
                        </div>
                      </td>
                    </tr>
                    {isOpen && g._rows.map(r => (
                      <tr key={r.employee.id} style={DETAIL_ROW_STYLE}>
                        <td style={{ paddingLeft: 40 }}>
                          <div style={{ fontSize: 13 }}>{r.employee.firstName} {r.employee.lastName}</div>
                          <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                            {r.employee.position}
                            {groupBy === 'client' && r.employee.department ? ` · ${r.employee.department.name}` : ''}
                            {groupBy === 'department' && r.client ? ` · ${r.client.name}` : ''}
                          </div>
                        </td>
                        <td style={{ textAlign: 'right' }}>—</td>
                        <td style={{ textAlign: 'right', color: 'var(--color-success)' }}>{r.present}</td>
                        <td style={{ textAlign: 'right', color: r.absent > 0 ? 'var(--color-danger)' : undefined }}>{r.absent}</td>
                        <td style={{ textAlign: 'right' }}>{r.onLeave}</td>
                        <td style={{ textAlign: 'right' }}>{r.total}</td>
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                            <div style={{ width: 48, background: 'var(--color-surface-2)', borderRadius: 99, height: 6, overflow: 'hidden' }}>
                              <div style={{ width: `${r.attendanceRate}%`, background: r.attendanceRate >= 90 ? 'var(--color-success)' : r.attendanceRate >= 75 ? 'var(--color-warning)' : 'var(--color-danger)', height: '100%' }} />
                            </div>
                            <span style={{ minWidth: 38 }}>{r.attendanceRate.toFixed(1)}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // Flat (no grouping)
  return (
    <div>
      <div className="grid-4" style={{ marginBottom: 16 }}>
        <SummaryBox label="Employees" value={String(data.length)} color="#EFF6FF" />
        <SummaryBox label="Avg Attendance Rate" value={`${avgRate.toFixed(1)}%`} color="#F0FDF4" />
        <SummaryBox label="Total Absent Days" value={String(data.reduce((s, r) => s + r.absent, 0))} color="#FEF2F2" />
        <SummaryBox label="Total Leave Days" value={String(data.reduce((s, r) => s + r.onLeave, 0))} color="#FFFBEB" />
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Employee</th>
              <th style={{ textAlign: 'right' }}>Present</th>
              <th style={{ textAlign: 'right' }}>Late</th>
              <th style={{ textAlign: 'right' }}>Absent</th>
              <th style={{ textAlign: 'right' }}>On Leave</th>
              <th style={{ textAlign: 'right' }}>Total Days</th>
              <th style={{ textAlign: 'right' }}>Attendance Rate</th>
            </tr>
          </thead>
          <tbody>
            {data.map(r => (
              <tr key={r.employee.id}>
                <td>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{r.employee.firstName} {r.employee.lastName}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{r.employee.position}</div>
                </td>
                <td style={{ textAlign: 'right', color: 'var(--color-success)', fontWeight: 600 }}>{r.present}</td>
                <td style={{ textAlign: 'right', color: 'var(--color-warning)' }}>{r.late}</td>
                <td style={{ textAlign: 'right', color: r.absent > 0 ? 'var(--color-danger)' : undefined }}>{r.absent}</td>
                <td style={{ textAlign: 'right' }}>{r.onLeave}</td>
                <td style={{ textAlign: 'right' }}>{r.total}</td>
                <td style={{ textAlign: 'right' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                    <div style={{ width: 48, background: 'var(--color-surface-2)', borderRadius: 99, height: 6, overflow: 'hidden' }}>
                      <div style={{ width: `${r.attendanceRate}%`, background: r.attendanceRate >= 90 ? 'var(--color-success)' : r.attendanceRate >= 75 ? 'var(--color-warning)' : 'var(--color-danger)', height: '100%' }} />
                    </div>
                    <span style={{ fontWeight: 700, minWidth: 38 }}>{r.attendanceRate.toFixed(1)}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SummaryBox({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ background: color, borderRadius: 10, padding: '12px 16px' }}>
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800 }}>{value}</div>
    </div>
  );
}

function EmptyResult() {
  return (
    <div className="empty-state" style={{ padding: '32px 0' }}>
      <div className="empty-state-icon">📊</div>
      <div>No data found for the selected filters</div>
    </div>
  );
}
