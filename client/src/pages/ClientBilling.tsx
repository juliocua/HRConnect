import React, { useState, useRef, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import api from '@/lib/api';
import { useToast } from '@/lib/toast';
import { formatPHP } from '@/lib/payroll';
import { DataTable } from '@/components/DataTable';
import type { Client, Billing, BillingSummary, BillingCycle } from '@/types';

const CYCLE_LABELS: Record<BillingCycle, string> = {
  WEEKLY: 'Weekly', EVERY_15TH: 'Every 15th',
  EVERY_30TH: 'Every 30th', MONTHLY: 'Monthly',
};

export default function ClientBilling() {
  const qc = useQueryClient();
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const [billingTab, setBillingTab] = useState<'generate' | 'invoices'>('generate');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [billingDate, setBillingDate] = useState(today);
  const [notes, setNotes] = useState('');
  const [generated, setGenerated] = useState<(Billing & { client: { id: string; name: string } })[]>([]);
  const [skipped, setSkipped] = useState<{ clientId: string; name: string; reason: string }[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [markPaidBilling, setMarkPaidBilling] = useState<(Billing & { client: { id: string; name: string } }) | null>(null);

  type LineItem = { description: string; amount: number };
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const addLineItem = () => setLineItems(li => [...li, { description: '', amount: 0 }]);
  const updateLineItem = (i: number, field: keyof LineItem, val: string | number) =>
    setLineItems(li => li.map((x, idx) => idx === i ? { ...x, [field]: val } : x));
  const removeLineItem = (i: number) => setLineItems(li => li.filter((_, idx) => idx !== i));

  const { data: summary, isLoading: summaryLoading } = useQuery<BillingSummary>({
    queryKey: ['billing-summary'],
    queryFn: () => api.get('/billing/summary').then(r => r.data),
  });

  const { data: clientsData, isLoading: clientsLoading } = useQuery<{
    due: Client[];
    all: Client[];
  }>({
    queryKey: ['billing-clients-due'],
    queryFn: () => api.get('/billing/clients-due').then(r => r.data),
  });

  const { data: allBillings = [], isLoading: billingsLoading } = useQuery<(Billing & { client: { id: string; name: string } })[]>({
    queryKey: ['billing-all'],
    queryFn: () => api.get('/billing').then(r => r.data),
  });

  const generateMutation = useMutation({
    mutationFn: () => {
      setGenerated([]);
      setSkipped([]);
      const validLineItems = lineItems.filter(li => li.description.trim() && li.amount !== 0);
      return api.post('/billing/generate', {
        clientIds: [...selected],
        billingDate,
        notes: notes || undefined,
        lineItems: validLineItems.length ? validLineItems : undefined,
      });
    },
    onSuccess: (res) => {
      setGenerated(res.data.generated ?? []);
      setSkipped(res.data.skipped ?? []);
      setSelected(new Set());
      setLineItems([]);
      qc.invalidateQueries({ queryKey: ['billing-summary'] });
      qc.invalidateQueries({ queryKey: ['billing-all'] });
      qc.invalidateQueries({ queryKey: ['billing-clients-due'] });
      // Switch to invoices tab to show results
      if ((res.data.generated ?? []).length > 0) setBillingTab('invoices');
      toast('success', 'Billing generated');
    },
    onError: () => toast('error', 'Failed to generate billing'),
  });

  const resend = useMutation({
    mutationFn: (billingId: string) => api.post(`/billing/${billingId}/resend`),
    onSuccess: () => { toast('success', 'Invoice resent'); qc.invalidateQueries({ queryKey: ['billing-all'] }); },
    onError: () => toast('error', 'Failed to resend invoice'),
  });

  const deleteBilling = useMutation({
    mutationFn: (billingId: string) => api.delete(`/billing/${billingId}`),
    onSuccess: () => {
      toast('success', 'Invoice deleted');
      qc.invalidateQueries({ queryKey: ['billing-all'] });
      qc.invalidateQueries({ queryKey: ['billing-summary'] });
    },
    onError: () => toast('error', 'Failed to delete invoice'),
  });

  const [sendingInvoice, setSendingInvoice] = useState<string | null>(null);
  const [sendMsg, setSendMsg] = useState<{ id: string; ok: boolean; text: string } | null>(null);

  const downloadPDF = async (billingId: string, clientName: string) => {
    try {
      const res = await api.get(`/billing/${billingId}/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `invoice-${billingId.slice(-8).toUpperCase()}-${clientName.replace(/\s+/g, '-')}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      toast('error', 'Failed to download PDF');
    }
  };

  const sendInvoice = async (billingId: string) => {
    setSendingInvoice(billingId);
    setSendMsg(null);
    try {
      const res = await api.post(`/billing/${billingId}/send-invoice`);
      setSendMsg({ id: billingId, ok: true, text: `✓ Sent to ${res.data.email}` });
      toast('success', 'Invoice sent');
    } catch (err: any) {
      const msg = err?.response?.data?.error ?? 'Failed to send invoice.';
      setSendMsg({ id: billingId, ok: false, text: msg });
      toast('error', 'Failed to send invoice');
    } finally {
      setSendingInvoice(null);
    }
  };

  const dueClients = clientsData?.due ?? [];
  const allClients = clientsData?.all ?? [];
  const displayClients = showAll ? allClients : dueClients;

  const toggleClient = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(displayClients.map(c => c.id)));

  const clientAmount = (c: any) =>
    (c.employees ?? []).reduce((sum: number, e: any) => sum + (e.resourceCost ?? 0), 0);

  const resourceTotal = displayClients
    .filter(c => selected.has(c.id))
    .reduce((sum, c) => sum + clientAmount(c), 0);
  const lineItemTotal = lineItems.filter(li => li.description.trim()).reduce((s, li) => s + (li.amount || 0), 0);
  const totalSelected = resourceTotal + lineItemTotal;

  // Billing table columns for DataTable
  type BillingRow = Billing & { client: { id: string; name: string } };
  const billingColumns = useMemo<ColumnDef<BillingRow>[]>(() => [
    {
      id: 'client',
      header: 'Client',
      accessorFn: row => row.client.name,
      cell: ({ row }) => <span style={{ fontWeight: 600 }}>{row.original.client.name}</span>,
    },
    {
      id: 'invoiceNo',
      header: 'Invoice #',
      accessorFn: row => row.id.slice(-8).toUpperCase(),
      cell: ({ getValue }) => (
        <span style={{ fontFamily: 'monospace', fontSize: 12 }}>#{getValue() as string}</span>
      ),
    },
    {
      id: 'date',
      header: 'Date',
      accessorFn: row => row.billingDate,
      cell: ({ row }) => <span style={{ fontSize: 13 }}>{fmtDate(row.original.billingDate)}</span>,
    },
    {
      id: 'amount',
      header: 'Amount',
      accessorFn: row => row.amount,
      cell: ({ row }) => <span style={{ fontWeight: 700 }}>{formatPHP(row.original.amount)}</span>,
    },
    {
      id: 'status',
      header: 'Status',
      accessorFn: row => row.status,
      cell: ({ row }) => (
        <span className={`badge ${row.original.status === 'PAID' ? 'badge-green' : 'badge-yellow'}`}>
          {row.original.status}
        </span>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => {
        const b = row.original;
        return (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }} onClick={e => e.stopPropagation()}>
            <button
              className="btn btn-ghost btn-sm"
              style={{ fontSize: 11 }}
              onClick={() => downloadPDF(b.id, b.client.name)}
              title="Download PDF"
            >
              📄 PDF
            </button>
            <button
              className="btn btn-ghost btn-sm"
              style={{ fontSize: 11 }}
              disabled={sendingInvoice === b.id}
              onClick={() => sendInvoice(b.id)}
              title="Send invoice by email"
            >
              {sendingInvoice === b.id ? '…' : '📧 Email'}
            </button>
            {b.status === 'PENDING' && (
              <>
                {b.paymentLinkUrl && (
                  <a
                    href={b.paymentLinkUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-ghost btn-sm"
                    style={{ textDecoration: 'none', fontSize: 11 }}
                  >
                    🔗 Link
                  </a>
                )}
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ fontSize: 11 }}
                  disabled={resend.isPending}
                  onClick={() => resend.mutate(b.id)}
                >
                  Resend
                </button>
                <button
                  className="btn btn-success btn-sm"
                  style={{ fontSize: 11 }}
                  onClick={() => setMarkPaidBilling(b)}
                >
                  Paid
                </button>
                <button
                  className="btn btn-danger-outline btn-sm"
                  style={{ fontSize: 11 }}
                  disabled={deleteBilling.isPending}
                  onClick={() => {
                    if (confirm('Delete this invoice? This cannot be undone.')) {
                      deleteBilling.mutate(b.id);
                    }
                  }}
                  title="Delete invoice"
                >
                  🗑
                </button>
              </>
            )}
            {b.status === 'PAID' && (b as any).paymentScreenshotUrl && (
              <a
                href={(b as any).paymentScreenshotUrl}
                target="_blank"
                rel="noreferrer"
                className="btn btn-ghost btn-sm"
                style={{ fontSize: 11, textDecoration: 'none' }}
              >
                🖼 Proof
              </a>
            )}
            {sendMsg?.id === b.id && (
              <span style={{ fontSize: 11, color: sendMsg.ok ? '#15803D' : '#DC2626' }}>
                {sendMsg.text}
              </span>
            )}
          </div>
        );
      },
    },
  ], [sendingInvoice, sendMsg, resend.isPending, deleteBilling.isPending]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Client Billing</h1>
          <p className="page-desc">Generate and manage invoices for your deployed resources</p>
        </div>
      </div>

      {/* Summary cards */}
      {!summaryLoading && summary && (
        <div className="grid-4" style={{ marginBottom: 24 }}>
          <div className="stat-card">
            <div className="stat-icon" style={{ background: '#FEF2F2', fontSize: 20 }}>📄</div>
            <div>
              <div className="stat-label">Outstanding</div>
              <div className="stat-value" style={{ fontSize: 18 }}>{formatPHP(summary.pendingAmount)}</div>
              <div className="stat-delta">{summary.pendingCount} unpaid</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon" style={{ background: '#F0FDF4', fontSize: 20 }}>✅</div>
            <div>
              <div className="stat-label">Collected</div>
              <div className="stat-value" style={{ fontSize: 18 }}>{formatPHP(summary.paidAmount)}</div>
              <div className="stat-delta">{summary.paidCount} paid</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon" style={{ background: '#FFFBEB', fontSize: 20 }}>⏰</div>
            <div>
              <div className="stat-label">Due This Week</div>
              <div className="stat-value" style={{ fontSize: 18 }}>{summary.dueSoon.length}</div>
              <div className="stat-delta">clients to bill</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon" style={{ background: '#EFF6FF', fontSize: 20 }}>🏢</div>
            <div>
              <div className="stat-label">Active Clients</div>
              <div className="stat-value" style={{ fontSize: 18 }}>{allClients.filter(c => c.activeContract).length}</div>
              <div className="stat-delta">with contracts</div>
            </div>
          </div>
        </div>
      )}

      {/* Tabs + Content Container */}
      <div style={{ border: '1px solid var(--color-border)', borderRadius: 12, overflow: 'hidden', background: 'var(--color-surface)' }}>
        <div style={{ padding: '12px 20px 0', background: 'var(--color-surface-2)', borderBottom: '1px solid var(--color-border)', display: 'flex', gap: 2 }}>
          {(['generate', 'invoices'] as const).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => { if (t === 'generate') setGenerated([]); setBillingTab(t); }}
              style={{
                background: billingTab === t ? 'var(--color-primary)' : 'transparent',
                border: billingTab === t ? 'none' : '1px solid var(--color-border)',
                borderRadius: '6px 6px 0 0',
                padding: '7px 16px',
                fontSize: 13,
                fontWeight: billingTab === t ? 700 : 500,
                color: billingTab === t ? '#fff' : 'var(--color-text-secondary)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {t === 'generate' ? 'Generate Billing' : 'Recent Invoices'}
              {t === 'invoices' && allBillings.length > 0 && (
                <span style={{
                  background: billingTab === t ? 'rgba(255,255,255,0.25)' : 'var(--color-primary)',
                  color: '#fff',
                  borderRadius: 999,
                  fontSize: 10,
                  padding: '1px 7px',
                  fontWeight: 700,
                }}>
                  {allBillings.length}
                </span>
              )}
            </button>
          ))}
        </div>
        <div style={{ padding: 24 }}>

      {/* ── Generate Billing Tab ───────────────────────────────────────────── */}
      {billingTab === 'generate' && (
        <div>
          <div className="card-header">
            <div>
              <div className="card-title">Generate Billing</div>
              <div className="card-subtitle">
                {dueClients.length > 0
                  ? `${dueClients.length} client${dueClients.length !== 1 ? 's' : ''} due today`
                  : 'No clients due today by schedule'}
              </div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowAll(v => !v)}>
              {showAll ? 'Show Due Only' : `Show All (${allClients.length})`}
            </button>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div className="form-grid form-grid-2" style={{ gap: 12, marginBottom: 12 }}>
              <div className="form-group">
                <label style={{ fontSize: 12 }}>Billing Date</label>
                <input
                  type="date"
                  className="form-control"
                  value={billingDate}
                  onChange={e => setBillingDate(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label style={{ fontSize: 12 }}>Notes (optional)</label>
                <input
                  className="form-control"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="e.g. September billing"
                />
              </div>
            </div>
          </div>

          {clientsLoading ? (
            <div className="loading-center" style={{ padding: 32 }}><div className="spinner" /></div>
          ) : displayClients.length === 0 ? (
            <div className="empty-state" style={{ padding: '24px 0' }}>
              <div className="empty-state-icon">📅</div>
              <div>{showAll ? 'No active clients' : 'No clients due today — click Show All to select manually'}</div>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={selected.size === displayClients.length && displayClients.length > 0}
                    onChange={e => e.target.checked ? selectAll() : setSelected(new Set())}
                  />
                  Select all
                </label>
                <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{selected.size} selected</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto' }}>
                {displayClients.map(c => {
                  const amount = clientAmount(c);
                  return (
                    <label
                      key={c.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                        background: selected.has(c.id) ? 'var(--color-primary-light)' : 'var(--color-surface-2)',
                        border: `1px solid ${selected.has(c.id) ? 'var(--color-primary)' : 'var(--color-border)'}`,
                        transition: 'all 0.15s',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(c.id)}
                        onChange={() => toggleClient(c.id)}
                        style={{ flexShrink: 0 }}
                      />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{c.name}</div>
                        <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                          {(c as any).employees?.length ?? 0} resources · {CYCLE_LABELS[c.billingCycle]}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        {amount > 0
                          ? <span style={{ fontWeight: 700, fontSize: 14 }}>{formatPHP(amount)}</span>
                          : <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>No rate set</span>
                        }
                      </div>
                    </label>
                  );
                })}
              </div>
            </>
          )}

          {/* Additional Line Charges */}
          <div style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Additional Charges
              </span>
              <button className="btn btn-ghost btn-sm" style={{ fontSize: 12 }} onClick={addLineItem}>
                ＋ Add Line
              </button>
            </div>
            {lineItems.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                Optional — add management fees, reimbursements, or other charges
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {lineItems.map((li, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      className="form-control"
                      style={{ flex: 2, fontSize: 13 }}
                      placeholder="Description (e.g. Management fee)"
                      value={li.description}
                      onChange={e => updateLineItem(i, 'description', e.target.value)}
                    />
                    <input
                      type="number"
                      className="form-control"
                      style={{ flex: 1, fontSize: 13 }}
                      placeholder="Amount"
                      value={li.amount || ''}
                      onChange={e => updateLineItem(i, 'amount', Number(e.target.value))}
                    />
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ color: 'var(--color-danger)', flexShrink: 0 }}
                      onClick={() => removeLineItem(i)}
                    >✕</button>
                  </div>
                ))}
                {lineItemTotal !== 0 && (
                  <div style={{ textAlign: 'right', fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                    Line charges subtotal: <strong>{formatPHP(lineItemTotal)}</strong>
                  </div>
                )}
              </div>
            )}
          </div>

          {selected.size > 0 && (
            <div style={{ marginTop: 16, padding: '12px 16px', background: 'var(--color-surface-2)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontWeight: 700 }}>{selected.size} client{selected.size !== 1 ? 's' : ''} selected</div>
                {lineItemTotal !== 0 && (
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                    Resources: {formatPHP(resourceTotal)} + Charges: {formatPHP(lineItemTotal)}
                  </div>
                )}
                <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Total: <strong>{formatPHP(totalSelected)}</strong></div>
              </div>
              <button
                className="btn btn-primary"
                disabled={generateMutation.isPending}
                onClick={() => generateMutation.mutate()}
              >
                {generateMutation.isPending ? 'Generating…' : '⚡ Generate Billing'}
              </button>
            </div>
          )}

          {generateMutation.isError && (
            <div className="error-msg" style={{ marginTop: 12 }}>
              {(generateMutation.error as any)?.response?.data?.error ?? 'Failed to generate billing'}
            </div>
          )}

          {generated.length > 0 && (
            <div style={{ marginTop: 16, padding: 14, background: '#F0FDF4', border: '1px solid #16A34A', borderRadius: 10 }}>
              <div style={{ fontWeight: 700, color: '#15803D', marginBottom: 8 }}>
                ✓ Generated {generated.length} invoice{generated.length !== 1 ? 's' : ''}
              </div>
              {generated.map(b => (
                <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                  <span>{b.client.name}</span>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontWeight: 700 }}>{formatPHP(b.amount)}</span>
                    {b.paymentLinkUrl && (
                      <a href={b.paymentLinkUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--color-primary)' }}>
                        Pay Link →
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {skipped.length > 0 && (
            <div style={{ marginTop: 12, padding: 14, background: '#FFFBEB', border: '1px solid #F59E0B', borderRadius: 10 }}>
              <div style={{ fontWeight: 700, color: '#92400E', marginBottom: 8 }}>
                ⚠ {skipped.length} client{skipped.length !== 1 ? 's' : ''} skipped
              </div>
              {skipped.map(s => (
                <div key={s.clientId} style={{ fontSize: 13, marginBottom: 4 }}>
                  <span style={{ fontWeight: 600 }}>{s.name}</span>
                  <span style={{ color: '#B45309', marginLeft: 8 }}>— {s.reason}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Recent Invoices Tab ────────────────────────────────────────────── */}
      {billingTab === 'invoices' && (
        <div>
          <div className="card-header" style={{ marginBottom: 16 }}>
            <div className="card-title">Recent Invoices</div>
          </div>

          {billingsLoading ? (
            <div className="loading-center" style={{ padding: 32 }}><div className="spinner" /></div>
          ) : allBillings.length === 0 ? (
            <div className="empty-state" style={{ padding: '40px 0' }}>
              <div className="empty-state-icon">📋</div>
              <div>No billing records yet</div>
            </div>
          ) : (
            <>
              <DataTable
                data={allBillings}
                columns={billingColumns}
                globalFilterPlaceholder="Search invoices…"
                exportFilename="invoices"
                onRowClick={row => setExpandedId(prev => prev === row.id ? null : row.id)}
              />
              {expandedId && (() => {
                const b = allBillings.find(x => x.id === expandedId);
                return b ? (
                  <div style={{ marginTop: 12, border: '1px solid var(--color-border)', borderRadius: 8, background: 'var(--color-surface-2)' }}>
                    <InvoiceDetail billing={b} />
                  </div>
                ) : null;
              })()}
            </>
          )}
        </div>
      )}

        </div>{/* end padding div */}
      </div>{/* end tab container */}

      {markPaidBilling && (
        <MarkPaidModal
          billing={markPaidBilling}
          onClose={() => setMarkPaidBilling(null)}
          onSaved={() => {
            setMarkPaidBilling(null);
            qc.invalidateQueries({ queryKey: ['billing-all'] });
            qc.invalidateQueries({ queryKey: ['billing-summary'] });
          }}
        />
      )}
    </div>
  );
}

function fmtBillingDate(iso?: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtBillingTime(iso?: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: true });
}
const BILLING_ATT_BADGE: Record<string, string> = {
  PRESENT: '🟢', LATE: '🟡', ABSENT: '🔴', HALF_DAY: '🟠', ON_LEAVE: '🔵',
};

function EmployeeAttendanceRow({ emp }: { emp: any }) {
  const [open, setOpen] = useState(true);
  const thS: React.CSSProperties = { textAlign: 'left', padding: '3px 4px', color: 'var(--color-text-muted)', fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap' };
  const tdS: React.CSSProperties = { padding: '3px 4px', fontSize: 11 };
  return (
    <div style={{ borderBottom: '1px solid var(--color-border)' }}>
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 4px', cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setOpen(o => !o)}
      >
        <div>
          <span style={{ fontWeight: 600, fontSize: 12 }}>{emp.firstName} {emp.lastName}</span>
          {emp.position && <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--color-text-muted)' }}>{emp.position}</span>}
        </div>
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{open ? '▼' : '▶'}</span>
      </div>
      {open && (
        <div style={{ paddingLeft: 8, paddingBottom: 8 }}>
          {emp.attendance.length > 0 && (
            <>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4, fontWeight: 600 }}>Daily Attendance</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <th style={thS}>Date</th>
                      <th style={thS}>Status</th>
                      <th style={thS}>Time In</th>
                      <th style={thS}>Time Out</th>
                      <th style={{ ...thS, textAlign: 'right' }}>OT hrs</th>
                      <th style={{ ...thS, textAlign: 'right' }}>Late min</th>
                    </tr>
                  </thead>
                  <tbody>
                    {emp.attendance.map((a: any) => (
                      <tr key={a.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                        <td style={tdS}>{fmtBillingDate(a.date)}</td>
                        <td style={tdS}>{BILLING_ATT_BADGE[a.status] ?? ''} {a.status}</td>
                        <td style={tdS}>{fmtBillingTime(a.timeIn)}</td>
                        <td style={tdS}>{fmtBillingTime(a.timeOut)}</td>
                        <td style={{ ...tdS, textAlign: 'right' }}>{a.overtimeHrs > 0 ? a.overtimeHrs : '—'}</td>
                        <td style={{ ...tdS, textAlign: 'right' }}>{a.lateMinutes > 0 ? a.lateMinutes : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {emp.overtime.length > 0 && (
            <>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 8, marginBottom: 4, fontWeight: 600 }}>Approved Overtime</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <th style={thS}>Date</th>
                    <th style={{ ...thS, textAlign: 'right' }}>Hours</th>
                  </tr>
                </thead>
                <tbody>
                  {emp.overtime.map((o: any) => (
                    <tr key={o.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <td style={tdS}>{fmtBillingDate(o.date)}</td>
                      <td style={{ ...tdS, textAlign: 'right' }}>{o.hours}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {emp.leaves.length > 0 && (
            <>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 8, marginBottom: 4, fontWeight: 600 }}>Approved Leaves</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <th style={thS}>Leave Type</th>
                    <th style={thS}>From</th>
                    <th style={thS}>To</th>
                    <th style={{ ...thS, textAlign: 'right' }}>Days</th>
                  </tr>
                </thead>
                <tbody>
                  {emp.leaves.map((l: any) => (
                    <tr key={l.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <td style={tdS}>{l.leaveType?.name ?? '—'}</td>
                      <td style={tdS}>{fmtBillingDate(l.startDate)}</td>
                      <td style={tdS}>{fmtBillingDate(l.endDate)}</td>
                      <td style={{ ...tdS, textAlign: 'right' }}>{l.totalDays}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {emp.attendance.length === 0 && emp.overtime.length === 0 && emp.leaves.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '4px 0' }}>No time entries for this period.</div>
          )}
        </div>
      )}
    </div>
  );
}

function BillingEmployeesSection({ billingId }: { billingId: string }) {
  const [open, setOpen] = useState(true);
  const { data, isLoading } = useQuery({
    queryKey: ['billing-emp-att', billingId],
    queryFn: () => api.get(`/billing/${billingId}/employee-attendance`).then(r => r.data),
  });
  return (
    <div style={{ marginTop: 8 }}>
      <div className="divider" style={{ margin: '8px 0' }} />
      <div
        style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', userSelect: 'none' }}
        onClick={() => setOpen(o => !o)}
      >
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Employee Attendance
          {data?.periodStart && (
            <span style={{ fontWeight: 400, marginLeft: 6, textTransform: 'none', letterSpacing: 'normal' }}>
              ({fmtBillingDate(data.periodStart)} – {fmtBillingDate(data.periodEnd)})
            </span>
          )}
        </span>
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{open ? '▼' : '▶'}</span>
      </div>
      {open && (
        <div style={{ paddingBottom: 8 }}>
          {isLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', color: 'var(--color-text-muted)', fontSize: 12 }}>
              <div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Loading…
            </div>
          ) : !data || data.employees.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '6px 0' }}>No employees found.</div>
          ) : (
            <div style={{ marginTop: 6 }}>
              {data.employees.map((emp: any) => (
                <EmployeeAttendanceRow key={emp.id} emp={emp} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Inline expandable invoice detail
function InvoiceDetail({ billing }: { billing: any }) {
  const { data, isLoading } = useQuery({
    queryKey: ['billing-detail', billing.id],
    queryFn: () => api.get(`/billing/${billing.id}`).then(r => r.data),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div style={{ padding: '12px 16px' }}>
        <div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
      </div>
    );
  }

  const b = data ?? billing;
  const lineItems: any[] = b.lineItems ?? [];
  const employees: any[] = b.employees ?? [];

  return (
    <div style={{ padding: '12px 16px', fontSize: 13 }}>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Invoice No.</div>
          <div style={{ fontWeight: 700 }}>#{b.id.slice(-8).toUpperCase()}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Billing Date</div>
          <div>{fmtDate(b.billingDate)}</div>
        </div>
        {b.paidAt && (
          <div>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Paid On</div>
            <div>{fmtDate(b.paidAt)}</div>
          </div>
        )}
        {b.soaNo && (
          <div>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>SOA #</div>
            <div style={{ fontWeight: 600 }}>{b.soaNo}</div>
          </div>
        )}
        {b.paymentRef && (
          <div>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Ref / Cheque #</div>
            <div style={{ fontWeight: 600 }}>{b.paymentRef}</div>
          </div>
        )}
        {b.serviceInvoiceNo && (
          <div>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Service Invoice / OR #</div>
            <div style={{ fontWeight: 600 }}>{b.serviceInvoiceNo}</div>
          </div>
        )}
        {b.paymentScreenshotUrl && (
          <div>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Proof</div>
            <a href={b.paymentScreenshotUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--color-primary)', fontSize: 12 }}>View screenshot →</a>
          </div>
        )}
      </div>
      {(b.grossBill != null || b.vatAmount != null || b.ewtAmount != null || b.totalNetBill != null || b.amountPaid != null) && (
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 12, padding: '10px 0', borderTop: '1px solid var(--color-border)', borderBottom: '1px solid var(--color-border)' }}>
          {b.grossBill != null && (
            <div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Gross Bill</div>
              <div style={{ fontWeight: 600 }}>{formatPHP(b.grossBill)}</div>
            </div>
          )}
          {b.vatAmount != null && (
            <div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>VAT</div>
              <div style={{ fontWeight: 600 }}>{formatPHP(b.vatAmount)}</div>
            </div>
          )}
          {b.ewtAmount != null && (
            <div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>EWT</div>
              <div style={{ fontWeight: 600, color: 'var(--color-danger)' }}>−{formatPHP(b.ewtAmount)}</div>
            </div>
          )}
          {b.totalNetBill != null && (
            <div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Total Net Bill</div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{formatPHP(b.totalNetBill)}</div>
            </div>
          )}
          {b.amountPaid != null && (
            <div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Amount Paid</div>
              <div style={{ fontWeight: 700, color: 'var(--color-success)' }}>{formatPHP(b.amountPaid)}</div>
            </div>
          )}
        </div>
      )}

      {employees.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Deployed Resources</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                <th style={{ textAlign: 'left', fontSize: 11, color: 'var(--color-text-muted)', padding: '4px 0', fontWeight: 600 }}>Name</th>
                <th style={{ textAlign: 'left', fontSize: 11, color: 'var(--color-text-muted)', padding: '4px 0', fontWeight: 600 }}>Position</th>
                <th style={{ textAlign: 'right', fontSize: 11, color: 'var(--color-text-muted)', padding: '4px 0', fontWeight: 600 }}>Rate</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e: any) => (
                <tr key={e.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td style={{ padding: '5px 0', fontSize: 12 }}>{e.firstName} {e.lastName}</td>
                  <td style={{ padding: '5px 0', fontSize: 12, color: 'var(--color-text-muted)' }}>{e.position ?? '—'}</td>
                  <td style={{ padding: '5px 0', fontSize: 12, textAlign: 'right', fontWeight: 600 }}>{formatPHP(e.resourceCost ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {lineItems.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Additional Charges</div>
          {lineItems.map((li: any, i: number) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0' }}>
              <span>{li.description}</span>
              <span style={{ fontWeight: 600 }}>{formatPHP(li.amount)}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--color-border)', paddingTop: 8, marginTop: 4 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>
          Total: {formatPHP(b.amount)}
        </div>
      </div>

      {b.notes && (
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
          Notes: {b.notes}
        </div>
      )}

      <BillingEmployeesSection billingId={b.id} />
    </div>
  );
}

// Mark Paid Modal
function MarkPaidModal({ billing, onClose, onSaved }: {
  billing: Billing & { client: { id: string; name: string } };
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [soaNo, setSoaNo] = useState('');
  const [grossBill, setGrossBill] = useState<string>(billing.amount ? String(billing.amount) : '');
  const [vatAmount, setVatAmount] = useState('');
  const [ewtAmount, setEwtAmount] = useState('');
  const [totalNetBill, setTotalNetBill] = useState('');
  const [amountPaid, setAmountPaid] = useState('');
  const [paymentRef, setPaymentRef] = useState('');
  const [serviceInvoiceNo, setServiceInvoiceNo] = useState('');
  const [screenshotFile, setScreenshotFile] = useState<File | null>(null);
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-calc total net bill = gross + vat - ewt
  useEffect(() => {
    const g = parseFloat(grossBill) || 0;
    const v = parseFloat(vatAmount) || 0;
    const e = parseFloat(ewtAmount) || 0;
    if (g || v || e) {
      setTotalNetBill(String((g + v - e).toFixed(2)));
    }
  }, [grossBill, vatAmount, ewtAmount]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setScreenshotFile(file);
    if (file) {
      setScreenshotPreview(URL.createObjectURL(file));
    } else {
      setScreenshotPreview(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      let paymentScreenshotUrl: string | undefined;
      if (screenshotFile) {
        const fd = new FormData();
        fd.append('screenshot', screenshotFile);
        const uploadRes = await api.post(`/billing/${billing.id}/payment-proof`, fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        paymentScreenshotUrl = uploadRes.data.url;
      }
      await api.put(`/billing/${billing.id}/mark-paid`, {
        soaNo: soaNo.trim() || null,
        grossBill: grossBill ? parseFloat(grossBill) : null,
        vatAmount: vatAmount ? parseFloat(vatAmount) : null,
        ewtAmount: ewtAmount ? parseFloat(ewtAmount) : null,
        totalNetBill: totalNetBill ? parseFloat(totalNetBill) : null,
        amountPaid: amountPaid ? parseFloat(amountPaid) : null,
        paymentRef: paymentRef.trim() || null,
        serviceInvoiceNo: serviceInvoiceNo.trim() || null,
        paymentScreenshotUrl: paymentScreenshotUrl ?? null,
      });
      toast('success', 'Payment recorded');
      onSaved();
    } catch (err: any) {
      const msg = err?.response?.data?.error ?? 'Failed to mark as paid.';
      setError(msg);
      toast('error', 'Failed to mark as paid');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <div>
            <h2 className="modal-title">Mark as Paid</h2>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>{billing.client?.name}</div>
          </div>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && <div className="error-msg" style={{ marginBottom: 12 }}>{error}</div>}

            <ModalSection>SOA Information</ModalSection>
            <div className="form-grid form-grid-2" style={{ gap: 12 }}>
              <div className="form-group" style={{ gridColumn: '1/-1' }}>
                <label>SOA # <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>(Statement of Account number)</span></label>
                <input
                  className="form-control"
                  placeholder="e.g. SOA-2024-001"
                  value={soaNo}
                  onChange={e => setSoaNo(e.target.value)}
                  autoFocus
                />
              </div>
            </div>

            <ModalSection>Billing Amounts</ModalSection>
            <div className="form-grid form-grid-2" style={{ gap: 12 }}>
              <div className="form-group">
                <label>Gross Bill</label>
                <input
                  type="number" min={0} step={0.01} className="form-control"
                  placeholder="0.00"
                  value={grossBill}
                  onChange={e => setGrossBill(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>VAT <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>(12%)</span></label>
                <input
                  type="number" min={0} step={0.01} className="form-control"
                  placeholder="0.00"
                  value={vatAmount}
                  onChange={e => setVatAmount(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>EWT <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>(withholding tax)</span></label>
                <input
                  type="number" min={0} step={0.01} className="form-control"
                  placeholder="0.00"
                  value={ewtAmount}
                  onChange={e => setEwtAmount(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label style={{ fontWeight: 700 }}>Total Net Bill</label>
                <input
                  type="number" min={0} step={0.01} className="form-control"
                  placeholder="Auto-calculated"
                  value={totalNetBill}
                  onChange={e => setTotalNetBill(e.target.value)}
                  style={{ fontWeight: 700 }}
                />
              </div>
              <div className="form-group">
                <label>Amount Paid</label>
                <input
                  type="number" min={0} step={0.01} className="form-control"
                  placeholder="0.00"
                  value={amountPaid}
                  onChange={e => setAmountPaid(e.target.value)}
                />
              </div>
            </div>

            <ModalSection>Payment Details</ModalSection>
            <div className="form-grid form-grid-2" style={{ gap: 12 }}>
              <div className="form-group">
                <label>Reference / Cheque # <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>(GCash, bank transfer, cheque…)</span></label>
                <input
                  className="form-control"
                  placeholder="e.g. GCash #123456789"
                  value={paymentRef}
                  onChange={e => setPaymentRef(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Service Invoice / OR # <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>(official receipt)</span></label>
                <input
                  className="form-control"
                  placeholder="e.g. OR-2024-0042"
                  value={serviceInvoiceNo}
                  onChange={e => setServiceInvoiceNo(e.target.value)}
                />
              </div>
            </div>

            <ModalSection>Proof of Payment</ModalSection>
            <div className="form-group">
              <label>Payment Screenshot <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>(optional)</span></label>
              <div
                style={{
                  border: '2px dashed var(--color-border)', borderRadius: 8, padding: 16,
                  textAlign: 'center', cursor: 'pointer', background: 'var(--color-surface-2)',
                }}
                onClick={() => fileInputRef.current?.click()}
              >
                {screenshotPreview ? (
                  <img
                    src={screenshotPreview}
                    alt="Preview"
                    style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 6, objectFit: 'contain' }}
                  />
                ) : (
                  <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>
                    <div style={{ fontSize: 24, marginBottom: 6 }}>🖼</div>
                    Click to upload proof of payment
                    <div style={{ fontSize: 11, marginTop: 4 }}>PNG, JPG, or PDF · max 10 MB</div>
                  </div>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.pdf"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
              {screenshotFile && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, fontSize: 12 }}>
                  <span style={{ color: 'var(--color-text-muted)' }}>{screenshotFile.name}</span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ fontSize: 11, color: 'var(--color-danger)' }}
                    onClick={() => { setScreenshotFile(null); setScreenshotPreview(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                  >Remove</button>
                </div>
              )}
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-success" disabled={saving}>
              {saving ? 'Saving…' : '✓ Confirm Payment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ModalSection({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10, marginTop: 20 }}>
      {children}
    </div>
  );
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}
