import { format, formatDistanceToNow, parseISO } from 'date-fns';

export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? parseISO(date) : date;
  return format(d, 'MMM d, yyyy');
}

export function formatDateTime(date: string | Date): string {
  const d = typeof date === 'string' ? parseISO(date) : date;
  return format(d, 'MMM d, yyyy h:mm a');
}

export function formatTime(date: string | Date): string {
  const d = typeof date === 'string' ? parseISO(date) : date;
  return format(d, 'h:mm a');
}

export function formatRelative(date: string | Date): string {
  const d = typeof date === 'string' ? parseISO(date) : date;
  return formatDistanceToNow(d, { addSuffix: true });
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

export function getStatusColor(status: string): string {
  switch (status) {
    case 'NEW':
      return 'text-blue-600 bg-blue-100';
    case 'ESCALATING':
      return 'text-orange-600 bg-orange-100';
    case 'ACKNOWLEDGED':
      return 'text-green-600 bg-green-100';
    case 'RESOLVED':
      return 'text-gray-600 bg-gray-100';
    case 'EXPIRED':
      return 'text-red-600 bg-red-100';
    case 'DOWNGRADED':
      return 'text-purple-600 bg-purple-100';
    default:
      return 'text-gray-600 bg-gray-100';
  }
}

export function getCallStatusColor(status: string): string {
  switch (status) {
    case 'COMPLETED':
    case 'ANSWERED':
      return 'text-green-600';
    case 'FAILED':
    case 'NO_ANSWER':
    case 'BUSY':
      return 'text-red-600';
    case 'RINGING':
    case 'INITIATED':
      return 'text-yellow-600';
    default:
      return 'text-gray-600';
  }
}

export function getSmsStatusColor(status: string): string {
  switch (status) {
    case 'DELIVERED':
      return 'text-green-600';
    case 'SENT':
      return 'text-blue-600';
    case 'FAILED':
    case 'UNDELIVERED':
      return 'text-red-600';
    default:
      return 'text-gray-600';
  }
}

export function truncate(str: string, length: number): string {
  if (str.length <= length) return str;
  return str.slice(0, length) + '...';
}
