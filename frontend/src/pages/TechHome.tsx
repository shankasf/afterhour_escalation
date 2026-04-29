import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronRight, Inbox } from 'lucide-react';
import api from '../lib/api';
import { Event } from '../types';
import { formatDateTime } from '../lib/utils';

export default function TechHome() {
  const { data: events, isLoading } = useQuery<Event[]>({
    queryKey: ['tech-active-events'],
    queryFn: async () => {
      const res = await api.get('/events', {
        params: { status: 'ESCALATING,NEW,ACKNOWLEDGED', limit: 20 },
      });
      return Array.isArray(res.data) ? res.data : res.data?.data ?? [];
    },
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-gray-900">Active incidents</h1>
        <p className="text-sm text-gray-500">
          Tap an incident to view details and contact the customer.
        </p>
      </header>

      {isLoading ? (
        <div className="card flex items-center justify-center py-10">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
        </div>
      ) : !events || events.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-12 text-center">
          <Inbox className="w-10 h-10 text-gray-300 mb-3" />
          <p className="text-gray-500">No active incidents right now.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {events.map((ev) => (
            <li key={ev.id}>
              <Link
                to={`/incidents/${ev.id}`}
                className="card flex items-center gap-3 hover:border-primary-200 hover:shadow transition-all"
              >
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                    ev.isEmergency
                      ? 'bg-red-100 text-red-600'
                      : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 truncate">
                    {ev.subject || 'Untitled incident'}
                  </p>
                  <p className="text-xs text-gray-500">
                    {ev.status} · {formatDateTime(ev.createdAt)}
                  </p>
                </div>
                <ChevronRight className="w-5 h-5 text-gray-400 flex-shrink-0" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
