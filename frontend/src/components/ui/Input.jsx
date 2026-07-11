/**
 * Input Component
 * Labeled text input with error display and optional password toggle.
 *
 * Props:
 *   id          : string (required for accessibility)
 *   label       : string
 *   error       : string | null — error message to display
 *   type        : 'text' | 'email' | 'password' | ...
 *   icon        : React node — icon to show on the left
 *   ...rest     : all standard input HTML attributes
 */

import { useState } from 'react';
import { RiEyeLine, RiEyeOffLine } from 'react-icons/ri';

const Input = ({
  id,
  label,
  error,
  type = 'text',
  icon,
  className = '',
  ...rest
}) => {
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = type === 'password';
  const inputType = isPassword ? (showPassword ? 'text' : 'password') : type;

  return (
    <div className="flex flex-col gap-1.5">
      {/* Label */}
      {label && (
        <label
          htmlFor={id}
          className="text-sm font-medium text-text-secondary"
        >
          {label}
        </label>
      )}

      {/* Input Wrapper */}
      <div className="relative">
        {/* Left Icon */}
        {icon && (
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted text-base pointer-events-none">
            {icon}
          </span>
        )}

        <input
          id={id}
          type={inputType}
          className={`
            w-full
            bg-surface-2
            border
            ${error ? 'border-error shadow-[0_0_0_3px_rgba(239,68,68,0.1)]' : 'border-border-light focus:border-primary focus:shadow-[0_0_0_3px_rgba(99,102,241,0.15)]'}
            text-text-primary
            rounded-xl
            py-3
            ${icon ? 'pl-10' : 'pl-4'}
            ${isPassword ? 'pr-10' : 'pr-4'}
            text-sm
            placeholder:text-text-muted
            outline-none
            transition-all duration-200
            ${className}
          `}
          {...rest}
        />

        {/* Password Toggle */}
        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            tabIndex={-1}
          >
            {showPassword ? (
              <RiEyeOffLine className="text-base" />
            ) : (
              <RiEyeLine className="text-base" />
            )}
          </button>
        )}
      </div>

      {/* Error Message */}
      {error && (
        <p className="text-xs text-error flex items-center gap-1" role="alert">
          <span>⚠</span>
          {error}
        </p>
      )}
    </div>
  );
};

export default Input;
