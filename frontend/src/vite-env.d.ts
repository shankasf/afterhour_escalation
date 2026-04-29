/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_AI_SERVICE_URL?: string;
  readonly VITE_SIGNALING_WS_URL?: string;
  readonly VITE_VAPID_PUBLIC_KEY?: string;
  readonly VITE_LOG_LEVEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
