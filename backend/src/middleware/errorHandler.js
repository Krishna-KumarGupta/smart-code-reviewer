/**
 * Global Error Handler Middleware
 *
 * Catches errors passed via next(err) from any route or middleware.
 * Must be registered LAST in server.js after all routes.
 *
 * Produces a consistent { success: false, error, code } JSON response.
 */

const errorHandler = (err, req, res, _next) => {
  // Log full error server-side (never expose stack to client)
  console.error(`[ErrorHandler] ${req.method} ${req.path}`, {
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });

  // Determine HTTP status code
  const statusCode = err.statusCode || err.status || 500;

  // Supabase errors often carry a code field
  const errorCode = err.code || 'INTERNAL_ERROR';

  res.status(statusCode).json({
    success: false,
    error: statusCode === 500 && process.env.NODE_ENV === 'production'
      ? 'Internal server error'   // Never leak internals in production
      : err.message || 'An unexpected error occurred',
    code: errorCode,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

export default errorHandler;
