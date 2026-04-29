import api from './api';
import { logger } from '../utils/logger';

// TODO: set VITE_VAPID_PUBLIC_KEY in .env
const VAPID_PUBLIC =
  (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ||
  'REPLACE_WITH_VAPID_PUBLIC_KEY';

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return buffer;
}

export async function ensureServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const existing = await navigator.serviceWorker.getRegistration('/');
    if (existing) return existing;
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch (err) {
    logger.error('Service worker registration failed', { error: String((err as Error)?.message ?? err) });
    return null;
  }
}

export async function getNotificationPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) return 'denied';
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) return 'denied';
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

export async function getCurrentSubscription(): Promise<PushSubscription | null> {
  const reg = await ensureServiceWorker();
  if (!reg) return null;
  return reg.pushManager.getSubscription();
}

export async function registerPushSubscription(): Promise<PushSubscription | null> {
  const reg = await ensureServiceWorker();
  if (!reg) return null;

  const permission = await requestNotificationPermission();
  if (permission !== 'granted') return null;

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    if (!VAPID_PUBLIC || VAPID_PUBLIC === 'REPLACE_WITH_VAPID_PUBLIC_KEY') {
      logger.warn('VITE_VAPID_PUBLIC_KEY not configured; cannot subscribe to push');
      return null;
    }
    try {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
      });
    } catch (err) {
      logger.error('pushManager.subscribe failed', { error: String((err as Error)?.message ?? err) });
      return null;
    }
  }

  try {
    await api.post('/push/subscribe', sub.toJSON());
  } catch (err) {
    logger.error('Failed to register subscription with backend', { error: String((err as Error)?.message ?? err) });
  }

  return sub;
}
