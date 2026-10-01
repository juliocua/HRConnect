import { useState, useRef, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

// ── Types ─────────────────────────────────────────────────────────────────────

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

type ChatMode = 'closed' | 'open' | 'fullscreen';

// ── Helper ────────────────────────────────────────────────────────────────────

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

// Simple markdown-ish renderer: bold, inline code, line breaks
function renderContent(text: string) {
  const lines = text.split('\n');
  return lines.map((line, i) => {
    // Render **bold** and `code`
    const parts: (string | JSX.Element)[] = [];
    let rest = line;
    let key = 0;

    while (rest.length > 0) {
      const boldIdx = rest.indexOf('**');
      const codeIdx = rest.indexOf('`');

      if (boldIdx === -1 && codeIdx === -1) {
        parts.push(rest);
        break;
      }

      const nextSpecial =
        boldIdx === -1 ? codeIdx : codeIdx === -1 ? boldIdx : Math.min(boldIdx, codeIdx);

      if (nextSpecial > 0) {
        parts.push(rest.slice(0, nextSpecial));
        rest = rest.slice(nextSpecial);
        continue;
      }

      if (rest.startsWith('**')) {
        const end = rest.indexOf('**', 2);
        if (end !== -1) {
          parts.push(<strong key={key++}>{rest.slice(2, end)}</strong>);
          rest = rest.slice(end + 2);
        } else {
          parts.push(rest);
          break;
        }
      } else if (rest.startsWith('`')) {
        const end = rest.indexOf('`', 1);
        if (end !== -1) {
          parts.push(
            <code
              key={key++}
              style={{
                fontFamily: 'monospace',
                fontSize: '0.85em',
                background: 'rgba(0,0,0,0.08)',
                borderRadius: 3,
                padding: '1px 4px',
              }}
            >
              {rest.slice(1, end)}
            </code>
          );
          rest = rest.slice(end + 1);
        } else {
          parts.push(rest);
          break;
        }
      }
    }

    return (
      <span key={i}>
        {parts}
        {i < lines.length - 1 && <br />}
      </span>
    );
  });
}

// ── ChatBubble Component ──────────────────────────────────────────────────────

export default function ChatBubble() {
  const { user } = useAuth();
  const [mode, setMode] = useState<ChatMode>('closed');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Don't render if not logged in
  if (!user) return null;

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (mode !== 'closed') {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [mode]);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (mode === 'fullscreen') setMode('open');
        else if (mode === 'open') setMode('closed');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: Message = { id: uid(), role: 'user', content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    // Build Gemini-compatible history from prior messages
    const history = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    try {
      const res = await api.post<{ reply: string }>('/chat', { message: text, history });
      const assistantMsg: Message = {
        id: uid(),
        role: 'assistant',
        content: res.data.reply,
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err: any) {
      const errMsg =
        err?.response?.data?.error ?? 'Failed to get a response. Please try again.';
      const errMsgObj: Message = { id: uid(), role: 'assistant', content: `⚠️ ${errMsg}` };
      setMessages(prev => [...prev, errMsgObj]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearChat = () => {
    setMessages([]);
  };

  // ── Panel dimensions ────────────────────────────────────────────────────────

  const panelStyle: React.CSSProperties =
    mode === 'fullscreen'
      ? {
          position: 'fixed',
          inset: '5vh 5vw',
          width: '90vw',
          height: '90vh',
          zIndex: 9999,
        }
      : {
          position: 'fixed',
          bottom: 88,
          right: 20,
          width: 380,
          height: 520,
          zIndex: 9998,
        };

  // ── Bubble button ───────────────────────────────────────────────────────────

  const bubbleButton = (
    <button
      onClick={() => setMode(mode === 'closed' ? 'open' : 'closed')}
      title={mode === 'closed' ? 'Open AI Assistant' : 'Minimize'}
      style={{
        position: 'fixed',
        bottom: 20,
        right: 20,
        width: 56,
        height: 56,
        borderRadius: '50%',
        background: 'var(--color-primary, #2563eb)',
        border: 'none',
        boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9997,
        transition: 'transform 0.15s, box-shadow 0.15s',
        color: '#fff',
        fontSize: 24,
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.08)';
        (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 6px 20px rgba(0,0,0,0.32)';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)';
        (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 16px rgba(0,0,0,0.25)';
      }}
    >
      {mode === 'closed' ? (
        // Chat bubble icon
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      ) : (
        // Chevron down (minimize)
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="18 15 12 21 6 15" />
        </svg>
      )}
    </button>
  );

  // ── Chat panel ──────────────────────────────────────────────────────────────

  const chatPanel = mode !== 'closed' && (
    <>
      {/* Backdrop for fullscreen */}
      {mode === 'fullscreen' && (
        <div
          onClick={() => setMode('open')}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            zIndex: 9998,
          }}
        />
      )}

      <div
        style={{
          ...panelStyle,
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--color-surface, #fff)',
          border: '1px solid var(--color-border, #e2e8f0)',
          borderRadius: mode === 'fullscreen' ? 16 : 14,
          boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
          overflow: 'hidden',
        }}
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            background: 'var(--color-primary, #2563eb)',
            color: '#fff',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: 'rgba(255,255,255,0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 16,
              }}
            >
              ✨
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.2 }}>HRConnect AI</div>
              <div style={{ fontSize: 11, opacity: 0.8 }}>Powered by Gemini</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {/* Clear chat */}
            {messages.length > 0 && (
              <button
                onClick={clearChat}
                title="Clear conversation"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#fff',
                  cursor: 'pointer',
                  opacity: 0.7,
                  padding: '4px 6px',
                  borderRadius: 6,
                  display: 'flex',
                  alignItems: 'center',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.15)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.7'; (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14H6L5 6" />
                  <path d="M10 11v6M14 11v6" />
                  <path d="M9 6V4h6v2" />
                </svg>
              </button>
            )}
            {/* Expand / compress */}
            <button
              onClick={() => setMode(m => (m === 'fullscreen' ? 'open' : 'fullscreen'))}
              title={mode === 'fullscreen' ? 'Compress' : 'Expand to fullscreen'}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#fff',
                cursor: 'pointer',
                opacity: 0.7,
                padding: '4px 6px',
                borderRadius: 6,
                display: 'flex',
                alignItems: 'center',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.15)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.7'; (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
            >
              {mode === 'fullscreen' ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" />
                  <line x1="10" y1="14" x2="3" y2="21" /><line x1="21" y1="3" x2="14" y2="10" />
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
                  <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
                </svg>
              )}
            </button>
            {/* Close */}
            <button
              onClick={() => setMode('closed')}
              title="Close"
              style={{
                background: 'transparent',
                border: 'none',
                color: '#fff',
                cursor: 'pointer',
                opacity: 0.7,
                padding: '4px 6px',
                borderRadius: 6,
                display: 'flex',
                alignItems: 'center',
                fontSize: 16,
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.15)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.7'; (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* ── Messages ────────────────────────────────────────────────────── */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '16px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          {messages.length === 0 && (
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                padding: '20px 16px',
                gap: 12,
                color: 'var(--color-text-muted, #94a3b8)',
              }}
            >
              <div style={{ fontSize: 36 }}>✨</div>
              <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--color-text-secondary, #64748b)' }}>
                Ask me anything about HR
              </div>
              <div style={{ fontSize: 12, lineHeight: 1.6, maxWidth: 260 }}>
                Payroll computations, leave policies, statutory deductions, compliance — I can help with it all.
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8, width: '100%', maxWidth: 300 }}>
                {[
                  'How is 13th month pay computed?',
                  'What are the SSS contribution rates?',
                  'How many days of sick leave are required by law?',
                ].map(prompt => (
                  <button
                    key={prompt}
                    onClick={() => {
                      setInput(prompt);
                      setTimeout(() => inputRef.current?.focus(), 50);
                    }}
                    style={{
                      background: 'var(--color-surface-2, #f8fafc)',
                      border: '1px solid var(--color-border, #e2e8f0)',
                      borderRadius: 8,
                      padding: '7px 12px',
                      fontSize: 12,
                      color: 'var(--color-text-secondary, #64748b)',
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-surface-hover, #f1f5f9)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-surface-2, #f8fafc)'; }}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map(msg => (
            <div
              key={msg.id}
              style={{
                display: 'flex',
                justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
              }}
            >
              <div
                style={{
                  maxWidth: '82%',
                  padding: '9px 13px',
                  borderRadius: msg.role === 'user' ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                  background:
                    msg.role === 'user'
                      ? 'var(--color-primary, #2563eb)'
                      : 'var(--color-surface-2, #f1f5f9)',
                  color:
                    msg.role === 'user'
                      ? '#fff'
                      : 'var(--color-text-primary, #1e293b)',
                  fontSize: 13,
                  lineHeight: 1.6,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                  wordBreak: 'break-word',
                }}
              >
                {renderContent(msg.content)}
              </div>
            </div>
          ))}

          {loading && (
            <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: '14px 14px 14px 4px',
                  background: 'var(--color-surface-2, #f1f5f9)',
                  display: 'flex',
                  gap: 4,
                  alignItems: 'center',
                }}
              >
                {[0, 1, 2].map(i => (
                  <div
                    key={i}
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      background: 'var(--color-text-muted, #94a3b8)',
                      animation: `chatBubblePulse 1.2s ease-in-out ${i * 0.2}s infinite`,
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* ── Input ───────────────────────────────────────────────────────── */}
        <div
          style={{
            padding: '10px 12px',
            borderTop: '1px solid var(--color-border, #e2e8f0)',
            background: 'var(--color-surface, #fff)',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'flex-end',
              background: 'var(--color-surface-2, #f8fafc)',
              border: '1px solid var(--color-border, #e2e8f0)',
              borderRadius: 10,
              padding: '6px 6px 6px 12px',
              transition: 'border-color 0.15s',
            }}
            onFocusCapture={e => {
              (e.currentTarget as HTMLDivElement).style.borderColor =
                'var(--color-primary, #2563eb)';
            }}
            onBlurCapture={e => {
              (e.currentTarget as HTMLDivElement).style.borderColor =
                'var(--color-border, #e2e8f0)';
            }}
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask HRConnect AI…"
              rows={1}
              style={{
                flex: 1,
                border: 'none',
                background: 'transparent',
                resize: 'none',
                outline: 'none',
                fontSize: 13,
                lineHeight: 1.5,
                color: 'var(--color-text-primary, #1e293b)',
                maxHeight: 120,
                overflowY: 'auto',
                fontFamily: 'inherit',
                paddingTop: 3,
              }}
              onInput={e => {
                const ta = e.target as HTMLTextAreaElement;
                ta.style.height = 'auto';
                ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
              }}
            />
            <button
              onClick={sendMessage}
              disabled={loading || !input.trim()}
              title="Send (Enter)"
              style={{
                width: 34,
                height: 34,
                borderRadius: 8,
                border: 'none',
                background:
                  loading || !input.trim()
                    ? 'var(--color-border, #e2e8f0)'
                    : 'var(--color-primary, #2563eb)',
                color:
                  loading || !input.trim()
                    ? 'var(--color-text-muted, #94a3b8)'
                    : '#fff',
                cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                transition: 'background 0.15s',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
          <div style={{ fontSize: 10, color: 'var(--color-text-muted, #94a3b8)', textAlign: 'center', marginTop: 6 }}>
            Press Enter to send · Shift+Enter for new line
          </div>
        </div>
      </div>

      {/* Pulse animation keyframes */}
      <style>{`
        @keyframes chatBubblePulse {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
          40% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </>
  );

  return (
    <>
      {bubbleButton}
      {chatPanel}
    </>
  );
}
