/**
 * EmptyState Component
 *
 * Reusable empty state card for when a list or page has no data.
 *
 * Props:
 *   icon        : React node — icon to display (default: folder icon)
 *   title       : string — heading text
 *   description : string — supporting description
 *   action      : React node — optional CTA button or link
 *   compact     : boolean — smaller padding for inline empty states
 */

import { RiFolderOpenLine } from 'react-icons/ri';

const EmptyState = ({
  icon,
  title = 'Nothing here yet',
  description,
  action,
  compact = false,
}) => {
  return (
    <div
      className={`
        glass-card text-center
        ${compact ? 'py-10 px-6' : 'py-16 px-8'}
      `}
    >
      {/* Icon */}
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-surface-2 border border-border mb-5">
        <span className="text-3xl text-text-muted">
          {icon || <RiFolderOpenLine />}
        </span>
      </div>

      {/* Title */}
      <h3 className="text-base font-semibold text-text-primary mb-2">{title}</h3>

      {/* Description */}
      {description && (
        <p className="text-sm text-text-muted max-w-sm mx-auto leading-relaxed mb-6">
          {description}
        </p>
      )}

      {/* Action */}
      {action && <div className="flex justify-center">{action}</div>}
    </div>
  );
};

export default EmptyState;
