export type MessageRole = 'customer' | 'agent' | 'employee' | 'system';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  text: string;
  voice?: { durationMs: number };
  authorName?: string;
  authorBadge?: string;
  createdAt: number;
}

export interface StartParams {
  name?: string;
  email?: string;
  phone?: string;
}

export interface StartResponse {
  sessionToken: string;
}

export type TransportEvent =
  | { type: 'agent_message'; payload: { id: string; text: string; voice?: { durationMs: number } } }
  | { type: 'employee_message'; payload: { id: string; text: string; authorName: string; authorBadge?: string } }
  | { type: 'status_update'; payload: { typing?: boolean; status?: string } }
  | { type: 'voice_started'; payload: {} }
  | { type: 'voice_ended'; payload: {} }
  | { type: 'connected'; payload: {} }
  | { type: 'disconnected'; payload: {} };

export type TransportListener = (event: TransportEvent) => void;

export interface WidgetConfig {
  apiBaseUrl?: string;
  wsUrl?: string;
  webrtcOfferUrl?: string;
  stunUrls?: string[];
  rootSelector?: string;
}

declare global {
  interface Window {
    AHChat?: {
      mount: (config?: WidgetConfig) => void;
      unmount: () => void;
    };
  }
}
