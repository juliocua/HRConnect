import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import api from '@/lib/api';
import type { Holiday, HolidayType } from '@/types';

const HOLIDAY_TYPE_LABELS: Record<HolidayType, string> = {
  REGULAR: 'Regular Holiday',
  SPECIAL_NON_WORKING: 'Special Non-Working',
  SPECIAL_WORKING: 'Special Working',
};

const HOLIDAY_TYPE_COLORS: Record<HolidayType, string> = {
  REGULAR: '#ef4444',
  SPECIAL_NON_WORKING: '#f97316',
  SPECIAL_WORKING: '#3b82f6',
};

const HOLIDAY_PAY_INFO: Record<HolidayType, string> = {
  REGULAR: 'Worked: 200% | Absent: 100%',
  SPECIAL_NON_WORKING: 'Worked: +30% | Absent: 0%',
  SPECIAL_WORKING: 'Worked: +30% | Absent: 0%',
};

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - 1 + i);

interface HolidayForm {
  date: string;
  name: string;
  type: HolidayType;
}

const EMPTY_FORM: HolidayForm = { date: '', name: '', type: 'REGULAR' };

export default function Holidays() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const canEdit = user?.role === 'HR_MANAGER' || user?.role === 'SUPER_ADMIN';

  const [year, setYear] = useState(CURRENT_YEAR);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Holiday | null>(null);
  const [form, setForm] = useState<HolidayForm>(EMPTY_FORM);
  const [deleting, setDeleting] = useState<string | null>(null);

  const { data: holidays = [], isLoading } = useQuery<Holiday[]>({
    queryKey: ['holidays', year],
    queryFn: () => api.get(`/holidays?year=${year}`).then((r: { data: Holiday[] }) => r.data),
  });

  const createMutation = useMutation({
    mutationFn: (data: HolidayForm) => api.post('/holidays', data).then((r: { data: Holiday }) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['holidays'] }); setShowModal(false); },
    onError: () => {},
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: HolidayForm }) => api.put(`/holidays/${id}`, data).then((r: { data: Holiday }) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['holidays'] }); setShowModal(false); },
    onError: () => {},
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/holidays/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['holidays'] }); setDeleting(null); },
    onError: () => {},
  });

  function openAdd() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowModal(true);
  }

  function openEdit(h: Holiday) {
    setEditing(h);
    setForm({ date: h.date.slice(0, 10), name: h.name, type: h.type });
    setShowModal(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.date || !form.name) return;
    if (editing) {
      updateMutation.mutate({ id: editing.id, data: form });
    } else {
      createMutation.mutate(form);
    }
  }

  // Group by month
  const byMonth: Record<number, Holiday[]> = {};
  for (const h of holidays) {
    const m = new Date(h.date).getUTCMonth();
    if (!byMonth[m]) byMonth[m] = [];
    byMonth[m].push(h);
  }

  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  return (
    <div className="page-content" style={{ maxWidth: 900 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Holiday Calendar</h1>
          <p style={{ color: '#6b7280', fontSize: 13, margin: '4px 0 0' }}>
            Philippine labor law holiday pay rates apply automatically to payroll runs
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <select
            value={year}
            onChange={e => setYear(Number(e.target.value))}
            className="form-input"
            style={{ width: 100 }}
          >
            {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          {canEdit && (
            <button className="btn btn-primary" onClick={openAdd}>+ Add Holiday</button>
          )}
        </div>
      </div>

      {/* Pay rate legend */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        {(Object.keys(HOLIDAY_TYPE_LABELS) as HolidayType[]).map(t => (
          <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 14px' }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: HOLIDAY_TYPE_COLORS[t], flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#111' }}>{HOLIDAY_TYPE_LABELS[t]}</div>
              <div style={{ fontSize: 11, color: '#6b7280' }}>{HOLIDAY_PAY_INFO[t]}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Holiday list */}
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af' }}>Loading…</div>
      ) : holidays.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af' }}>
          No holidays for {year}.{canEdit && ' Click "Add Holiday" to add one.'}
        </div>
      ) : (
        Object.entries(byMonth).sort(([a], [b]) => Number(a) - Number(b)).map(([m, hs]) => (
          <div key={m} style={{ marginBottom: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
              {monthNames[Number(m)]}
            </div>
            {hs.sort((a, b) => a.date.localeCompare(b.date)).map(h => (
              <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: 6 }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: HOLIDAY_TYPE_COLORS[h.type], flexShrink: 0 }} />
                <div style={{ minWidth: 90, fontSize: 13, fontWeight: 600, color: '#374151' }}>
                  {new Date(h.date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', timeZone: 'UTC' })}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{h.name}</div>
                  <div style={{ fontSize: 11, color: '#9ca3af' }}>{HOLIDAY_TYPE_LABELS[h.type]} — {HOLIDAY_PAY_INFO[h.type]}</div>
                </div>
                {canEdit && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-sm btn-secondary" onClick={() => openEdit(h)}>Edit</button>
                    <button
                      className="btn btn-sm"
                      style={{ background: '#fee2e2', color: '#dc2626', border: 'none' }}
                      onClick={() => setDeleting(h.id)}
                    >Delete</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        ))
      )}

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">{editing ? 'Edit Holiday' : 'Add Holiday'}</h2>
              <button className="modal-close" onClick={() => setShowModal(false)}>×</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                <div className="form-group">
                  <label>Date</label>
                  <input
                    type="date"
                    className="form-control"
                    value={form.date}
                    onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Holiday Name</label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="e.g. New Year's Day"
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Type</label>
                  <select
                    className="form-control"
                    value={form.type}
                    onChange={e => setForm(f => ({ ...f, type: e.target.value as HolidayType }))}
                  >
                    {(Object.keys(HOLIDAY_TYPE_LABELS) as HolidayType[]).map(t => (
                      <option key={t} value={t}>{HOLIDAY_TYPE_LABELS[t]}</option>
                    ))}
                  </select>
                  <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
                    Pay rule: {HOLIDAY_PAY_INFO[form.type]}
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={createMutation.isPending || updateMutation.isPending}
                >
                  {editing ? 'Save Changes' : 'Add Holiday'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleting && (
        <div className="modal-overlay" onClick={() => setDeleting(null)}>
          <div className="modal" style={{ maxWidth: 380 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Delete Holiday</h2>
              <button className="modal-close" onClick={() => setDeleting(null)}>×</button>
            </div>
            <div className="modal-body">
              <p>Are you sure you want to delete this holiday? This cannot be undone.</p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setDeleting(null)}>Cancel</button>
              <button
                className="btn"
                style={{ background: '#dc2626', color: '#fff' }}
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(deleting)}
              >Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
