import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import api from '../lib/api';
import { Event } from '../types';
import { formatDateTime } from '../lib/utils';

export default function Incidents() {
  const { data, isLoading } = useQuery<Event[]>({
    queryKey: ['tech-incidents'],
    queryFn: async () => {
      const res = await api.get('/events', { params: { limit: 50 } });
      return Array.isArray(res.data) ? res.data : res.data?.data ?? [];
    },
  });

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold text-gray-900">All incidents</h1>
        <p className="text-sm text-gray-500">Recent on-call incidents.</p>
      </header>

      {isLoading ? (
        <div className="card flex items-center justify-center py-10">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
        </div>
      ) : !data || data.length === 0 ? (
        <div className="card text-center py-10 text-gray-500">No incidents</div>
      ) : (
        <ul className="space-y-2">
          {data.map((ev) => (
            <li key={ev.id}>
              <Link
                to={`/incidents/${ev.id}`}
                className="card flex items-center gap-3 hover:border-primary-200 hover:shadow transition-all"
              >
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
