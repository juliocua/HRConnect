import { useState, useRef, useEffect, useId } from 'react';
import type { Employee } from '@/types';

interface EmployeeComboboxProps {
  employees: Employee[];
  value: string;                  // employeeId or ''
  onChange: (id: string) => void;
  placeholder?: string;           // e.g. "All Employees" or "Select employee…"
  required?: boolean;
  style?: React.CSSProperties;
}

export function EmployeeCombobox({
  employees,
  value,
  onChange,
  placeholder = 'All Employees',
  required = false,
  style,
}: EmployeeComboboxProps) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = employees.find(e => e.id === value) ?? null;

  // Display text: when closed show selected name, when open show current query
  const displayValue = open ? query : (selected ? `${selected.firstName} ${selected.lastName}` : '');

  const filtered = query.trim()
    ? employees.filter(e =>
        `${e.firstName} ${e.lastName}`.toLowerCase().includes(query.toLowerCase()) ||
        e.position?.toLowerCase().includes(query.toLowerCase())
      )
    : employees;

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const select = (emp: Employee | null) => {
    onChange(emp ? emp.id : '');
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  };

  const handleFocus = () => {
    setQuery('');
    setOpen(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); setQuery(''); inputRef.current?.blur(); }
    if (e.key === 'Enter' && filtered.length === 1) { select(filtered[0]); }
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', ...style }}>
      <div style={{ position: 'relative' }}>
        <input
          id={id}
          ref={inputRef}
          type="text"
          className="form-control"
          required={required && !value}
          placeholder={placeholder}
          value={displayValue}
          onFocus={handleFocus}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onKeyDown={handleKeyDown}
          autoComplete="off"
          style={{ paddingRight: 28 }}
        />
        {/* Chevron */}
        <svg
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          style={{
            position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
            width: 14, height: 14, color: 'var(--color-text-muted)', pointerEvents: 'none',
            transition: 'transform 0.15s',
            ...(open ? { transform: 'translateY(-50%) rotate(180deg)' } : {}),
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
        {/* Clear button — shown when something is selected and not open */}
        {value && !open && (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); select(null); }}
            style={{
              position: 'absolute', right: 26, top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--color-text-muted)', fontSize: 14, lineHeight: 1,
              padding: '0 2px',
            }}
            title="Clear"
          >✕</button>
        )}
      </div>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 1000,
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
          maxHeight: 260,
          overflowY: 'auto',
        }}>
          {/* "All / None" option when not required */}
          {!required && (
            <div
              onMouseDown={e => { e.preventDefault(); select(null); }}
              style={{
                padding: '9px 12px',
                cursor: 'pointer',
                fontSize: 13.5,
                color: !value ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                fontWeight: !value ? 600 : 400,
                borderBottom: '1px solid var(--color-border)',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-2)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              {placeholder}
            </div>
          )}

          {filtered.length === 0 ? (
            <div style={{ padding: '10px 12px', fontSize: 13, color: 'var(--color-text-muted)' }}>
              No employees found
            </div>
          ) : (
            filtered.map(emp => {
              const isSelected = emp.id === value;
              return (
                <div
                  key={emp.id}
                  onMouseDown={e => { e.preventDefault(); select(emp); }}
                  style={{
                    padding: '9px 12px',
                    cursor: 'pointer',
                    fontSize: 13.5,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    background: isSelected ? 'var(--color-primary-light)' : 'transparent',
                    color: isSelected ? 'var(--color-primary)' : 'var(--color-text-primary)',
                    fontWeight: isSelected ? 600 : 400,
                  }}
                  onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'var(--color-surface-2)'; }}
                  onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
                >
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                    background: emp.avatarColor, color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 700,
                  }}>
                    {emp.firstName[0]}{emp.lastName[0]}
                  </div>
                  <div>
                    <div style={{ lineHeight: 1.2 }}>{emp.firstName} {emp.lastName}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', fontWeight: 400 }}>{emp.position}</div>
                  </div>
                  {isSelected && (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                      style={{ marginLeft: 'auto', width: 14, height: 14, flexShrink: 0 }}>
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
