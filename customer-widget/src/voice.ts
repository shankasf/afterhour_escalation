import type { WidgetConfig } from './types';
import type { ChatTransport } from './transport';
import { getCorrelationId, logger } from './logger';

type VoiceEventMap = {
  voice_active: void;
  voice_inactive: void;
  audio_level: number;
  error: Error;
};

type VoiceEventName = keyof VoiceEventMap;
type VoiceListener<K extends VoiceEventName> = (data: VoiceEventMap[K]) => void;

export class VoiceClient {
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private analyser: AnalyserNode | null = null;
  private audioCtx: AudioContext | null = null;
  private rafId: number | null = null;
  private listeners: { [K in VoiceEventName]?: Set<VoiceListener<K>> } = {};
  private webrtcOfferUrl: string;
  private stunUrls: string[];
  private transport: ChatTransport;
  private active = false;

  constructor(transport: ChatTransport, config: WidgetConfig = {}) {
    this.transport = transport;
    this.webrtcOfferUrl = config.webrtcOfferUrl ?? 'https://ai.amsterdamhostel.cloud/webrtc/customer/offer';
    this.stunUrls = config.stunUrls ?? ['stun:turn.amsterdamhostel.cloud:3478'];
  }

  on<K extends VoiceEventName>(name: K, listener: VoiceListener<K>): () => void {
    if (!this.listeners[name]) this.listeners[name] = new Set();
    (this.listeners[name] as Set<VoiceListener<K>>).add(listener);
    return () => (this.listeners[name] as Set<VoiceListener<K>>).delete(listener);
  }

  isActive(): boolean {
    return this.active;
  }

  async start(): Promise<void> {
    if (this.active) return;
    const token = this.transport.getSessionToken();
    if (!token) throw new Error('Chat session not started');
    logger.info('voice.start.request');

    this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.pc = new RTCPeerConnection({ iceServers: [{ urls: this.stunUrls }] });

    this.localStream.getAudioTracks().forEach((track) => this.pc!.addTrack(track, this.localStream!));

    this.remoteStream = new MediaStream();
    this.pc.addEventListener('track', (ev) => {
      ev.streams[0].getTracks().forEach((t) => this.remoteStream!.addTrack(t));
      if (this.audioEl) this.audioEl.srcObject = this.remoteStream;
    });

    this.pc.addEventListener('icecandidate', (ev) => {
      if (ev.candidate) this.transport.sendIce(ev.candidate);
    });

    this.audioEl = document.createElement('audio');
    this.audioEl.autoplay = true;
    this.audioEl.style.display = 'none';
    document.body.appendChild(this.audioEl);

    const offer = await this.pc.createOffer({ offerToReceiveAudio: true });
    await this.pc.setLocalDescription(offer);

    const res = await fetch(this.webrtcOfferUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-correlation-id': getCorrelationId(),
      },
      body: JSON.stringify({ session_token: token, sdp: offer.sdp }),
    });
    if (!res.ok) {
      logger.error('voice.offer.failed', { status: res.status });
      throw new Error(`WebRTC offer failed: ${res.status}`);
    }
    const answer = (await res.json()) as { sdp: string };
    await this.pc.setRemoteDescription({ type: 'answer', sdp: answer.sdp });

    this.startAudioLevel();
    this.active = true;
    logger.info('voice.active');
    this.emit('voice_active', undefined);
  }

  stop(): void {
    if (!this.active && !this.pc) return;
    this.active = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
    this.analyser = null;
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    if (this.audioEl) {
      this.audioEl.srcObject = null;
      this.audioEl.remove();
      this.audioEl = null;
    }
    this.remoteStream = null;
    logger.info('voice.inactive');
    this.emit('voice_inactive', undefined);
  }

  private startAudioLevel(): void {
    if (!this.localStream) return;
    try {
      this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const src = this.audioCtx.createMediaStreamSource(this.localStream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 256;
      src.connect(this.analyser);
      const data = new Uint8Array(this.analyser.frequencyBinCount);
      const tick = () => {
        if (!this.analyser) return;
        this.analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        this.emit('audio_level', Math.min(1, rms * 4));
        this.rafId = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      /* audio level optional */
    }
  }

  private emit<K extends VoiceEventName>(name: K, data: VoiceEventMap[K]): void {
    const set = this.listeners[name] as Set<VoiceListener<K>> | undefined;
    if (!set) return;
    set.forEach((l) => {
      try {
        l(data);
      } catch {
        /* ignore */
      }
    });
  }
}
