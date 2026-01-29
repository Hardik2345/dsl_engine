import { format, formatDistanceToNow } from 'date-fns';

export function formatDate(date, pattern = 'MMM d, yyyy') {
  if (!date) return '-';
  return format(new Date(date), pattern);
}

export function formatDateTime(date) {
  if (!date) return '-';
  return format(new Date(date), 'MMM d, yyyy HH:mm:ss');
}

export function formatRelativeTime(date) {
  if (!date) return '-';
  return formatDistanceToNow(new Date(date), { addSuffix: true });
}

export function formatDuration(startedAt, finishedAt) {
  if (!startedAt || !finishedAt) return '-';
  const start = new Date(startedAt);
  const end = new Date(finishedAt);
  const diffMs = end - start;
  
  if (diffMs < 1000) return `${diffMs}ms`;
  if (diffMs < 60000) return `${(diffMs / 1000).toFixed(1)}s`;
  if (diffMs < 3600000) return `${(diffMs / 60000).toFixed(1)}m`;
  return `${(diffMs / 3600000).toFixed(1)}h`;
}

export function truncate(str, length = 50) {
  if (!str) return '';
  if (str.length <= length) return str;
  return str.slice(0, length) + '...';
}

export function classNames(...classes) {
  return classes.filter(Boolean).join(' ');
}
