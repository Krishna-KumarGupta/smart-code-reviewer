/**
 * Response Utilities
 * Standardised JSON response helpers for consistent API output.
 */

/**
 * Send a success response.
 * @param {import('express').Response} res
 * @param {object} data - Payload to send
 * @param {number} [statusCode=200]
 */
export const sendSuccess = (res, data, statusCode = 200) => {
  res.status(statusCode).json({
    success: true,
    data,
  });
};

/**
 * Send an error response.
 * @param {import('express').Response} res
 * @param {string} message - Human-readable error message
 * @param {number} [statusCode=500]
 */
export const sendError = (res, message, statusCode = 500) => {
  res.status(statusCode).json({
    success: false,
    error: message,
  });
};
