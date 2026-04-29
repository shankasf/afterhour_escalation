import { useEffect, useRef, useState } from 'react';
import api, { AI_SERVICE_URL } from '../lib/api';
import { useCallActions, useCallState } from '../contexts/CallContext';
import { useSignalingSocket } from './useSignalingSocket';
import { useAuth } from '../contexts/AuthContext';
import { logger, getCorrelationId } from '../utils/logger';

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:turn.amsterdamhostel.cloud:3478' },
];

async function fetchTurnCredentials(): Promise<RTCIceServer[]> {
  try {
    const res = await api.get('/webrtc/turn-credentials');
    if (Array.isArray(res.data?.iceServers) && res.data.iceServers.length > 0) {
      return res.data.iceServers;
    }
  } catch {
    // TURN server not deployed yet — fall back to STUN stub
  }
  return DEFAULT_ICE_SERVERS;
}

export function useWebRTC() {
  const { user } = useAuth();
  const { setActive, setIncoming, registerHandlers, clearTranscript } =
    useCallActions();
  const { incoming } = useCallState();
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const currentEventIdRef = useRef<string | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  const { send } = useSignalingSocket({
    onAnswer: async (_eventId, sdp) => {
      const pc = pcRef.current;
      if (!pc) return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      } catch (err) {
        logger.error('Failed to set remote description', { error: String((err as Error)?.message ?? err) });
      }
    },
    onIceCandidate: async (_eventId, candidate) => {
      const pc = pcRef.current;
      if (!pc || !candidate) return;
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        logger.warn('Failed to add ICE candidate', { error: String((err as Error)?.message ?? err) });
      }
    },
    onCallEnded: () => {
      cleanup();
    },
  });

  const cleanup = () => {
    if (pcRef.current) {
      pcRef.current.onicecandidate = null;
      pcRef.current.ontrack = null;
      pcRef.current.close();
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    setRemoteStream(null);
    currentEventIdRef.current = null;
    setActive(null);
    clearTranscript();
  };

  const accept = async (eventId: string) => {
    const incomingInfo = incoming?.eventId === eventId ? incoming : null;
    const callerInfo = incomingInfo?.callerInfo ?? {};
    setIncoming(null);
    currentEventIdRef.current = eventId;

    const iceServers = await fetchTurnCredentials();
    const pc = new RTCPeerConnection({ iceServers });
    pcRef.current = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        send({
          type: 'ice_candidate',
          eventId,
          candidate: event.candidate.toJSON(),
        });
      }
    };

    pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (stream) {
        setRemoteStream(stream);
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = stream;
          remoteAudioRef.current.play().catch(() => {});
        }
      }
    };

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      logger.error('getUserMedia failed', { error: String((err as Error)?.message ?? err) });
      cleanup();
      throw err;
    }
    localStreamRef.current = stream;
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    const offer = await pc.createOffer({ offerToReceiveAudio: true });
    await pc.setLocalDescription(offer);

    try {
      const res = await fetch(`${AI_SERVICE_URL}/webrtc/employee/offer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token') ?? ''}`,
          'x-correlation-id': getCorrelationId(),
        },
        body: JSON.stringify({
          user_id: user?.id,
          event_id: eventId,
          sdp: offer,
        }),
      });
      if (!res.ok) throw new Error(`AI offer failed: ${res.status}`);
      const data = await res.json();
      if (data?.sdp) {
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      }
    } catch (err) {
      logger.error('WebRTC offer failed', { error: String((err as Error)?.message ?? err), eventId });
      cleanup();
      throw err;
    }

    setActive({
      eventId,
      callerInfo,
      startedAt: Date.now(),
    });
  };

  const decline = async (eventId: string) => {
    send({ type: 'call_decline', eventId });
    try {
      await api.post(`/escalation/${eventId}/decline`).catch(() => {});
    } catch {}
  };

  const defer = async (eventId: string, minutes = 5) => {
    send({ type: 'call_defer', eventId, minutes });
    try {
      await api.post(`/escalation/${eventId}/defer`, { minutes }).catch(() => {});
    } catch {}
  };

  const hangup = async () => {
    const eventId = currentEventIdRef.current;
    if (eventId) {
      send({ type: 'call_hangup', eventId });
      try {
        await api.post(`/escalation/${eventId}/hangup`).catch(() => {});
      } catch {}
    }
    cleanup();
  };

  useEffect(() => {
    registerHandlers({
      onAccept: accept,
      onDecline: decline,
      onDefer: defer,
      onHangup: hangup,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => cleanup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { remoteStream, remoteAudioRef };
}
