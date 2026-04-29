import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useCallActions } from '../contexts/CallContext';
import { SIGNALING_WS_URL } from '../lib/api';

type SignalingMessage =
  | { type: 'incoming_call'; eventId: string; callerInfo: any }
  | { type: 'webrtc_answer'; eventId: string; sdp: any }
  | { type: 'ice_candidate'; eventId: string; candidate: any }
  | { type: 'call_ended'; eventId: string }
  | { type: 'transcript'; eventId: string; role: 'customer' | 'employee' | 'system'; text: string };

export interface SignalingHandlers {
  onAnswer?: (eventId: string, sdp: any) => void;
  onIceCandidate?: (eventId: string, candidate: any) => void;
  onCallEnded?: (eventId: string) => void;
}

export function useSignalingSocket(handlers?: SignalingHandlers) {
  const { user } = useAuth();
  const { setIncoming, appendTranscript, setActive } = useCallActions();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const handlersRef = useRef(handlers);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    if (!user) return;
    const token = localStorage.getItem('token');
    if (!token) return;

    let stopped = false;

    const connect = () => {
      if (stopped) return;
      const url = `${SIGNALING_WS_URL}?token=${encodeURIComponent(token)}`;
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch {
        scheduleReconnect();
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        scheduleReconnect();
      };
      ws.onerror = () => {
        ws.close();
      };
      ws.onmessage = (ev) => {
        let msg: SignalingMessage | null = null;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (!msg) return;

        switch (msg.type) {
          case 'incoming_call':
            setIncoming({
              eventId: msg.eventId,
              callerInfo: msg.callerInfo || {},
              receivedAt: Date.now(),
            });
            break;
          case 'webrtc_answer':
            handlersRef.current?.onAnswer?.(msg.eventId, msg.sdp);
            break;
          case 'ice_candidate':
            handlersRef.current?.onIceCandidate?.(msg.eventId, msg.candidate);
            break;
          case 'call_ended':
            handlersRef.current?.onCallEnded?.(msg.eventId);
            setActive(null);
            break;
          case 'transcript':
            appendTranscript({
              id: `${msg.eventId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              role: msg.role,
              text: msg.text,
              ts: Date.now(),
            });
            break;
        }
      };
    };

    const scheduleReconnect = () => {
      if (stopped) return;
      if (reconnectTimerRef.current) return;
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        connect();
      }, 2000);
    };

    connect();

    return () => {
      stopped = true;
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
      setConnected(false);
    };
  }, [user, setIncoming, appendTranscript, setActive]);

  const send = (msg: any) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  };

  return { connected, send };
}
