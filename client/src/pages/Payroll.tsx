import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { formatPHP } from '@/lib/payroll';
import type { PayrollRun, PayrollRecord, PayrollStatus } from '@/types';

const STATUS_COLORS: Record<PayrollStatus, string> = {
  DRAFT: 'badge-yellow', POSTED: 'badge-blue', PAID: 'badge-green',
};

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

export default function Payroll() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const now = new Date();
  const [showRunModal, setShowRunModal] = useState(false);
  const [viewRunId, setViewRunId] = useState<string | null>(null);
  const [showSlip, setShowSlip] = useState<PayrollRecord | null>(null);
  const [downloadingGovReport, setDownloadingGovReport] = useState(false);
  const [downloadingDisbursement, setDownloadingDisbursement] = useState(false);
  const [collapsedClients, setCollapsedClients] = useState<Set<string>>(new Set());
  const [payrollSearch, setPayrollSearch] = useState('');
  const [collapsedYears, setCollapsedYears] = useState<Set<string>>(new Set());
  const [expandedPayrollRows, setExpandedPayrollRows] = useState<Set<string>>(new Set());

  const isManager = user?.role === 'HR_MANAGER' || user?.role === 'SUPER_ADMIN';

  const { data: history = [], isLoading } = useQuery<(PayrollRun & { _count: { records: number } })[]>({
    queryKey: ['payroll-history'],
    queryFn: () => api.get('/payroll/history').then(r => r.data),
  });

  const { data: currentRun } = useQuery<PayrollRun | null>({
    queryKey: ['payroll-run', viewRunId],
    queryFn: () => viewRunId ? api.get(`/payroll/${viewRunId}`).then(r => r.data) : null,
    enabled: !!viewRunId,
  });

  const { data: auditLogs = [] } = useQuery<any[]>({
    queryKey: ['payroll-audit', viewRunId],
    queryFn: () => viewRunId ? api.get(`/payroll/audit?entityId=${viewRunId}`).then(r => r.data) : Promise.resolve([]),
    enabled: !!viewRunId && isManager,
  });

  const postMutation = useMutation({
    mutationFn: (runId: string) => api.put(`/payroll/${runId}/post`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payroll-history'] });
      qc.invalidateQueries({ queryKey: ['payroll-run', viewRunId] });
    },
  });

  const paidMutation = useMutation({
    mutationFn: (runId: string) => api.put(`/payroll/${runId}/paid`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payroll-history'] });
      qc.invalidateQueries({ queryKey: ['payroll-run', viewRunId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (runId: string) => api.delete(`/payroll/run/${runId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payroll-history'] });
      setViewRunId(null);
    },
  });

  const updateRecordMutation = useMutation({
    mutationFn: ({ recordId, otherDeductions, otherDeductionsNote }: {
      recordId: string;
      otherDeductions: number;
      otherDeductionsNote?: string | null;
    }) =>
      api.put(`/payroll/${viewRunId}/record/${recordId}`, { otherDeductions, otherDeductionsNote }).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payroll-run', viewRunId] }),
  });
  // Stable ref so handleOtherDeductionsBlur never changes identity (prevents column recreation & cell remount)
  const updateRecordMutationRef = useRef(updateRecordMutation);
  updateRecordMutationRef.current = updateRecordMutation;

  const records = currentRun?.records ?? [];
  const isDraft = currentRun?.status === 'DRAFT';
  const totalGross = records.reduce((s, r) => s + r.grossPay, 0);
  const totalDeductions = records.reduce((s, r) => s + r.totalDeductions, 0);
  const totalOtherDeductions = records.reduce((s, r) => s + (r.otherDeductions ?? 0), 0);
  const totalNet = records.reduce((s, r) => s + r.netPay, 0);
  const totalOT = records.reduce((s, r) => s + r.overtimePay, 0);

  // Stable callback — reads mutation from ref so columns never recreate on mutation state change
  const handleOtherDeductionsBlur = useCallback((recordId: string, value: number, note: string | null) => {
    updateRecordMutationRef.current.mutate({ recordId, otherDeductions: value, otherDeductionsNote: note });
  }, []);

  const handleDownloadGovReport = async () => {
    if (!viewRunId || !currentRun) return;
    setDownloadingGovReport(true);
    try {
      const resp = await api.get(`/payroll/${viewRunId}/gov-report`);
      const { month, year, records: govRecs } = resp.data;
      const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const header = ['Emp #','Employee','SSS','WISP','PHIC','HDMF','Withholding Tax'].join(',');
      const rows = govRecs.map((r: any) =>
        [r.employeeNo, `"${r.name}"`, r.sss.toFixed(2), r.wisp.toFixed(2), r.phic.toFixed(2), r.hdmf.toFixed(2), r.tax.toFixed(2)].join(',')
      );
      const csv = [header, ...rows].join('\r\n');
      const blob = new Blob(['﻿' + csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `GovBenefits_${MONTHS_SHORT[month - 1]}_${year}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { console.error('Failed to generate gov benefits report'); }
    finally { setDownloadingGovReport(false); }
  };

  const handleDownloadDisbursement = async () => {
    if (!viewRunId || !currentRun) return;
    setDownloadingDisbursement(true);
    try {
      const resp = await api.get(`/payroll/${viewRunId}/disbursement?grouped=true`);
      const { period, banks } = resp.data as {
        period: string;
        banks: { bankName: string; totalNetPay: number; records: any[] }[];
      };
      const safeRunPeriod = (period ?? viewRunId).replace(/[^a-zA-Z0-9_\-·]/g, '_');
      const safeVal = (v: string | null | undefined) => {
        if (!v) return '';
        const s = String(v);
        return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
      };
      for (const bank of banks) {
        const header = ['Employee Name', 'Bank Name', 'Account Number', 'Account Name', 'Net Pay'].join(',');
        const rows = bank.records.map((r: any) => [
          safeVal(`${r.employee.lastName}, ${r.employee.firstName}`),
          safeVal(r.employee.bankName),
          safeVal(r.employee.bankAccountNo),
          safeVal(r.employee.bankAccountName),
          r.netPay.toFixed(2),
        ].join(','));
        const footerRow = ['TOTAL', '', '', '', bank.totalNetPay.toFixed(2)].join(',');
        const csv = [header, ...rows, footerRow].join('\r\n');
        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const bankSlug = (bank.bankName ?? 'Unknown').replace(/[^a-zA-Z0-9]/g, '_');
        a.download = `Disbursement_${safeRunPeriod}_${bankSlug}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    } catch { console.error('Failed to generate bank disbursement files'); }
    finally { setDownloadingDisbursement(false); }
  };

  // Group records by client (with optional search filter)
  const groupedRecords = useMemo(() => {
    const q = payrollSearch.trim().toLowerCase();
    const filtered = q
      ? records.filter(r =>
          `${r.employee.firstName} ${r.employee.lastName}`.toLowerCase().includes(q) ||
          (r.employee.employeeNo ?? '').toLowerCase().includes(q) ||
          (r.employee.client?.name ?? '').toLowerCase().includes(q)
        )
      : records;
    const groups = new Map<string, PayrollRecord[]>();
    for (const r of filtered) {
      const key = r.employee.client?.name ?? '— No Client —';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [records, payrollSearch]);

  // Group history by year (newest first)
  const groupedHistory = useMemo(() => {
    const groups = new Map<string, typeof history>();
    for (const h of history) {
      const year = h.periodStart
        ? new Date(h.periodStart).getFullYear().toString()
        : 'Unknown';
      if (!groups.has(year)) groups.set(year, []);
      groups.get(year)!.push(h);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => Number(b) - Number(a));
  }, [history]);

  const toggleClient = (name: string) => setCollapsedClients(prev => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });

  const togglePayrollRow = (id: string) => setExpandedPayrollRows(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const toggleYear = (year: string) => setCollapsedYears(prev => {
    const next = new Set(prev);
    if (next.has(year)) next.delete(year); else next.add(year);
    return next;
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Payroll</h1>
          <p className="page-desc">Philippine payroll computation (TRAIN Law)</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {viewRunId && currentRun?.status === 'DRAFT' && isManager && (
            <>
              <button
                className="btn btn-ghost"
                style={{ color: 'var(--color-danger)' }}
                disabled={deleteMutation.isPending}
                onClick={() => {
                  if (confirm('Delete this draft payroll run? This cannot be undone.')) {
                    deleteMutation.mutate(viewRunId);
                  }
                }}
              >
                {deleteMutation.isPending ? 'Deleting…' : '🗑 Delete Draft'}
              </button>
              <button className="btn btn-success" disabled={postMutation.isPending} onClick={() => postMutation.mutate(viewRunId)}>
                {postMutation.isPending ? 'Posting…' : '✓ Post Payroll'}
              </button>
            </>
          )}
          {viewRunId && currentRun?.status === 'POSTED' && isManager && (
            <button
              className="btn btn-primary"
              disabled={paidMutation.isPending}
              onClick={() => {
                if (confirm('Mark this payroll run as PAID? This cannot be undone.')) {
                  paidMutation.mutate(viewRunId);
                }
              }}
            >
              {paidMutation.isPending ? 'Marking…' : '✓ Mark as Paid'}
            </button>
          )}
          {viewRunId && currentRun && currentRun.status !== 'DRAFT' && isManager && (
            <button className="btn btn-secondary btn-sm" disabled={downloadingDisbursement} onClick={handleDownloadDisbursement}>
              {downloadingDisbursement ? 'Generating…' : '🏦 Bank Disbursement'}
            </button>
          )}
          {viewRunId && currentRun && isManager && (
            <>
              <button className="btn btn-secondary btn-sm" disabled={downloadingGovReport} onClick={handleDownloadGovReport}>
                {downloadingGovReport ? 'Generating…' : '🏛 Gov Benefits'}
              </button>
            </>
          )}
          {viewRunId && (
            <button className="btn btn-ghost" onClick={() => setViewRunId(null)}>← Back to History</button>
          )}
          {isManager && !viewRunId && (
            <button className="btn btn-primary" onClick={() => setShowRunModal(true)}>▶ Run Payroll</button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="loading-center"><div className="spinner" /></div>
      ) : viewRunId && currentRun ? (
        <>
          {/* Run header */}
          <div className="card" style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{currentRun.period}</div>
                <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', marginTop: 2 }}>
                  {new Date(currentRun.periodStart).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
                  {' → '}
                  {new Date(currentRun.periodEnd).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
                </div>
                {currentRun.description && (
                  <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)' }}>{currentRun.description}</div>
                )}
                {currentRun.soaNo && (
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
                    SOA # <strong>{currentRun.soaNo}</strong>
                  </div>
                )}
              </div>
              <span className={`badge ${STATUS_COLORS[currentRun.status]}`} style={{ fontSize: 13 }}>
                {currentRun.status}
              </span>
            </div>
          </div>

          {/* Summary cards */}
          <div className="grid-4" style={{ marginBottom: 20 }}>
            {[
              { label: 'Gross Pay', value: formatPHP(totalGross), icon: '💵', color: '#F0FDF4' },
              { label: 'Total Deductions', value: formatPHP(totalDeductions + totalOtherDeductions), icon: '📉', color: '#FEF2F2' },
              { label: 'Net Pay', value: formatPHP(totalNet), icon: '✅', color: '#EFF6FF' },
              { label: 'OT Pay', value: formatPHP(totalOT), icon: '⏱️', color: '#FFFBEB' },
            ].map(s => (
              <div key={s.label} className="stat-card">
                <div className="stat-icon" style={{ background: s.color, fontSize: 20 }}>{s.icon}</div>
                <div>
                  <div className="stat-label">{s.label}</div>
                  <div className="stat-value" style={{ fontSize: 16 }}>{s.value}</div>
                  <div className="stat-delta">{records.length} employees</div>
                </div>
              </div>
            ))}
          </div>

          {/* Records grouped by client */}
          {(() => {
            const grpTh: React.CSSProperties = {
              textAlign: 'left', padding: '6px 10px', fontWeight: 600, fontSize: 11.5,
              color: 'var(--color-text-muted)', whiteSpace: 'nowrap',
              borderBottom: '2px solid var(--color-border)',
            };
            const grpTd: React.CSSProperties = {
              padding: '8px 10px', fontSize: 12.5, verticalAlign: 'middle',
              borderBottom: '1px solid var(--color-border)',
            };
            return (
              <>
                {/* Search bar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                  <input
                    className="form-control"
                    style={{ maxWidth: 260 }}
                    placeholder="Search employees…"
                    value={payrollSearch}
                    onChange={e => setPayrollSearch(e.target.value)}
                  />
                  <span className="text-muted text-sm">{records.length} employee{records.length !== 1 ? 's' : ''}</span>
                  {groupedRecords.length > 1 && (
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ marginLeft: 'auto' }}
                      onClick={() => {
                        const allKeys = groupedRecords.map(([k]) => k);
                        const allCollapsed = allKeys.every(k => collapsedClients.has(k));
                        setCollapsedClients(allCollapsed ? new Set() : new Set(allKeys));
                      }}
                    >
                      {groupedRecords.every(([k]) => collapsedClients.has(k)) ? '▼ Expand All' : '▶ Collapse All'}
                    </button>
                  )}
                </div>

                {groupedRecords.map(([clientName, clientRecords]) => {
                  const isCollapsed = collapsedClients.has(clientName);
                  const grpGross = clientRecords.reduce((s, r) => s + r.grossPay, 0);
                  const grpNet = clientRecords.reduce((s, r) => s + r.netPay, 0);
                  return (
                    <div key={clientName} className="card" style={{ marginBottom: 12, padding: '12px 16px' }}>
                      {/* Group header */}
                      <div
                        style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none' }}
                        onClick={() => toggleClient(clientName)}
                      >
                        <span style={{ fontSize: 13, color: 'var(--color-text-muted)', width: 14, textAlign: 'center', flexShrink: 0 }}>
                          {isCollapsed ? '▶' : '▼'}
                        </span>
                        <span style={{ fontWeight: 700, fontSize: 14, flex: 1 }}>{clientName}</span>
                        <span className="text-muted text-sm">{clientRecords.length} emp{clientRecords.length !== 1 ? 's' : ''}</span>
                        <span className="text-muted text-sm" style={{ marginLeft: 12 }}>
                          Gross: <strong>{formatPHP(grpGross)}</strong>
                        </span>
                        <span className="text-muted text-sm" style={{ marginLeft: 12 }}>
                          Net: <strong style={{ color: 'var(--color-primary)' }}>{formatPHP(grpNet)}</strong>
                        </span>
                      </div>

                      {/* Group rows */}
                      {!isCollapsed && (
                        <div style={{ overflowX: 'auto', marginTop: 12 }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                              <tr>
                                <th style={grpTh}>Emp #</th>
                                <th style={grpTh}>Employee</th>
                                <th style={grpTh}>Days</th>
                                <th style={grpTh}>Basic</th>
                                <th style={grpTh}>Daily Rate</th>
                                <th style={grpTh}>OT Pay</th>
                                <th style={grpTh}>Gross Pay</th>
                                <th style={grpTh}>SSS</th>
                                <th style={grpTh}>WISP</th>
                                <th style={grpTh}>PHIC</th>
                                <th style={grpTh}>HDMF</th>
                                <th style={grpTh}>Tax</th>
                                <th style={grpTh}>Late</th>
                                <th style={grpTh}>Other Ded.</th>
                                <th style={grpTh}>Net Pay</th>
                                <th style={grpTh}></th>
                              </tr>
                            </thead>
                            <tbody>
                              {clientRecords.map(r => {
                                const sssRegular = Math.min(r.sssContrib, 900);
                                const sssWisp = Math.max(0, r.sssContrib - 900);
                                const isRowExpanded = expandedPayrollRows.has(r.id);
                                return (
                                  <React.Fragment key={r.id}>
                                  <tr
                                    onClick={() => togglePayrollRow(r.id)}
                                    style={{ cursor: 'pointer', background: isRowExpanded ? 'var(--color-surface-2)' : undefined }}
                                  >
                                    <td style={grpTd}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                        <span style={{ fontSize: 10, color: 'var(--color-text-muted)', flexShrink: 0 }}>{isRowExpanded ? '▼' : '▶'}</span>
                                        <span className="text-sm text-muted" style={{ fontFamily: 'monospace' }}>{r.employee.employeeNo}</span>
                                      </div>
                                    </td>
                                    <td style={grpTd}>
                                      <div className="emp-info">
                                        <div className="emp-avatar" style={{ background: r.employee.avatarColor }}>
                                          {r.employee.firstName[0]}{r.employee.lastName[0]}
                                        </div>
                                        <div>
                                          <div className="emp-name">{r.employee.firstName} {r.employee.lastName}</div>
                                          <div className="emp-role">{r.employee.position}</div>
                                        </div>
                                      </div>
                                    </td>
                                    <td style={grpTd}>{r.daysWorked}</td>
                                    <td style={grpTd}><span className="td-mono">{formatPHP(r.basicSalary)}</span></td>
                                    <td style={grpTd}>
                                      <span className="td-mono text-muted">
                                        {(r.employee as any).dailyRate != null ? formatPHP((r.employee as any).dailyRate) : '—'}
                                      </span>
                                    </td>
                                    <td style={grpTd}>
                                      <span className="td-mono">{r.overtimePay > 0 ? formatPHP(r.overtimePay) : '—'}</span>
                                    </td>
                                    <td style={grpTd}>
                                      <span className="td-mono" style={{ fontWeight: 600 }}>{formatPHP(r.grossPay)}</span>
                                    </td>
                                    <td style={grpTd}><span className="td-mono text-muted">{formatPHP(sssRegular)}</span></td>
                                    <td style={grpTd}>
                                      <span className="td-mono text-muted">{sssWisp > 0 ? formatPHP(sssWisp) : '—'}</span>
                                    </td>
                                    <td style={grpTd}><span className="td-mono text-muted">{formatPHP(r.philhealthContrib)}</span></td>
                                    <td style={grpTd}><span className="td-mono text-muted">{formatPHP(r.pagibigContrib)}</span></td>
                                    <td style={grpTd}><span className="td-mono text-muted">{formatPHP(r.withholdingTax)}</span></td>
                                    <td style={grpTd}>
                                      <span className="td-mono text-muted">
                                        {(r.lateDeduction ?? 0) > 0 ? formatPHP(r.lateDeduction ?? 0) : '—'}
                                      </span>
                                    </td>
                                    <td style={grpTd} onClick={e => e.stopPropagation()}>
                                      {isDraft ? (
                                        <OtherDeductionsCell
                                          recordId={r.id}
                                          initialValue={r.otherDeductions ?? 0}
                                          initialNote={r.otherDeductionsNote}
                                          onBlur={handleOtherDeductionsBlur}
                                        />
                                      ) : (
                                        <span className="td-mono text-muted">
                                          {(r.otherDeductions ?? 0) > 0 ? formatPHP(r.otherDeductions ?? 0) : '—'}
                                        </span>
                                      )}
                                    </td>
                                    <td style={grpTd}>
                                      <span className="td-mono" style={{ fontWeight: 800, color: 'var(--color-primary)' }}>
                                        {formatPHP(r.netPay)}
                                      </span>
                                    </td>
                                    <td style={grpTd} onClick={e => e.stopPropagation()}>
                                      <button className="btn btn-ghost btn-sm" onClick={() => setShowSlip(r)}>Slip</button>
                                    </td>
                                  </tr>
                                  {isRowExpanded && (
                                    <tr>
                                      <td colSpan={16} style={{ padding: 0, background: 'var(--color-surface-2)', borderBottom: '2px solid var(--color-border)' }}>
                                        <div style={{ padding: '8px 16px' }}>
                                          <PayslipAttendanceSection recordId={r.id} />
                                        </div>
                                      </td>
                                    </tr>
                                  )}
                                  </React.Fragment>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            );
          })()}

          {/* Audit log */}
          {isManager && auditLogs.length > 0 && (
            <div className="card" style={{ marginTop: 20 }}>
              <div className="card-header">
                <div className="card-title">Audit Log</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {auditLogs.map((log: any) => (
                  <div
                    key={log.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '10px 4px', borderBottom: '1px solid var(--color-border)',
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{log.action}</span>
                      <span className="text-muted text-sm" style={{ marginLeft: 8 }}>by {log.performedByName}</span>
                    </div>
                    <div className="text-muted text-sm">
                      {new Date(log.performedAt).toLocaleString('en-PH', {
                        month: 'short', day: 'numeric', year: 'numeric',
                        hour: 'numeric', minute: '2-digit',
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        /* History list */
        history.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">💰</div>
            <div className="empty-state-title">No payroll runs yet</div>
            {isManager && <div>Click "Run Payroll" to process your first payroll period</div>}
          </div>
        ) : (
          <div className="card">
            <div className="card-header">
              <div className="card-title">Payroll History</div>
            </div>
            {groupedHistory.map(([year, yearRuns]) => {
              const isYearCollapsed = collapsedYears.has(year);
              return (
                <div key={year}>
                  {/* Year header */}
                  <div
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '8px 4px', cursor: 'pointer', userSelect: 'none',
                      borderBottom: '2px solid var(--color-border)',
                      background: 'var(--color-surface-2)',
                    }}
                    onClick={() => toggleYear(year)}
                  >
                    <span style={{ fontSize: 12, color: 'var(--color-text-muted)', width: 14, textAlign: 'center' }}>
                      {isYearCollapsed ? '▶' : '▼'}
                    </span>
                    <span style={{ fontWeight: 700, fontSize: 13 }}>{year}</span>
                    <span className="text-muted text-sm">
                      ({yearRuns.length} run{yearRuns.length !== 1 ? 's' : ''})
                    </span>
                  </div>

                  {/* Year rows */}
                  {!isYearCollapsed && yearRuns.map(h => (
                    <div
                      key={h.id}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '12px 4px', borderBottom: '1px solid var(--color-border)',
                      }}
                    >
                      <button
                        onClick={() => setViewRunId(h.id)}
                        style={{ flex: 1, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }}
                      >
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{h.period}</div>
                        <div className="text-muted text-sm" style={{ marginTop: 2 }}>
                          {h._count.records} employees
                          {h.periodStart && ` · ${new Date(h.periodStart).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })} – ${new Date(h.periodEnd).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}`}
                          {(h as any).soaNo && ` · SOA# ${(h as any).soaNo}`}
                        </div>
                      </button>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span className={`badge ${STATUS_COLORS[h.status]}`}>{h.status}</span>
                        {h.status === 'DRAFT' && isManager && (
                          <button
                            className="btn btn-ghost btn-sm"
                            style={{ color: 'var(--color-danger)' }}
                            disabled={deleteMutation.isPending}
                            onClick={() => {
                              if (confirm('Delete this draft payroll run?')) deleteMutation.mutate(h.id);
                            }}
                          >
                            Delete
                          </button>
                        )}
                        <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>›</span>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )
      )}

      {showRunModal && (
        <RunPayrollModal
          onClose={() => setShowRunModal(false)}
          onSuccess={(runId) => {
            setShowRunModal(false);
            qc.invalidateQueries({ queryKey: ['payroll-history'] });
            setViewRunId(runId);
          }}
          defaultYear={now.getFullYear()}
          defaultMonth={now.getMonth() + 1}
        />
      )}

      {showSlip && <PayslipModal record={showSlip} onClose={() => setShowSlip(null)} />}
    </div>
  );
}

// ── Multi-line other deductions cell ─────────────────────────────────────────
interface DeductionLine { id: number; amount: string; note: string; }
let _dedLineId = 0;
const mkLine = (amount = '', note = ''): DeductionLine => ({ id: ++_dedLineId, amount, note });

function parseDeductionLines(initialValue: number, initialNote?: string | null): DeductionLine[] {
  if (initialNote) {
    try {
      const parsed = JSON.parse(initialNote);
      if (Array.isArray(parsed) && parsed.length > 0)
        return parsed.map((l: any) => mkLine(l.amount > 0 ? String(l.amount) : '', l.note ?? ''));
    } catch {}
    return [mkLine(initialValue > 0 ? String(initialValue) : '', initialNote)];
  }
  return [mkLine(initialValue > 0 ? String(initialValue) : '', '')];
}

function serializeDeductionLines(lines: DeductionLine[]): { total: number; note: string | null } {
  const items = lines.map(l => ({ amount: Math.max(0, parseFloat(l.amount) || 0), note: l.note.trim() }));
  const total = items.reduce((s, l) => s + l.amount, 0);
  if (items.length === 1) return { total, note: items[0].note || null };
  return { total, note: JSON.stringify(items) };
}

function fmtAttDate(iso?: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtAttTime(iso?: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: true });
}
const ATT_STATUS_BADGE: Record<string, string> = {
  PRESENT: '🟢', LATE: '🟡', ABSENT: '🔴', HALF_DAY: '🟠', ON_LEAVE: '🔵',
};

function PayslipAttendanceSection({ recordId }: { recordId: string }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['payroll-attendance', recordId],
    queryFn: () => api.get(`/payroll/record/${recordId}/attendance`).then(r => r.data),
  });
  const thStyle: React.CSSProperties = { textAlign: 'left', padding: '3px 4px', color: 'var(--color-text-muted)', fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap' };
  const tdStyle: React.CSSProperties = { padding: '3px 4px', fontSize: 11 };
  return (
    <div>
      <div className="divider" />
      <div
        style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', userSelect: 'none' }}
        onClick={() => setOpen(o => !o)}
      >
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)', flexShrink: 0 }}>{open ? '▼' : '▶'}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Time Entries
        </span>
      </div>
      {open && (
        <div style={{ paddingBottom: 8 }}>
          {isLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', color: 'var(--color-text-muted)', fontSize: 12 }}>
              <div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Loading…
            </div>
          ) : !data ? null : (
            <>
              {data.attendance.length > 0 && (
                <>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 6, marginBottom: 4, fontWeight: 600 }}>Daily Attendance</div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                          <th style={thStyle}>Date</th>
                          <th style={thStyle}>Status</th>
                          <th style={thStyle}>Time In</th>
                          <th style={thStyle}>Time Out</th>
                          <th style={{ ...thStyle, textAlign: 'right' }}>OT hrs</th>
                          <th style={{ ...thStyle, textAlign: 'right' }}>Late min</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.attendance.map((a: any) => (
                          <tr key={a.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                            <td style={tdStyle}>{fmtAttDate(a.date)}</td>
                            <td style={tdStyle}>{ATT_STATUS_BADGE[a.status] ?? ''} {a.status}</td>
                            <td style={tdStyle}>{fmtAttTime(a.timeIn)}</td>
                            <td style={tdStyle}>{fmtAttTime(a.timeOut)}</td>
                            <td style={{ ...tdStyle, textAlign: 'right' }}>{a.overtimeHrs > 0 ? a.overtimeHrs : '—'}</td>
                            <td style={{ ...tdStyle, textAlign: 'right' }}>{a.lateMinutes > 0 ? a.lateMinutes : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
              {data.overtime.length > 0 && (
                <>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 8, marginBottom: 4, fontWeight: 600 }}>Approved Overtime</div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                        <th style={thStyle}>Date</th>
                        <th style={{ ...thStyle, textAlign: 'right' }}>Hours</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.overtime.map((o: any) => (
                        <tr key={o.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                          <td style={tdStyle}>{fmtAttDate(o.date)}</td>
                          <td style={{ ...tdStyle, textAlign: 'right' }}>{o.hours}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
              {data.leaves.length > 0 && (
                <>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 8, marginBottom: 4, fontWeight: 600 }}>Approved Leaves</div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                        <th style={thStyle}>Leave Type</th>
                        <th style={thStyle}>From</th>
                        <th style={thStyle}>To</th>
                        <th style={{ ...thStyle, textAlign: 'right' }}>Days</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.leaves.map((l: any) => (
                        <tr key={l.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                          <td style={tdStyle}>{l.leaveType?.name ?? '—'}</td>
                          <td style={tdStyle}>{fmtAttDate(l.startDate)}</td>
                          <td style={tdStyle}>{fmtAttDate(l.endDate)}</td>
                          <td style={{ ...tdStyle, textAlign: 'right' }}>{l.totalDays}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
              {data.attendance.length === 0 && data.overtime.length === 0 && data.leaves.length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '6px 0' }}>No time entries found for this period.</div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function parsePayslipLines(total: number, note?: string | null): { amount: number; note: string }[] {
  if (note) {
    try {
      const parsed = JSON.parse(note);
      if (Array.isArray(parsed) && parsed.length > 0)
        return parsed.map((l: any) => ({ amount: Number(l.amount) || 0, note: l.note ?? '' }));
    } catch {}
    return [{ amount: total, note }];
  }
  return [{ amount: total, note: '' }];
}

function OtherDeductionsCell({ recordId, initialValue, initialNote, onBlur }: {
  recordId: string;
  initialValue: number;
  initialNote?: string | null;
  onBlur: (recordId: string, value: number, note: string | null) => void;
}) {
  const [lines, setLines] = useState<DeductionLine[]>(() => parseDeductionLines(initialValue, initialNote));
  const linesRef = useRef(lines);
  linesRef.current = lines;

  const commit = useCallback((current: DeductionLine[]) => {
    const { total, note } = serializeDeductionLines(current);
    onBlur(recordId, total, note);
  }, [recordId, onBlur]);

  const handleContainerBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node))
      commit(linesRef.current);
  };

  const updateLine = (id: number, field: 'amount' | 'note', value: string) =>
    setLines(prev => prev.map(l => l.id === id ? { ...l, [field]: value } : l));

  const addLine = () => setLines(prev => [...prev, mkLine()]);

  const removeLine = (id: number) => {
    const next = lines.filter(l => l.id !== id);
    setLines(next);
    commit(next);
  };

  const inputStyle: React.CSSProperties = {
    padding: '3px 6px', fontSize: 12,
    border: '1px solid var(--color-border)', borderRadius: 4,
    background: 'var(--color-surface)', color: 'var(--color-text)',
  };

  return (
    <div onBlur={handleContainerBlur} style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 200 }}>
      {lines.map(line => (
        <div key={line.id} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input
            type="text" inputMode="decimal"
            value={line.amount} placeholder="0"
            onChange={e => updateLine(line.id, 'amount', e.target.value)}
            onBlur={() => commit(linesRef.current)}
            style={{ ...inputStyle, width: 70, fontFamily: 'monospace' }}
          />
          <input
            type="text"
            value={line.note} placeholder="Note"
            onChange={e => updateLine(line.id, 'note', e.target.value)}
            style={{ ...inputStyle, flex: 1 }}
          />
          {lines.length > 1 && (
            <button
              type="button" onClick={() => removeLine(line.id)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-danger)', fontSize: 13, padding: '0 2px', lineHeight: 1 }}
            >✕</button>
          )}
        </div>
      ))}
      <button
        type="button" onClick={addLine}
        style={{
          background: 'none', border: '1px dashed var(--color-border)', borderRadius: 4,
          cursor: 'pointer', fontSize: 11, color: 'var(--color-text-muted)',
          padding: '2px 8px', alignSelf: 'flex-start',
        }}
      >+ Add</button>
    </div>
  );
}

// ── Run Payroll Modal ──────────────────────────────────────────────────────────
interface CutOffPeriod {
  id: string;
  name: string;
  cutOffFromDay: number;
  cutOffFromIsPrevMonth: boolean;
  cutOffToDay: number;
  payDay: number;
  payDayIsNextMonth: boolean;
  sortOrder: number;
  isActive: boolean;
}

function RunPayrollModal({ onClose, onSuccess, defaultYear, defaultMonth }: {
  onClose: () => void;
  onSuccess: (runId: string) => void;
  defaultYear: number;
  defaultMonth: number;
}) {
  const [year, setYear] = useState(defaultYear);
  const [month, setMonth] = useState(defaultMonth);
  // selectedOption: 'co_<cutOffPeriodId>' | '7' | '9'
  const [selectedOption, setSelectedOption] = useState<string>('');
  const [description, setDescription] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [error, setError] = useState('');

  const { data: cutOffPeriods = [] } = useQuery<CutOffPeriod[]>({
    queryKey: ['cutoff-periods'],
    queryFn: () => api.get('/global-setup/cutoff-periods').then(r => r.data),
  });

  // Auto-select first cut-off period (or '7' if none configured)
  useEffect(() => {
    if (selectedOption) return;
    if (cutOffPeriods.length > 0) {
      setSelectedOption(`co_${cutOffPeriods[0].id}`);
    }
  }, [cutOffPeriods, selectedOption]);

  // Derive payPeriodType and cutOffPeriodId from the dropdown selection
  const { payPeriodType, cutOffPeriodId } = useMemo(() => {
    if (selectedOption === '7') return { payPeriodType: 7, cutOffPeriodId: undefined };
    if (selectedOption === '9') return { payPeriodType: 9, cutOffPeriodId: undefined };
    if (selectedOption.startsWith('co_')) {
      const id = selectedOption.slice(3);
      const idx = cutOffPeriods.findIndex(p => p.id === id);
      // Map to Type 1 (1st period) or Type 2 (2nd+) for employee filtering
      return { payPeriodType: idx <= 0 ? 1 : 2, cutOffPeriodId: id };
    }
    return { payPeriodType: 1, cutOffPeriodId: undefined };
  }, [selectedOption, cutOffPeriods]);

  // Compute actual date range from the selected cut-off period + month/year
  const previewDates = useMemo((): { start: Date; end: Date } | null => {
    if (!cutOffPeriodId) return null;
    const period = cutOffPeriods.find(p => p.id === cutOffPeriodId);
    if (!period) return null;
    let fromYear = year;
    let fromMonthIdx = month - 1; // 0-indexed
    if (period.cutOffFromIsPrevMonth) {
      if (month === 1) { fromYear = year - 1; fromMonthIdx = 11; }
      else { fromMonthIdx = month - 2; }
    }
    return {
      start: new Date(fromYear, fromMonthIdx, period.cutOffFromDay),
      end: new Date(year, month - 1, period.cutOffToDay),
    };
  }, [cutOffPeriodId, cutOffPeriods, month, year]);

  const isAdHoc = payPeriodType === 7 || payPeriodType === 9;

  const runMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/payroll/run', body).then(r => r.data),
    onSuccess: (data) => onSuccess(data.id),
    onError: (err: any) => setError(err?.response?.data?.error ?? 'Failed to run payroll'),
  });

  const fmtDate = (d: Date) => d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const body: Record<string, unknown> = { year, month, payPeriodType };
    if (cutOffPeriodId) body.cutOffPeriodId = cutOffPeriodId;
    if (description) body.description = description;
    if (isAdHoc) {
      if (!periodStart || !periodEnd) { setError('Period start and end dates are required for this type'); return; }
      body.periodStart = periodStart;
      body.periodEnd = periodEnd;
    }
    runMutation.mutate(body);
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <h2 className="modal-title">Run Payroll</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="error-msg" style={{ marginBottom: 12 }}>{error}</div>}

            <div className="form-grid form-grid-2" style={{ gap: 12 }}>
              <div className="form-group">
                <label>Month *</label>
                <select className="form-control" value={month} onChange={e => setMonth(Number(e.target.value))}>
                  {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Year *</label>
                <select className="form-control" value={year} onChange={e => setYear(Number(e.target.value))}>
                  {[defaultYear - 1, defaultYear, defaultYear + 1].map(y => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
              <div className="form-group" style={{ gridColumn: '1/-1' }}>
                <label>Pay Period *</label>
                <select
                  className="form-control"
                  value={selectedOption}
                  onChange={e => setSelectedOption(e.target.value)}
                >
                  {cutOffPeriods.length > 0 && (
                    <optgroup label="Regular Cut-Off Periods">
                      {cutOffPeriods.map(p => (
                        <option key={p.id} value={`co_${p.id}`}>{p.name}</option>
                      ))}
                    </optgroup>
                  )}
                  <optgroup label="Special Runs">
                    <option value="7">Special Pay (ad-hoc date)</option>
                    <option value="9">13th Month Pay (full year)</option>
                  </optgroup>
                </select>
              </div>

              {!isAdHoc && previewDates && (
                <div className="form-group" style={{ gridColumn: '1/-1' }}>
                  <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', background: 'var(--color-surface-2)', borderRadius: 8, padding: '8px 12px' }}>
                    Covers: <strong>{fmtDate(previewDates.start)}</strong> → <strong>{fmtDate(previewDates.end)}</strong>
                    <br />
                    Only employees assigned to clients with matching pay period type will be included.
                  </div>
                </div>
              )}

              {isAdHoc && (
                <>
                  <div className="form-group" style={{ gridColumn: '1/-1' }}>
                    <label>Description * <span style={{ fontWeight: 400, color: 'var(--color-text-muted)' }}>(e.g. "Christmas Bonus 2026")</span></label>
                    <input
                      className="form-control"
                      required
                      value={description}
                      onChange={e => setDescription(e.target.value)}
                      placeholder={payPeriodType === 9 ? '13th Month Pay 2026' : 'Christmas Bonus 2026'}
                    />
                  </div>
                  <div className="form-group">
                    <label>Period Start *</label>
                    <input type="date" className="form-control" required value={periodStart} onChange={e => setPeriodStart(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>Period End *</label>
                    <input type="date" className="form-control" required value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} />
                  </div>
                  <div className="form-group" style={{ gridColumn: '1/-1' }}>
                    <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', background: 'var(--color-surface-2)', borderRadius: 8, padding: '8px 12px' }}>
                      All active employees will be included in this special run.
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={runMutation.isPending || !selectedOption}
            >
              {runMutation.isPending ? 'Processing…' : '▶ Run Payroll'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PayslipModal({ record: r, onClose }: { record: PayrollRecord; onClose: () => void }) {
  const otherDed = r.otherDeductions ?? 0;
  const [downloading, setDownloading] = useState(false);

  const { data: company } = useQuery<{ name?: string; logoUrl?: string | null }>({
    queryKey: ['company-settings'],
    queryFn: () => api.get('/global-setup/company').then(res => res.data),
  });

  const handleDownloadPdf = async () => {
    setDownloading(true);
    try {
      const resp = await api.get(`/payroll/record/${r.id}/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(resp.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Payslip_${r.employee.lastName}_${r.employee.firstName}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={ev => ev.target === ev.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h2 className="modal-title">Payslip — {r.employee.firstName} {r.employee.lastName}</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={handleDownloadPdf} disabled={downloading}>
              {downloading ? 'Generating…' : '⬇ PDF'}
            </button>
            <button className="icon-btn" onClick={onClose}>✕</button>
          </div>
        </div>
        <div className="modal-body">
          {/* Company header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid var(--color-border)' }}>
            {company?.logoUrl ? (
              <img src={company.logoUrl} alt="logo" style={{ width: 44, height: 44, objectFit: 'contain', borderRadius: 8, border: '1px solid var(--color-border)' }} />
            ) : (
              <div style={{ width: 44, height: 44, borderRadius: 8, background: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, color: '#fff', fontWeight: 700, flexShrink: 0 }}>
                {(company?.name ?? 'C')[0]}
              </div>
            )}
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{company?.name ?? ''}</div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Official Payslip</div>
            </div>
          </div>

          {/* Employee info */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 700 }}>{r.employee.firstName} {r.employee.lastName}</div>
            <div className="text-muted text-sm">
              {r.employee.position} · {r.employee.department.name}
              {r.employee.client?.name && ` · ${r.employee.client.name}`}
            </div>
          </div>

          {/* Earnings */}
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Earnings</div>
          {r.employee.useDailyRate && r.employee.dailyRate ? (
            <>
              <div className="payslip-row"><span>Daily Rate</span><span>{formatPHP(r.employee.dailyRate)} / day</span></div>
              <div className="payslip-row"><span>Days Worked ({r.daysWorked} days)</span><span>{formatPHP(r.employee.dailyRate * r.daysWorked)}</span></div>
            </>
          ) : (
            <>
              <div className="payslip-row"><span>Basic Salary</span><span>{formatPHP(r.basicSalary)}</span></div>
              <div className="payslip-row"><span>Days Worked ({r.daysWorked} days)</span><span>{formatPHP(r.basicSalary / 22 * r.daysWorked)}</span></div>
            </>
          )}
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
          {(r.lateDeduction ?? 0) > 0 && <div className="payslip-row"><span>Late</span><span style={{ color: 'var(--color-danger)' }}>({formatPHP(r.lateDeduction ?? 0)})</span></div>}
          {otherDed > 0 && (() => {
            const dedLines = parsePayslipLines(otherDed, r.otherDeductionsNote);
            return dedLines.map((l, i) => (
              <div key={i} className="payslip-row">
                <span>Other Deductions{l.note ? ` (${l.note})` : ''}</span>
                <span style={{ color: 'var(--color-danger)' }}>({formatPHP(l.amount || otherDed / dedLines.length)})</span>
              </div>
            ));
          })()}
          <div className="payslip-row" style={{ fontWeight: 700 }}>
            <span>Total Deductions</span>
            <span style={{ color: 'var(--color-danger)' }}>({formatPHP(r.totalDeductions + otherDed + (r.lateDeduction ?? 0))})</span>
          </div>

          <div className="divider" />

          <div className="payslip-total">
            <span>NET PAY</span>
            <span>{formatPHP(r.netPay)}</span>
          </div>

          <PayslipAttendanceSection recordId={r.id} />
        </div>
      </div>
    </div>
  );
}
