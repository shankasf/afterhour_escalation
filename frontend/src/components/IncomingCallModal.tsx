import { useEffect, useRef } from 'react';
import {
  PhoneIncoming,
  PhoneOff,
  Clock,
  CheckCircle2,
  XCircle,
  MapPin,
} from 'lucide-react';
import { useCallActions, useCallState, CallSeverity } from '../contexts/CallContext';
import { useWebRTC } from '../hooks/useWebRTC';
import api from '../lib/api';

const severityStyles: Record<CallSeverity, { bg: string; text: string; label: string }> = {
  critical: { bg: 'bg-red-600', text: 'text-white', label: 'CRITICAL' },
  high: { bg: 'bg-orange-500', text: 'text-white', label: 'HIGH' },
  medium: { bg: 'bg-yellow-500', text: 'text-gray-900', label: 'MEDIUM' },
  low: { bg: 'bg-gray-500', text: 'text-white', label: 'LOW' },
};

function useRingTone(active: boolean) {
  const ctxRef = useRef<AudioContext | null>(null);
  const oscRef = useRef<OscillatorNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) return;

    const AudioCtx =
      window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    ctxRef.current = ctx;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(ctx.destination);
    gainRef.current = gain;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 480;
    osc.connect(gain);
    osc.start();
    oscRef.current = osc;

    let on = false;
    intervalRef.current = window.setInterval(() => {
      on = !on;
      gain.gain.setTargetAtTime(on ? 0.15 : 0, ctx.currentTime, 0.02);
    }, 600);

    return () => {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      try {
        osc.stop();
      } catch {}
      try {
        ctx.close();
      } catch {}
      oscRef.current = null;
      gainRef.current = null;
      ctxRef.current = null;
    };
  }, [active]);
}

export default function IncomingCallModal() {
  const { incoming, active, callerInfo, transcript } = useCallState();
  const { accept, decline, defer, hangup } = useCallActions();
  const { remoteAudioRef } = useWebRTC();
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  useRingTone(!!incoming && !active);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript.length]);

  if (!incoming && !active) return null;

  const eventId = (active?.eventId ?? incoming?.eventId) as string;
  const severity: CallSeverity = (callerInfo?.severity as CallSeverity) || 'medium';
  const sevStyle = severityStyles[severity];

  const handleResolve = async () => {
    try {
      await api.patch(`/events/${eventId}`, { status: 'RESOLVED' });
    } catch {}
    await hangup();
  };

  const handleCancelOwnership = async () => {
    try {
      await api.post(`/escalation/${eventId}/cancel-ownership`).catch(() => {});
    } catch {}
    await hangup();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={active ? 'Active call' : 'Incoming call'}
      className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/90 backdrop-blur-sm p-4"
    >
      <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />

      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className={`px-6 py-4 ${sevStyle.bg} ${sevStyle.text} flex items-center justify-between`}>
          <div className="flex items-center gap-3">
            {active ? (
              <PhoneIncoming className="w-6 h-6" />
            ) : (
              <PhoneIncoming className="w-6 h-6 animate-pulse" />
            )}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide opacity-90">
                {active ? 'On call' : 'Incoming call'}
              </p>
              <p className="text-lg font-semibold leading-tight">
                {callerInfo?.name || callerInfo?.phone || 'Unknown caller'}
              </p>
            </div>
          </div>
          <span className="px-3 py-1 rounded-full bg-white/20 text-xs font-bold uppercase tracking-wide">
            {sevStyle.label}
          </span>
        </div>

        <div className="px-6 py-5 border-b border-gray-100">
          <p className="text-sm text-gray-500 uppercase tracking-wide font-medium mb-1">
            Issue
          </p>
          <p className="text-base text-gray-900">
            {callerInfo?.summary || 'No summary available'}
          </p>
          {callerInfo?.location && (
            <div className="flex items-center gap-2 mt-3 text-sm text-gray-600">
              <MapPin className="w-4 h-4" />
              <span>{callerInfo.location}</span>
            </div>
          )}
        </div>

        {!active && incoming && (
          <div className="px-6 py-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <button
              onClick={() => accept(incoming.eventId)}
              className="flex flex-col items-center justify-center gap-2 px-4 py-5 bg-green-600 hover:bg-green-700 active:scale-[0.98] text-white rounded-xl font-semibold transition-all focus:outline-none focus:ring-4 focus:ring-green-300"
            >
              <PhoneIncoming className="w-6 h-6" />
              <span>Accept</span>
            </button>
            <button
              onClick={() => decline(incoming.eventId)}
              className="flex flex-col items-center justify-center gap-2 px-4 py-5 bg-red-600 hover:bg-red-700 active:scale-[0.98] text-white rounded-xl font-semibold transition-all focus:outline-none focus:ring-4 focus:ring-red-300"
            >
              <XCircle className="w-6 h-6" />
              <span>Decline</span>
            </button>
            <button
              onClick={() => defer(incoming.eventId, 5)}
              className="flex flex-col items-center justify-center gap-2 px-4 py-5 bg-yellow-500 hover:bg-yellow-600 active:scale-[0.98] text-gray-900 rounded-xl font-semibold transition-all focus:outline-none focus:ring-4 focus:ring-yellow-200"
            >
              <Clock className="w-6 h-6" />
              <span>Defer 5min</span>
            </button>
          </div>
        )}

        {active && (
          <>
            <div className="px-6 py-4">
              <p className="text-sm text-gray-500 uppercase tracking-wide font-medium mb-2">
                Live transcript
              </p>
              <div className="h-56 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2">
                {transcript.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-6">
                    Waiting for transcript...
                  </p>
                ) : (
                  transcript.map((line) => (
                    <div
                      key={line.id}
                      className={`text-sm ${
                        line.role === 'customer'
                          ? 'text-gray-900'
                          : line.role === 'employee'
                          ? 'text-primary-700'
                          : 'text-gray-500 italic'
                      }`}
                    >
                      <span className="font-semibold mr-2 capitalize">
                        {line.role}:
                      </span>
                      <span>{line.text}</span>
                    </div>
                  ))
                )}
                <div ref={transcriptEndRef} />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <button
                onClick={() => hangup()}
                className="flex items-center justify-center gap-2 px-4 py-3 bg-red-600 hover:bg-red-700 active:scale-[0.98] text-white rounded-lg font-medium transition-all focus:outline-none focus:ring-4 focus:ring-red-300"
              >
                <PhoneOff className="w-5 h-5" />
                Hang up
              </button>
              <button
                onClick={handleResolve}
                className="flex items-center justify-center gap-2 px-4 py-3 bg-green-600 hover:bg-green-700 active:scale-[0.98] text-white rounded-lg font-medium transition-all focus:outline-none focus:ring-4 focus:ring-green-300"
              >
                <CheckCircle2 className="w-5 h-5" />
                Resolve
              </button>
              <button
                onClick={handleCancelOwnership}
                className="flex items-center justify-center gap-2 px-4 py-3 bg-gray-200 hover:bg-gray-300 active:scale-[0.98] text-gray-800 rounded-lg font-medium transition-all focus:outline-none focus:ring-4 focus:ring-gray-200"
              >
                Cancel ownership
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
