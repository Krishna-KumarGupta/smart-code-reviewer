/**
 * Not Found (404) Middleware
 *
 * Catches any request that didn't match a registered route.
 * Must be registered AFTER all routes and BEFORE errorHandler in server.js.
 * Passes a structured error to the global errorHandler via next(err).
 */

const notFound = (req, _res, next) => {
  const err = new Error(`Route not found: ${req.method} ${req.originalUrl}`);
  err.statusCode = 404;
  err.code = 'ROUTE_NOT_FOUND';
  next(err);
};

export default notFound;
