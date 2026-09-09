import { useState, useRef, useEffect } from 'react';

export interface MultiSelectOption {
  id: string;
  name: string;
  subtitle?: string;       // e.g. position for employees
  avatarColor?: string;    // shows colored initials avatar when set
  initials?: string;       // 2-char fallback; derived from name if omitted
}

interface SearchableMultiSelectProps {
  label: string;                          // e.g. "Employees", "Clients"
  options: MultiSelectOption[];
  selected: string[];                     // array of selected ids
  onChange: (ids: string[]) => void;
  style?: React.CSSProperties;
}

export function SearchableMultiSelect({
  label,
  options,
  selected,
  onChange,
  style,
}: SearchableMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

  const toggle = (id: string) => {
    if (selected.includes(id)) onChange(selected.filter(x => x !== id));
    else onChange([...selected, id]);
  };

  const clearAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange([]);
  };

  const filtered = query.trim()
    ? options.filter(o =>
        o.name.toLowerCase().includes(query.toLowerCase()) ||
        o.subtitle?.toLowerCase().includes(query.toLowerCase())
      )
    : options;

  const displayText =
    selected.length === 0
      ? `All ${label}`
      : selected.length === 1
        ? options.find(o => o.id === selected[0])?.name ?? '1 selected'
        : `${selected.length} ${label} selected`;

  const getInitials = (o: MultiSelectOption) => {
    if (o.initials) return o.initials;
    const parts = o.name.trim().split(' ');
    return parts.length >= 2
      ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
      : o.name.slice(0, 2).toUpperCase();
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', ...style }}>
      {/* Trigger */}
      <button
        type="button"
        className="form-control"
        onClick={() => {
          setOpen(v => !v);
          if (!open) setTimeout(() => inputRef.current?.focus(), 50);
        }}
        style={{
          textAlign: 'left', cursor: 'pointer',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          gap: 6, paddingRight: 8,
        }}
      >
        <span style={{ color: selected.length === 0 ? 'var(--color-text-muted)' : undefined, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {displayText}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          {selected.length > 0 && (
            <span
              onMouseDown={e => { e.stopPropagation(); clearAll(e); }}
              style={{ fontSize: 13, color: 'var(--color-text-muted)', cursor: 'pointer', lineHeight: 1, padding: '0 2px' }}
              title="Clear selection"
            >✕</span>
          )}
          <svg
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
            style={{
              width: 13, height: 13, color: 'var(--color-text-muted)',
              transition: 'transform 0.15s',
              transform: open ? 'rotate(180deg)' : 'none',
            }}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, minWidth: '100%',
          zIndex: 1000,
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
        }}>
          {/* Search input */}
          <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--color-border)' }}>
            <input
              ref={inputRef}
              type="text"
              className="form-control"
              placeholder={`Search ${label.toLowerCase()}…`}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Escape' && (setOpen(false), setQuery(''))}
              style={{ fontSize: 13, padding: '5px 8px' }}
              autoComplete="off"
            />
          </div>

          {/* Select all / clear row */}
          {options.length > 0 && (
            <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--color-border)' }}>
              <button
                type="button"
                onMouseDown={e => { e.preventDefault(); onChange(filtered.map(o => o.id)); }}
                style={{
                  flex: 1, padding: '6px 12px', fontSize: 12,
                  color: 'var(--color-primary)', background: 'none', border: 'none',
                  cursor: 'pointer', fontWeight: 600, textAlign: 'center',
                }}
              >Select all{query ? ' filtered' : ''}</button>
              <div style={{ width: 1, background: 'var(--color-border)' }} />
              <button
                type="button"
                onMouseDown={e => { e.preventDefault(); onChange([]); }}
                style={{
                  flex: 1, padding: '6px 12px', fontSize: 12,
                  color: 'var(--color-text-muted)', background: 'none', border: 'none',
                  cursor: 'pointer', fontWeight: 600, textAlign: 'center',
                }}
              >Clear all</button>
            </div>
          )}

          {/* List */}
          <div style={{ maxHeight: 240, overflowY: 'auto' }}>
            {filtered.length === 0 ? (
              <div style={{ padding: '10px 14px', fontSize: 13, color: 'var(--color-text-muted)' }}>
                No {label.toLowerCase()} found
              </div>
            ) : (
              filtered.map(o => {
                const checked = selected.includes(o.id);
                return (
                  <label
                    key={o.id}
                    onMouseDown={e => { e.preventDefault(); toggle(o.id); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '8px 14px', cursor: 'pointer', fontSize: 13.5,
                      background: checked ? 'var(--color-primary-light)' : 'transparent',
                      color: checked ? 'var(--color-primary)' : 'var(--color-text-primary)',
                    }}
                    onMouseEnter={e => { if (!checked) e.currentTarget.style.background = 'var(--color-surface-2)'; }}
                    onMouseLeave={e => { if (!checked) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(o.id)}
                      onClick={e => e.stopPropagation()}
                      style={{ accentColor: 'var(--color-primary)', flexShrink: 0 }}
                    />
                    {o.avatarColor && (
                      <div style={{
                        width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                        background: o.avatarColor, color: '#fff',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 700,
                      }}>
                        {getInitials(o)}
                      </div>
                    )}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ lineHeight: 1.2, fontWeight: checked ? 600 : 400 }}>{o.name}</div>
                      {o.subtitle && (
                        <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', fontWeight: 400 }}>{o.subtitle}</div>
                      )}
                    </div>
                  </label>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
