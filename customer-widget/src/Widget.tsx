import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChatTransport } from './transport';
import { VoiceClient } from './voice';
import { logger } from './logger';
import type { ChatMessage, WidgetConfig } from './types';
import './style.css';

const INITIAL_MESSAGE: ChatMessage = {
  id: 'init-greeting',
  role: 'agent',
  text: "Hi! How can we help? If this is an after-hours emergency, share details and we'll get our on-call team on it right away.",
  createdAt: Date.now(),
};

const DISCLAIMER_KEY = 'ah_chat_voice_ack';

function formatDuration(ms: number): string {
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function ChatIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

function VoicePillIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z" />
      <path d="M19 11a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.92V20H8a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2h-3v-2.08A7 7 0 0 0 19 11z" />
    </svg>
  );
}

interface MessageRowProps {
  msg: ChatMessage;
  expanded: boolean;
  onToggle: () => void;
}

function MessageRow({ msg, expanded, onToggle }: MessageRowProps) {
  const rowClass = `ah-row ah-row-${msg.role}`;

  return (
    <div className={rowClass}>
      {msg.role === 'employee' && (
        <div className="ah-author">
          <span className="ah-badge-employee">{msg.authorName ?? 'Employee'}{msg.authorBadge ? ` (${msg.authorBadge})` : ' (on-call)'}</span>
        </div>
      )}
      {msg.voice ? (
        <div className="ah-bubble-msg" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <button
            type="button"
            className="ah-voice-pill"
            onClick={onToggle}
            aria-expanded={expanded}
          >
            <VoicePillIcon />
            <span>Voice — {formatDuration(msg.voice.durationMs)}</span>
          </button>
          {expanded && msg.text && <div className="ah-voice-transcript">{msg.text}</div>}
        </div>
      ) : (
        <div className="ah-bubble-msg">{msg.text}</div>
      )}
    </div>
  );
}

export interface WidgetProps {
  config?: WidgetConfig;
}

