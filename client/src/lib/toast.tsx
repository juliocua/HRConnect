/**
 * Lightweight toast system — no external dependencies.
 * Usage:
 *   const toast = useToast();
 *   toast('success', 'Saved!');
 *   toast('error', 'Something went wrong.');
 */

import { createContext, useCallback, useContext, useRef, useState } from 'react';

type ToastKind = 'success' | 'error';

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

type ToastFn = (kind: ToastKind, message: string) => void;

const ToastContext = createContext<ToastFn>(() => {});

export function useToast(): ToastFn {
  return useContext(ToastContext);
}

const ICONS: Record<ToastKind, string> = {
  success: '✓',
  error: '✕',
};

const AUTO_DISMISS_MS = 4500;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const add = useCallback<ToastFn>((kind, message) => {
    const id = ++counter.current;
    setToasts(prev => [...prev, { id, kind, message }]);
    setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
  }, [dismiss]);

  return (
    <ToastContext.Provider value={add}>
      {children}
      <div className="toast-container" aria-live="polite" aria-atomic="false">
        {toasts.map(t => (
          <div key={t.id} className={`toast toast-${t.kind}`} role="alert">
            <span className="toast-icon">{ICONS[t.kind]}</span>
            <span className="toast-message">{t.message}</span>
            <button
              className="toast-close"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss notification"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
