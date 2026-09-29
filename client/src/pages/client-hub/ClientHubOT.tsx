import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { useToast } from '@/lib/toast';

interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  employeeNo: string;
  position: string;
}

interface OTRequest {
  id: string;
  date: string;
  hours: number;
  reason?: string | null;
  status: string;
  filedAt: string;
  employee: Employee;
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

function statusBadge(s: string) {
  const colors: Record<string, string> = {
    PENDING: '#f59e0b',
    APPROVED: '#10b981',
    REJECTED: '#ef4444',
  };
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 12,
      fontSize: 11, fontWeight: 600, background: colors[s] ?? '#6b7280',
      color: '#fff',
    }}>
      {s}
    </span>
  );
}

export default function ClientHubOT() {
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<'pending' | 'history'>('pending');
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const { data: pending = [], isLoading } = useQuery<OTRequest[]>({
    queryKey: ['client-hub-ot'],
    queryFn: () => api.get('/client-hub/overtime').then((r: { data: any }) => r.data),
    enabled: tab === 'pending',
  });

  const { data: history = [], isLoading: histLoading } = useQuery<OTRequest[]>({
    queryKey: ['client-hub-ot-history'],
    queryFn: () => api.get('/client-hub/overtime/history').then((r: { data: any }) => r.data),
    enabled: tab === 'history',
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.put(`/client-hub/overtime/${id}/approve`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client-hub-ot'] });
      qc.invalidateQueries({ queryKey: ['client-hub-ot-history'] });
      toast('OT request approved', 'success');
    },
    onError: (err: any) => toast(err?.response?.data?.error ?? 'Failed to approve', 'error'),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.put(`/client-hub/overtime/${id}/reject`, { reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client-hub-ot'] });
      qc.invalidateQueries({ queryKey: ['client-hub-ot-history'] });
      setRejectId(null);
      setRejectReason('');
      toast('OT request rejected', 'success');
    },
    onError: (err: any) => toast(err?.response?.data?.error ?? 'Failed to reject', 'error'),
  });

  const records = tab === 'pending' ? pending : history;
  const loading = tab === 'pending' ? isLoading : histLoading;

  return (
    <div style={{ padding: 32 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>OT Approvals</h1>
        <p style={{ fontSize: 13, color: '#6b7280', margin: '4px 0 0' }}>
          Review and approve overtime requests from your employees.
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid #e5e7eb' }}>
        {(['pending', 'history'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '8px 18px', border: 'none', background: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: tab === t ? 600 : 400,
              color: tab === t ? '#2563eb' : '#6b7280',
              borderBottom: tab === t ? '2px solid #2563eb' : '2px solid transparent',
              marginBottom: -1,
            }}
          >
            {t === 'pending' ? `Pending${pending.length ? ` (${pending.length})` : ''}` : 'History'}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af' }}>Loading…</div>
      ) : records.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af' }}>
          {tab === 'pending' ? 'No pending OT requests.' : 'No history yet.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {records.map(r => (
            <div key={r.id} style={{
              background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
              padding: '16px 20px',
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>
                      {r.employee.firstName} {r.employee.lastName}
                    </span>
                    <span style={{ fontSize: 11, color: '#6b7280' }}>{r.employee.employeeNo}</span>
                    <span style={{ fontSize: 11, color: '#9ca3af' }}>{r.employee.position}</span>
                    {statusBadge(r.status)}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '6px 20px', fontSize: 12, color: '#374151' }}>
                    <div><span style={{ color: '#6b7280' }}>Date: </span>{formatDate(r.date)}</div>
                    <div><span style={{ color: '#6b7280' }}>Hours: </span><strong>{r.hours}h</strong></div>
                    <div><span style={{ color: '#6b7280' }}>Filed: </span>{formatDate(r.filedAt)}</div>
                  </div>

                  {r.reason && (
                    <div style={{ marginTop: 8, fontSize: 12, color: '#6b7280' }}>
                      <span style={{ fontWeight: 600 }}>Reason: </span>{r.reason}
                    </div>
                  )}
                </div>

                {tab === 'pending' && (
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    <button
                      onClick={() => approveMutation.mutate(r.id)}
                      disabled={approveMutation.isPending}
                      style={{
                        padding: '7px 16px', background: '#10b981', color: '#fff',
                        border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => { setRejectId(r.id); setRejectReason(''); }}
                      style={{
                        padding: '7px 16px', background: '#fff', color: '#ef4444',
                        border: '1px solid #ef4444', borderRadius: 6, fontSize: 12, fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Reject modal */}
      {rejectId && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div style={{
            background: '#fff', borderRadius: 12, padding: 28, width: 400,
            boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
          }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>Reject OT Request</h3>
            <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 16px' }}>
              Optionally provide a reason for rejection.
            </p>
            <textarea
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              placeholder="Reason (optional)"
              rows={3}
              style={{
                width: '100%', padding: '8px 12px', border: '1px solid #d1d5db',
                borderRadius: 6, fontSize: 13, resize: 'vertical', boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button
                onClick={() => setRejectId(null)}
                style={{
                  padding: '8px 16px', background: '#f3f4f6', border: 'none',
                  borderRadius: 6, fontSize: 13, cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => rejectMutation.mutate({ id: rejectId, reason: rejectReason })}
                disabled={rejectMutation.isPending}
                style={{
                  padding: '8px 16px', background: '#ef4444', color: '#fff',
                  border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
