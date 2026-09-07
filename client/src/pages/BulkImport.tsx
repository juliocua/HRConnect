import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '@/lib/api';

type ImportType = 'client' | 'employee' | 'time';

interface ImportResult {
  total: number;
  imported: number;
  created: number;
  updated: number;
  failed: number;
  results: { row: number; status: 'ok' | 'error'; action?: 'created' | 'updated'; name: string; error?: string }[];
}

const TYPE_META: Record<ImportType, { label: string; icon: string; desc: string; fields: { col: string; desc: string; required?: boolean; values?: string }[] }> = {
  client: {
    label: 'Clients', icon: '🏢', desc: 'Import client companies and their billing setup.',
    fields: [
      { col: 'name', desc: 'Company name', required: true },
      { col: 'contactName', desc: 'Primary contact person' },
      { col: 'contactEmail', desc: 'Contact email address' },
      { col: 'contactPhone', desc: 'Contact phone number' },
      { col: 'address', desc: 'Company address' },
      { col: 'billingCycle', desc: 'Billing frequency', required: true, values: 'WEEKLY, EVERY_15TH, EVERY_30TH, MONTHLY' },
      { col: 'billingDate', desc: 'Day of month for MONTHLY billing (1–31)' },
      { col: 'activeContract', desc: 'Has active contract?', values: 'TRUE, FALSE' },
    ],
  },
  employee: {
    label: 'Employees', icon: '👥', desc: 'Import employee records. Existing employees matched by employeeNo will be updated.',
    fields: [
      { col: 'employeeNo', desc: 'Employee number (used for matching on re-import)' },
      { col: 'firstName', desc: 'First name', required: true },
      { col: 'lastName', desc: 'Last name', required: true },
      { col: 'email', desc: 'Email address' },
      { col: 'phone', desc: 'Phone number' },
      { col: 'position', desc: 'Job title / position' },
      { col: 'department', desc: 'Internal department name — must exactly match an existing department', required: true },
      { col: 'clientName', desc: 'Client company where employee is deployed — must exactly match an existing client name', required: true },
      { col: 'hireDate', desc: 'Hire date', values: 'YYYY-MM-DD' },
      { col: 'basicSalary', desc: 'Basic monthly salary (numeric)' },
      { col: 'status', desc: 'Employment status', values: 'ACTIVE, ON_LEAVE, TERMINATED' },
      { col: 'resourceCost', desc: 'Billing rate charged to client (numeric)' },
      { col: 'payrollCost', desc: 'Actual payroll cost (numeric)' },
    ],
  },
  time: {
    label: 'Time Records', icon: '🕐', desc: 'Import attendance / time records. Existing records for the same employee + date will be updated.',
    fields: [
      { col: 'employeeNo', desc: 'Employee number (must match existing)', required: true },
      { col: 'date', desc: 'Attendance date', required: true, values: 'YYYY-MM-DD' },
      { col: 'status', desc: 'Attendance status', required: true, values: 'PRESENT, ABSENT, LATE, HALF_DAY, ON_LEAVE' },
      { col: 'overtimeHrs', desc: 'Overtime hours (numeric, default 0)' },
      { col: 'notes', desc: 'Optional notes' },
    ],
  },
};

