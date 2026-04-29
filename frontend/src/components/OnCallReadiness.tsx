import { useEffect, useState } from 'react';
import {
  Bell,
  BellOff,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Smartphone,
} from 'lucide-react';
import {
  ensureServiceWorker,
  getCurrentSubscription,
  getNotificationPermission,
  registerPushSubscription,
  requestNotificationPermission,
} from '../lib/push-registration';

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent);
}

function isStandalonePWA(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return (
    ('standalone' in nav && nav.standalone === true) ||
    (typeof window !== 'undefined' &&
      window.matchMedia?.('(display-mode: standalone)').matches)
  );
}

export default function OnCallReadiness() {
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [swReady, setSwReady] = useState<boolean>(false);
  const [subscribed, setSubscribed] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);

  const refresh = async () => {
    setPermission(await getNotificationPermission());
    const reg = await ensureServiceWorker();
    setSwReady(!!reg);
    const sub = await getCurrentSubscription();
    setSubscribed(!!sub);
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleRequestPermission = async () => {
    setBusy(true);
    try {
      const result = await requestNotificationPermission();
      setPermission(result);
    } finally {
      setBusy(false);
    }
  };

  const handleSubscribe = async () => {
    setBusy(true);
    try {
      const sub = await registerPushSubscription();
      setSubscribed(!!sub);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const ios = isIOS();
  const standalone = isStandalonePWA();
  const showIosBanner = ios && !standalone;

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-4">
        <Bell className="w-5 h-5 text-gray-400" />
        <h2 className="text-lg font-semibold">On-Call Ready</h2>
      </div>

      {showIosBanner && (
        <div className="mb-4 flex items-start gap-3 p-3 rounded-lg bg-red-50 border border-red-200">
          <Smartphone className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-red-800">
            <p className="font-semibold mb-1">
              iOS users must Add to Home Screen for push to work
            </p>
            <p className="text-red-700">
              Tap the Share button in Safari, then choose “Add to Home Screen”.
              Open the app from your home screen and re-enable notifications
              here.
            </p>
          </div>
        </div>
      )}

      <div className="space-y-3">
        <ReadinessRow
          label="Notification permission"
          status={
            permission === 'granted'
              ? 'ok'
              : permission === 'denied'
              ? 'error'
              : 'warn'
          }
          value={
            permission === 'granted'
              ? 'Granted'
              : permission === 'denied'
              ? 'Denied'
              : 'Default'
          }
          action={
            permission !== 'granted' ? (
              <button
                onClick={handleRequestPermission}
                disabled={busy || permission === 'denied'}
                className="btn-secondary text-sm"
              >
                Re-request
              </button>
            ) : null
          }
        />

        <ReadinessRow
          label="Service worker installed"
          status={swReady ? 'ok' : 'warn'}
          value={swReady ? 'Yes' : 'No'}
        />

        <ReadinessRow
          label="Push subscription registered"
          status={subscribed ? 'ok' : 'warn'}
          value={subscribed ? 'Yes' : 'No'}
          action={
            !subscribed ? (
              <button
                onClick={handleSubscribe}
                disabled={busy || permission === 'denied'}
                className="btn-primary text-sm"
              >
                Subscribe
              </button>
            ) : null
          }
        />
      </div>
    </div>
  );
}

function ReadinessRow({
  label,
  value,
  status,
  action,
}: {
  label: string;
  value: string;
  status: 'ok' | 'warn' | 'error';
  action?: React.ReactNode;
}) {
  const Icon =
    status === 'ok' ? CheckCircle2 : status === 'error' ? XCircle : AlertTriangle;
  const tone =
    status === 'ok'
      ? 'text-green-600'
      : status === 'error'
      ? 'text-red-600'
      : 'text-yellow-600';

  return (
    <div className="flex items-center justify-between p-3 rounded-lg bg-gray-50">
      <div className="flex items-center gap-3 min-w-0">
        {status === 'ok' ? (
          <Bell className={`w-5 h-5 ${tone}`} />
        ) : (
          <BellOff className={`w-5 h-5 ${tone}`} />
        )}
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">{label}</p>
          <p className={`text-xs flex items-center gap-1 ${tone}`}>
            <Icon className="w-3.5 h-3.5" />
            {value}
          </p>
        </div>
      </div>
      {action}
    </div>
  );
}
