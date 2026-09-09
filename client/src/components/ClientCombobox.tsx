import { useState, useRef, useEffect, useId } from 'react';
import type { Client } from '@/types';

interface ClientComboboxProps {
  clients: Client[];
  value: string;                  // clientId or ''
  onChange: (id: string) => void;
  placeholder?: string;           // e.g. "All Clients" or "Select client…"
  required?: boolean;
  style?: React.CSSProperties;
}

export function ClientCombobox({
  clients,
  value,
  onChange,
  placeholder = 'All Clients',
  required = false,
  style,
}: ClientComboboxProps) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = clients.find(c => c.id === value) ?? null;

  const displayValue = open ? query : (selected ? selected.name : '');

  const filtered = query.trim()
    ? clients.filter(c =>
        c.name.toLowerCase().includes(query.toLowerCase()) ||
        c.contactName?.toLowerCase().includes(query.toLowerCase())
      )
    : clients;

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

  const select = (client: Client | null) => {
    onChange(client ? client.id : '');
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

  // Generate a deterministic color from the client name
  const clientColor = (name: string) => {
    const colors = ['#2563EB', '#7C3AED', '#059669', '#D97706', '#DC2626', '#0891B2', '#BE185D'];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
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
        {/* Clear button */}
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
              No clients found
            </div>
          ) : (
            filtered.map(client => {
              const isSelected = client.id === value;
              const initials = client.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
              return (
                <div
                  key={client.id}
                  onMouseDown={e => { e.preventDefault(); select(client); }}
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
                    width: 28, height: 28, borderRadius: 6, flexShrink: 0,
                    background: clientColor(client.name), color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 700,
                  }}>
                    {initials}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {client.name}
                    </div>
                    {client.contactName && (
                      <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', fontWeight: 400 }}>
                        {client.contactName}
                      </div>
                    )}
                  </div>
                  {!client.activeContract && (
                    <span style={{ fontSize: 10, color: 'var(--color-text-muted)', flexShrink: 0 }}>inactive</span>
                  )}
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
