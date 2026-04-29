import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  ReactNode,
} from 'react';

export type CallSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface CallerInfo {
  name?: string;
  phone?: string;
  email?: string;
  location?: string;
  summary?: string;
  severity?: CallSeverity;
}

export interface TranscriptLine {
  id: string;
  role: 'customer' | 'employee' | 'system';
  text: string;
  ts: number;
}

export interface IncomingCall {
  eventId: string;
  callerInfo: CallerInfo;
  receivedAt: number;
}

export interface ActiveCall {
  eventId: string;
  callerInfo: CallerInfo;
  startedAt: number;
}

interface CallState {
  incoming: IncomingCall | null;
  active: ActiveCall | null;
  callerInfo: CallerInfo | null;
  eventId: string | null;
  transcript: TranscriptLine[];
}

interface CallActions {
  setIncoming: (c: IncomingCall | null) => void;
  setActive: (c: ActiveCall | null) => void;
  appendTranscript: (line: TranscriptLine) => void;
  clearTranscript: () => void;
  registerHandlers: (h: CallHandlers) => void;
  accept: (eventId: string) => Promise<void>;
  decline: (eventId: string) => Promise<void>;
  defer: (eventId: string, minutes?: number) => Promise<void>;
  hangup: () => Promise<void>;
}

export interface CallHandlers {
  onAccept?: (eventId: string) => Promise<void> | void;
  onDecline?: (eventId: string) => Promise<void> | void;
  onDefer?: (eventId: string, minutes: number) => Promise<void> | void;
  onHangup?: () => Promise<void> | void;
}

const CallStateContext = createContext<CallState | undefined>(undefined);
const CallActionsContext = createContext<CallActions | undefined>(undefined);

export function CallProvider({ children }: { children: ReactNode }) {
  const [incoming, setIncoming] = useState<IncomingCall | null>(null);
  const [active, setActive] = useState<ActiveCall | null>(null);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const handlersRef = useRef<CallHandlers>({});

  const appendTranscript = useCallback((line: TranscriptLine) => {
    setTranscript((prev) => [...prev, line]);
  }, []);

  const clearTranscript = useCallback(() => setTranscript([]), []);

  const registerHandlers = useCallback((h: CallHandlers) => {
    handlersRef.current = { ...handlersRef.current, ...h };
  }, []);

  const accept = useCallback(
    async (eventId: string) => {
      await handlersRef.current.onAccept?.(eventId);
    },
    []
  );

  const decline = useCallback(
    async (eventId: string) => {
      await handlersRef.current.onDecline?.(eventId);
      setIncoming(null);
    },
    []
  );

  const defer = useCallback(
    async (eventId: string, minutes = 5) => {
      await handlersRef.current.onDefer?.(eventId, minutes);
      setIncoming(null);
    },
    []
  );

  const hangup = useCallback(async () => {
    await handlersRef.current.onHangup?.();
    setActive(null);
    setIncoming(null);
    clearTranscript();
  }, [clearTranscript]);

  const callerInfo = active?.callerInfo ?? incoming?.callerInfo ?? null;
  const eventId = active?.eventId ?? incoming?.eventId ?? null;

  const stateValue = useMemo<CallState>(
    () => ({ incoming, active, callerInfo, eventId, transcript }),
    [incoming, active, callerInfo, eventId, transcript]
  );

  const actionsValue = useMemo<CallActions>(
    () => ({
      setIncoming,
      setActive,
      appendTranscript,
      clearTranscript,
      registerHandlers,
      accept,
      decline,
      defer,
      hangup,
    }),
    [
      appendTranscript,
      clearTranscript,
      registerHandlers,
      accept,
      decline,
      defer,
      hangup,
    ]
  );

  return (
    <CallStateContext.Provider value={stateValue}>
      <CallActionsContext.Provider value={actionsValue}>
        {children}
      </CallActionsContext.Provider>
    </CallStateContext.Provider>
  );
}

export function useCallState(): CallState {
  const ctx = useContext(CallStateContext);
  if (!ctx) throw new Error('useCallState must be used within CallProvider');
  return ctx;
}

export function useCallActions(): CallActions {
  const ctx = useContext(CallActionsContext);
  if (!ctx) throw new Error('useCallActions must be used within CallProvider');
  return ctx;
}
