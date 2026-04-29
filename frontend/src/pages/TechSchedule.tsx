import { useQuery } from '@tanstack/react-query';
import { Calendar } from 'lucide-react';
import api from '../lib/api';
import { OnCallRotation } from '../types';
import { formatDateTime } from '../lib/utils';

export default function TechSchedule() {
  const { data, isLoading } = useQuery<OnCallRotation[]>({
    queryKey: ['tech-schedule'],
    queryFn: async () => {
      const res = await api.get('/rotation');
      return Array.isArray(res.data) ? res.data : res.data?.data ?? [];
    },
  });

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold text-gray-900">On-call schedule</h1>
        <p className="text-sm text-gray-500">Upcoming and current rotations.</p>
      </header>

      {isLoading ? (
        <div className="card flex items-center justify-center py-10">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
        </div>
      ) : !data || data.length === 0 ? (
        <div className="card text-center py-10 text-gray-500">
          No rotations scheduled
        </div>
      ) : (
        <ul className="space-y-2">
          {data.map((r) => (
            <li
              key={r.id}
              className={`card flex items-center gap-3 ${
                r.isCurrent ? 'border-primary-200 bg-primary-50/40' : ''
              }`}
            >
              <div className="w-10 h-10 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center flex-shrink-0">
                <Calendar className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 truncate">
                  {r.user?.name}
                </p>
                <p className="text-xs text-gray-500">
                  {formatDateTime(r.startDate)} → {formatDateTime(r.endDate)}
                </p>
              </div>
              {r.isCurrent && (
                <span className="badge bg-primary-100 text-primary-700">
                  On call
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
