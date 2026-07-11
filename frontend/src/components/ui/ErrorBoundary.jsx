/**
 * ErrorBoundary Component
 *
 * Class component that catches JavaScript errors anywhere in the child tree,
 * logs them, and renders a fallback UI instead of crashing the whole app.
 *
 * Usage:
 *   <ErrorBoundary>
 *     <SomeComponent />
 *   </ErrorBoundary>
 *
 *   // With custom fallback:
 *   <ErrorBoundary fallback={<p>Something broke</p>}>
 *     <SomeComponent />
 *   </ErrorBoundary>
 */

import { Component } from 'react';
import { RiAlertLine, RiRefreshLine, RiHome4Line } from 'react-icons/ri';

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    // In production, send to error tracking (e.g., Sentry)
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    const { hasError, error } = this.state;
    const { children, fallback } = this.props;

    if (!hasError) return children;

    // Custom fallback provided
    if (fallback) return fallback;

    // Default error UI
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="glass-card max-w-lg w-full p-8 text-center">
          {/* Icon */}
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-error/10 border border-error/20 mb-6">
            <RiAlertLine className="text-3xl text-error" />
          </div>

          <h2 className="text-xl font-bold text-text-primary mb-2">
            Something went wrong
          </h2>
          <p className="text-text-muted text-sm mb-6 leading-relaxed">
            An unexpected error occurred. Our team has been notified.
            Try refreshing the page or returning to the dashboard.
          </p>

          {/* Error details (development only) */}
          {process.env.NODE_ENV === 'development' && error && (
            <div className="mb-6 p-3 rounded-xl bg-surface-2 border border-border text-left">
              <p className="text-xs text-error font-mono break-all">{error.toString()}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={this.handleReset}
              className="
                inline-flex items-center gap-2 px-4 py-2.5 rounded-xl
                bg-surface-2 border border-border-light
                text-sm text-text-secondary
                hover:border-primary hover:text-primary
                transition-all duration-200
              "
            >
              <RiRefreshLine />
              Try again
            </button>
            <a
              href="/"
              className="
                inline-flex items-center gap-2 px-4 py-2.5 rounded-xl
                bg-gradient-to-r from-primary to-primary-hover
                text-sm text-white font-semibold
                transition-all duration-200 hover:shadow-glow hover:-translate-y-0.5
              "
            >
              <RiHome4Line />
              Go home
            </a>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
