import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from '../contexts/AuthContext';
import { useCallActions } from '../contexts/CallContext';
import { API_BASE_URL } from '../lib/api';

export interface SignalingHandlers {
  onAnswer?: (eventId: string, sdp: any) => void;
  onIceCandidate?: (eventId: string, candidate: any) => void;
  onCallEnded?: (eventId: string) => void;
}

type OutboundType =
  | 'webrtc_offer'
  | 'webrtc_answer'
  | 'ice_candidate'
  | 'call_accepted'
  | 'call_declined'
  | 'call_decline'
  | 'call_defer'
  | 'call_hangup';

interface OutboundMessage {
  type: OutboundType;
  eventId?: string;
  sdp?: any;
  candidate?: any;
  minutes?: number;
}

const eventNameMap: Record<OutboundType, string> = {
  webrtc_offer: 'webrtc_offer',
  webrtc_answer: 'webrtc_answer',
  ice_candidate: 'ice_candidate',
  call_accepted: 'call_accepted',
  call_declined: 'call_declined',
  call_decline: 'call_declined',
  call_defer: 'call_defer',
  call_hangup: 'call_hangup',
};

export function useSignalingSocket(handlers?: SignalingHandlers) {
  const { user } = useAuth();
  const { setIncoming, appendTranscript, setActive } = useCallActions();
  const socketRef = useRef<Socket | null>(null);
  const handlersRef = useRef(handlers);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    if (!user) return;
    const token = localStorage.getItem('token');
    if (!token) return;

    const socket = io(`${API_BASE_URL}/signaling`, {
      auth: { token },
      transports: ['websocket', 'polling'],
      withCredentials: true,
      reconnection: true,
      reconnectionDelay: 2000,
    });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));

    socket.on(
      'incoming_call',
      (payload: { event_id?: string; eventId?: string; callerInfo?: any; script?: string }) => {
        const eventId = payload.eventId ?? payload.event_id;
        if (!eventId) return;
        setIncoming({
          eventId,
          callerInfo: payload.callerInfo ?? {},
          receivedAt: Date.now(),
        });
      },
    );

    socket.on(
      'webrtc_answer',
      (payload: { eventId?: string; event_id?: string; sdp: any }) => {
        const eventId = payload.eventId ?? payload.event_id ?? '';
        handlersRef.current?.onAnswer?.(eventId, payload.sdp);
      },
    );

    socket.on(
      'ice_candidate',
      (payload: { eventId?: string; event_id?: string; candidate: any }) => {
        const eventId = payload.eventId ?? payload.event_id ?? '';
        handlersRef.current?.onIceCandidate?.(eventId, payload.candidate);
      },
    );

    socket.on(
      'call_ended',
      (payload: { eventId?: string; event_id?: string }) => {
        const eventId = payload.eventId ?? payload.event_id ?? '';
        handlersRef.current?.onCallEnded?.(eventId);
        setActive(null);
      },
    );

    socket.on(
      'transcript',
      (payload: {
        eventId?: string;
        event_id?: string;
        role: 'customer' | 'employee' | 'system';
        text: string;
      }) => {
        const eventId = payload.eventId ?? payload.event_id ?? 'unknown';
        appendTranscript({
          id: `${eventId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          role: payload.role,
          text: payload.text,
          ts: Date.now(),
        });
      },
    );

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [user, setIncoming, appendTranscript, setActive]);

  const send = (msg: OutboundMessage) => {
    const socket = socketRef.current;
    if (!socket || !socket.connected) return;
    const eventName = eventNameMap[msg.type];
    if (!eventName) return;

    const payload: Record<string, unknown> = {};
    if (msg.eventId !== undefined) payload.event_id = msg.eventId;
    if (msg.sdp !== undefined) payload.sdp = msg.sdp;
    if (msg.candidate !== undefined) payload.candidate = msg.candidate;
    if (msg.type === 'call_defer' && msg.minutes !== undefined) {
      payload.defer_minutes = msg.minutes;
    }

    socket.emit(eventName, payload);
  };

  return { connected, send };
}