export function Widget({ config = {} }: WidgetProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([INITIAL_MESSAGE]);
  const [draft, setDraft] = useState('');
  const [typing, setTyping] = useState(false);
  const [unread, setUnread] = useState(0);
  const [connected, setConnected] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [expandedVoice, setExpandedVoice] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const transportRef = useRef<ChatTransport | null>(null);
  const voiceRef = useRef<VoiceClient | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const transport = useMemo(() => {
    const t = new ChatTransport(config);
    transportRef.current = t;
    return t;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const voice = useMemo(() => {
    const v = new VoiceClient(transport, config);
    voiceRef.current = v;
    return v;
  }, [transport]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const off = transport.on((event) => {
      switch (event.type) {
        case 'connected':
          setConnected(true);
          break;
        case 'disconnected':
          setConnected(false);
          break;
        case 'agent_message': {
          const m: ChatMessage = {
            id: event.payload.id,
            role: 'agent',
            text: event.payload.text,
            voice: event.payload.voice,
            createdAt: Date.now(),
          };
          setMessages((prev) => [...prev, m]);
          setTyping(false);
          break;
        }
        case 'employee_message': {
          const m: ChatMessage = {
            id: event.payload.id,
            role: 'employee',
            text: event.payload.text,
            authorName: event.payload.authorName,
            authorBadge: event.payload.authorBadge ?? 'on-call',
            createdAt: Date.now(),
          };
          setMessages((prev) => [...prev, m]);
          setTyping(false);
          break;
        }
        case 'status_update':
          if (typeof event.payload.typing === 'boolean') setTyping(event.payload.typing);
          break;
        case 'voice_started':
          setVoiceActive(true);
          break;
        case 'voice_ended':
          setVoiceActive(false);
          break;
      }
    });
    return () => {
      off();
    };
  }, [transport]);

  useEffect(() => {
    const offActive = voice.on('voice_active', () => setVoiceActive(true));
    const offInactive = voice.on('voice_inactive', () => setVoiceActive(false));
    const offLevel = voice.on('audio_level', (lvl) => setAudioLevel(lvl));
    return () => {
      offActive();
      offInactive();
      offLevel();
    };
  }, [voice]);

  useEffect(() => {
    return () => {
      voiceRef.current?.stop();
      transportRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [messages, typing, open]);

  useEffect(() => {
    if (!open) {
      const newAgentMsgs = messages.filter((m) => m.role !== 'customer' && m.id !== INITIAL_MESSAGE.id).length;
      setUnread(newAgentMsgs);
    } else {
      setUnread(0);
    }
  }, [messages, open]);

  const ensureStarted = useCallback(async () => {
    try {
      await transport.start({});
    } catch (err) {
      setError('Could not connect. Please try again.');
      throw err;
    }
  }, [transport]);

  const handleOpen = useCallback(async () => {
    logger.info('ui.widget.open');
    setOpen(true);
    setError(null);
    if (!transport.getSessionToken() || !connected) {
      try {
        await ensureStarted();
      } catch {
        /* error state already set */
      }
    }
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [connected, ensureStarted, transport]);

  const handleClose = useCallback(() => {
    logger.info('ui.widget.close');
    setOpen(false);
  }, []);

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text) return;
    logger.info('ui.message.send');
    if (!transport.getSessionToken()) {
      try {
        await ensureStarted();
      } catch {
        return;
      }
    }
    const msg: ChatMessage = {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      role: 'customer',
      text,
      createdAt: Date.now(),
    };
    setMessages((prev) => [...prev, msg]);
    transport.sendText(text);
    setDraft('');
    setTyping(true);
  }, [draft, ensureStarted, transport]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend],
  );

  const startVoice = useCallback(async () => {
    setError(null);
    try {
      await ensureStarted();
      await voice.start();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start voice');
    }
  }, [ensureStarted, voice]);

  const handleMicClick = useCallback(async () => {
    if (voiceActive) {
      logger.info('ui.voice.stop_click');
      voice.stop();
      return;
    }
    logger.info('ui.voice.start_click');
    let acked = false;
    try {
      acked = localStorage.getItem(DISCLAIMER_KEY) === '1';
    } catch {
      /* ignore */
    }
    if (!acked) {
      setShowDisclaimer(true);
      return;
    }
    await startVoice();
  }, [voice, voiceActive, startVoice]);

  const acceptDisclaimer = useCallback(async () => {
    try {
      localStorage.setItem(DISCLAIMER_KEY, '1');
    } catch {
      /* ignore */
    }
    setShowDisclaimer(false);
    await startVoice();
  }, [startVoice]);

  const cancelDisclaimer = useCallback(() => {
    setShowDisclaimer(false);
  }, []);

  const toggleVoiceTranscript = useCallback((id: string) => {
    setExpandedVoice((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const ringScale = 1 + audioLevel * 0.6;
  const ringOpacity = 0.25 + audioLevel * 0.55;

  if (!open) {
    return (
      <div className="ah-widget" role="region" aria-label="Customer support chat">
        <button
          type="button"
          className="ah-bubble"
          onClick={handleOpen}
          aria-label={unread > 0 ? `Open chat (${unread} new messages)` : 'Open chat'}
        >
          <ChatIcon />
          {unread > 0 && <span className="ah-bubble-dot" aria-hidden="true" />}
        </button>
      </div>
    );
  }

  return (
    <div className="ah-widget" role="region" aria-label="Customer support chat">
      <div className="ah-panel" role="dialog" aria-modal="false" aria-label="Chat with us">
        <header className="ah-header">
          <div>
            <h2 className="ah-header-title">Chat with us</h2>
            <div className="ah-header-sub">{connected ? 'Online' : 'Connecting…'}</div>
          </div>
          <button type="button" className="ah-close" onClick={handleClose} aria-label="Close chat">
            <CloseIcon />
          </button>
        </header>

        {!connected && transport.getSessionToken() && (
          <div className="ah-conn-banner">Reconnecting…</div>
        )}

        <div className="ah-transcript" ref={transcriptRef} aria-live="polite">
          {messages.map((m) => (
            <MessageRow
              key={m.id}
              msg={m}
              expanded={expandedVoice.has(m.id)}
              onToggle={() => toggleVoiceTranscript(m.id)}
            />
          ))}
          {typing && (
            <div className="ah-typing" aria-label="Agent is typing">
              <span>Agent is typing</span>
              <span className="ah-typing-dots">
                <span />
                <span />
                <span />
              </span>
            </div>
          )}
          {error && (
            <div className="ah-row ah-row-agent">
              <div className="ah-bubble-msg" style={{ background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' }}>
                {error}
              </div>
            </div>
          )}
        </div>

        {voiceActive && (
          <div className="ah-voice-banner" role="status">
            <div className="ah-voice-status">
              <span className="ah-voice-pulse" aria-hidden="true" />
              <span>Voice call active</span>
            </div>
            <button type="button" className="ah-end-call" onClick={() => voice.stop()}>
              End call
            </button>
          </div>
        )}

        <div className="ah-composer">
          <div className="ah-composer-row">
            <textarea
              ref={inputRef}
              className="ah-input"
              placeholder="Type a message…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              aria-label="Message"
            />
            <button
              type="button"
              className={`ah-icon-btn ${voiceActive ? 'ah-mic-active' : ''}`}
              onClick={handleMicClick}
              aria-pressed={voiceActive}
              aria-label={voiceActive ? 'Stop voice' : 'Start voice'}
            >
              <MicIcon />
              {voiceActive && (
                <span
                  className="ah-mic-ring"
                  style={{ transform: `scale(${ringScale})`, opacity: ringOpacity }}
                />
              )}
            </button>
            <button
              type="button"
              className="ah-icon-btn ah-icon-btn-primary"
              onClick={() => void handleSend()}
              disabled={!draft.trim()}
              aria-label="Send message"
            >
              <SendIcon />
            </button>
          </div>
        </div>

        {showDisclaimer && (
          <div className="ah-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="ah-disc-title">
            <div className="ah-modal">
              <h3 className="ah-modal-title" id="ah-disc-title">Voice call disclosure</h3>
              <p className="ah-modal-body">
                Calls may be recorded for quality and training. Your microphone will only be active while the call is open.
              </p>
              <div className="ah-modal-actions">
                <button type="button" className="ah-btn ah-btn-ghost" onClick={cancelDisclaimer}>
                  Cancel
                </button>
                <button type="button" className="ah-btn ah-btn-primary" onClick={() => void acceptDisclaimer()}>
                  Continue
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
