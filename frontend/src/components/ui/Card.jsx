/**
 * Card Component
 * Dark glassmorphism card with optional header and configurable padding.
 *
 * Props:
 *   title      : string — optional card header title
 *   subtitle   : string — optional subtitle below title
 *   action     : React node — optional action slot (top-right of header)
 *   padding    : 'sm' | 'md' | 'lg' (default: 'md')
 *   glass      : boolean — enable glassmorphism effect (default: true)
 *   className  : string
 *   children   : React node
 */

const paddings = {
  sm: 'p-4',
  md: 'p-6',
  lg: 'p-8',
};

const Card = ({
  title,
  subtitle,
  action,
  padding = 'md',
  glass = true,
  className = '',
  children,
}) => {
  return (
    <div
      className={`
        rounded-2xl
        border border-border
        shadow-card
        ${glass ? 'bg-surface/80 backdrop-blur-xl' : 'bg-surface'}
        ${className}
      `}
    >
      {/* Card Header */}
      {(title || action) && (
        <div className="flex items-start justify-between px-6 pt-6 pb-0">
          <div>
            {title && (
              <h3 className="text-base font-semibold text-text-primary">{title}</h3>
            )}
            {subtitle && (
              <p className="text-sm text-text-muted mt-0.5">{subtitle}</p>
            )}
          </div>
          {action && <div className="ml-4 shrink-0">{action}</div>}
        </div>
      )}

      {/* Card Body */}
      <div className={paddings[padding]}>{children}</div>
    </div>
  );
};

export default Card;