export default function BulkImport() {
  const [params] = useSearchParams();
  const preselect = params.get('type') as ImportType | null;

  const [step, setStep] = useState<1 | 2 | 3>(preselect ? 2 : 1);
  const [type, setType] = useState<ImportType | null>(preselect);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const meta = type ? TYPE_META[type] : null;

  const downloadTemplate = async () => {
    if (!type) return;
    try {
      const res = await api.get(`/import/template/${type}`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `hrconnect-${type}-template.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      setError('Failed to download template. Please try again.');
    }
  };

  const handleFile = (f: File) => {
    if (!f.name.endsWith('.csv')) { setError('Please upload a .csv file.'); return; }
    setFile(f);
    setError(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  const doImport = async () => {
    if (!file || !type) return;
    setLoading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await api.post(`/import/${type}`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setResult(res.data);
      setStep(3);
    } catch (err: any) {
      setError(err?.response?.data?.error ?? 'Import failed. Check the file and try again.');
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setStep(1); setType(null); setFile(null);
    setResult(null); setError(null);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Bulk Import</h1>
          <p className="page-desc">Import records in bulk using a CSV file</p>
        </div>
      </div>

      {/* Stepper */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 32 }}>
        {(['Select Type', 'Upload File', 'Results'] as const).map((label, i) => {
          const s = (i + 1) as 1 | 2 | 3;
          const active = step === s;
          const done = step > s;
          return (
            <div key={label} style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 700, fontSize: 13,
                  background: done ? '#16A34A' : active ? 'var(--color-primary)' : 'var(--color-surface-2)',
                  color: done || active ? '#fff' : 'var(--color-text-muted)',
                  border: `2px solid ${done ? '#16A34A' : active ? 'var(--color-primary)' : 'var(--color-border)'}`,
                }}>
                  {done ? '✓' : s}
                </div>
                <span style={{ fontSize: 13, fontWeight: active ? 700 : 400, color: active ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
                  {label}
                </span>
              </div>
              {i < 2 && <div style={{ flex: 1, height: 1, background: 'var(--color-border)', margin: '0 12px' }} />}
            </div>
          );
        })}
      </div>

      {/* Step 1 — Choose type */}
      {step === 1 && (
        <div>
          <p style={{ marginBottom: 20, color: 'var(--color-text-muted)', fontSize: 14 }}>
            What would you like to import?
          </p>
          <div className="grid-3" style={{ gap: 16 }}>
            {(Object.entries(TYPE_META) as [ImportType, typeof TYPE_META[ImportType]][]).map(([key, m]) => (
              <button
                key={key}
                onClick={() => { setType(key); setStep(2); }}
                style={{
                  background: 'var(--color-surface)', border: '2px solid var(--color-border)',
                  borderRadius: 12, padding: '24px 20px', cursor: 'pointer', textAlign: 'left',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-primary)')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--color-border)')}
              >
                <div style={{ fontSize: 32, marginBottom: 12 }}>{m.icon}</div>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{m.label}</div>
                <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{m.desc}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step 2 — Download template + Upload */}
      {step === 2 && meta && type && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 720 }}>
          {/* Back */}
          <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => { setStep(1); setFile(null); setError(null); }}>
            ← Back
          </button>

          {/* Template card */}
          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">1. Download Template</div>
                <div className="card-subtitle">Fill in your data using this template — don't change the column headers</div>
              </div>
              <button className="btn btn-primary" onClick={downloadTemplate}>
                ⬇ Download Template
              </button>
            </div>

            {/* Column reference */}
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8, fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--color-surface-2)' }}>
                  <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 700, color: 'var(--color-text-muted)', fontSize: 11, textTransform: 'uppercase' }}>Column</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 700, color: 'var(--color-text-muted)', fontSize: 11, textTransform: 'uppercase' }}>Description</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 700, color: 'var(--color-text-muted)', fontSize: 11, textTransform: 'uppercase' }}>Accepted Values</th>
                </tr>
              </thead>
              <tbody>
                {meta.fields.map((f, i) => (
                  <tr key={f.col} style={{ borderTop: '1px solid var(--color-border)', background: i % 2 === 0 ? 'transparent' : 'var(--color-surface-2)' }}>
                    <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontWeight: 700, color: 'var(--color-primary)', fontSize: 12 }}>
                      {f.col}
                      {f.required && <span style={{ color: '#DC2626', marginLeft: 4 }}>*</span>}
                    </td>
                    <td style={{ padding: '8px 12px', color: 'var(--color-text)' }}>{f.desc}</td>
                    <td style={{ padding: '8px 12px', color: 'var(--color-text-muted)', fontFamily: f.values ? 'monospace' : undefined, fontSize: 12 }}>{f.values ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 8 }}>
              <span style={{ color: '#DC2626' }}>*</span> Required fields
            </p>
          </div>

          {/* Upload card */}
          <div className="card">
            <div className="card-title" style={{ marginBottom: 16 }}>2. Upload Filled CSV</div>

            <div
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
              style={{
                border: `2px dashed ${dragging ? 'var(--color-primary)' : file ? '#16A34A' : 'var(--color-border)'}`,
                borderRadius: 10, padding: '40px 20px', textAlign: 'center', cursor: 'pointer',
                background: dragging ? 'var(--color-primary-light)' : file ? '#F0FDF4' : 'var(--color-surface-2)',
                transition: 'all 0.15s',
              }}
            >
              <input
                ref={fileRef}
                type="file"
                accept=".csv"
                style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              />
              {file ? (
                <>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
                  <div style={{ fontWeight: 700, color: '#15803D' }}>{file.name}</div>
                  <div style={{ fontSize: 12, color: '#16A34A', marginTop: 4 }}>
                    {(file.size / 1024).toFixed(1)} KB · Click to change
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>📂</div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>Drop your CSV here or click to browse</div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>Only .csv files, max 5 MB</div>
                </>
              )}
            </div>

            {error && <div className="error-msg" style={{ marginTop: 12 }}>{error}</div>}

            <div style={{ display: 'flex', gap: 12, marginTop: 16, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => { setFile(null); setError(null); }}>Clear</button>
              <button className="btn btn-primary" disabled={!file || loading} onClick={doImport}>
                {loading ? 'Importing…' : `⬆ Import ${meta.label}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 3 — Results */}
      {step === 3 && result && (
        <div style={{ maxWidth: 720 }}>
          {/* Summary bar */}
          <div className="card" style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              <Stat label="Total rows" value={result.total} color="var(--color-text)" />
              <Stat label="Created" value={result.created ?? result.imported} color="#16A34A" />
              <Stat label="Updated" value={result.updated ?? 0} color="#2563EB" />
              <Stat label="Failed" value={result.failed} color={result.failed > 0 ? '#DC2626' : 'var(--color-text-muted)'} />
            </div>
            <div style={{ marginTop: 16, display: 'flex', gap: 12 }}>
              <button className="btn btn-primary" onClick={reset}>← Import Another</button>
              {result.failed > 0 && (
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    const errors = result.results.filter(r => r.status === 'error');
                    const csv = ['row,name,error', ...errors.map(e => `${e.row},"${e.name}","${e.error}"`)].join('\n');
                    const blob = new Blob([csv], { type: 'text/csv' });
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = 'import-errors.csv';
                    a.click();
                  }}
                >
                  ⬇ Download Errors
                </button>
              )}
            </div>
          </div>

          {/* Row-by-row results */}
          <div className="card">
            <div className="card-title" style={{ marginBottom: 16 }}>Row Results</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 480, overflowY: 'auto' }}>
              {result.results.map(r => (
                <div
                  key={r.row}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 12, padding: '8px 12px',
                    borderRadius: 8, fontSize: 13,
                    background: r.status === 'ok' ? '#F0FDF4' : '#FEF2F2',
                    border: `1px solid ${r.status === 'ok' ? '#BBF7D0' : '#FECACA'}`,
                  }}
                >
                  <span style={{ fontWeight: 700, color: r.status === 'ok' ? '#16A34A' : '#DC2626', minWidth: 20 }}>
                    {r.status === 'ok' ? '✓' : '✗'}
                  </span>
                  <span style={{ color: 'var(--color-text-muted)', fontSize: 11, minWidth: 40 }}>Row {r.row}</span>
                  <span style={{ fontWeight: 600, flex: 1 }}>{r.name}</span>
                  {r.action && (
                    <span style={{
                      fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                      background: r.action === 'created' ? '#DCFCE7' : '#DBEAFE',
                      color: r.action === 'created' ? '#15803D' : '#1D4ED8',
                    }}>
                      {r.action === 'created' ? 'NEW' : 'UPDATED'}
                    </span>
                  )}
                  {r.error && <span style={{ color: '#DC2626', fontSize: 12 }}>{r.error}</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div style={{ fontSize: 28, fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{label}</div>
    </div>
  );
}