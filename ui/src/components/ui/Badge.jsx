import clsx from 'clsx';

const statusStyles = {
  completed: 'bg-green-100 text-green-800',
  success: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  error: 'bg-red-100 text-red-800',
  running: 'bg-blue-100 text-blue-800',
  pending: 'bg-yellow-100 text-yellow-800',
  active: 'bg-green-100 text-green-800',
  inactive: 'bg-gray-100 text-gray-800',
};

export default function Badge({ status, children, className }) {
  const text = children || status;
  const style = statusStyles[status?.toLowerCase()] || 'bg-gray-100 text-gray-800';

  return (
    <span
      className={clsx(
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize',
        style,
        className
      )}
    >
      {text}
    </span>
  );
}
