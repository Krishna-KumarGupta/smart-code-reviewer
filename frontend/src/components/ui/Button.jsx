/**
 * Button Component
 * Reusable button with multiple variants and loading state.
 *
 * Props:
 *   variant   : 'primary' | 'secondary' | 'ghost' | 'danger'  (default: 'primary')
 *   loading   : boolean — shows spinner when true
 *   fullWidth : boolean (default: false)
 *   children  : React node
 *   ...rest   : all standard button HTML attributes
 */

import { motion } from 'framer-motion';

const variants = {
  primary:
    'bg-gradient-to-r from-primary to-primary-hover text-white hover:from-primary-hover hover:to-indigo-700 hover:-translate-y-0.5 hover:shadow-glow active:translate-y-0',
  secondary:
    'bg-surface-2 text-text-primary border border-border-light hover:border-primary hover:bg-surface hover:-translate-y-0.5 active:translate-y-0',
  ghost:
    'bg-transparent text-text-muted hover:text-text-primary hover:bg-surface-2',
  danger:
    'bg-gradient-to-r from-red-600 to-red-700 text-white hover:from-red-700 hover:to-red-800 hover:-translate-y-0.5 active:translate-y-0',
};

const Button = ({
  variant = 'primary',
  loading = false,
  fullWidth = false,
  children,
  className = '',
  disabled,
  ...rest
}) => {
  const isDisabled = disabled || loading;

  return (
    <motion.button
      whileTap={{ scale: isDisabled ? 1 : 0.98 }}
      disabled={isDisabled}
      className={`
        inline-flex items-center justify-center gap-2
        px-5 py-2.5
        text-sm font-semibold
        rounded-xl
        border-0
        cursor-pointer
        transition-all duration-200
        disabled:opacity-60 disabled:cursor-not-allowed disabled:transform-none
        ${variants[variant]}
        ${fullWidth ? 'w-full' : ''}
        ${className}
      `}
      {...rest}
    >
      {/* Loading Spinner */}
      {loading && (
        <svg
          className="w-4 h-4 animate-spin"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      )}
      {children}
    </motion.button>
  );
};

export default Button;
