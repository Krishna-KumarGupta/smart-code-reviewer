/**
 * reviewAgent Utility
 *
 * Exposes endpoints and creates authorization headers for communicating
 * with the internal review-agent microservice.
 */

export const REVIEW_AGENT_URL = process.env.REVIEW_AGENT_URL || 'http://localhost:5050';
export const SERVICE_API_KEY  = process.env.SERVICE_API_KEY  || '';

if (!SERVICE_API_KEY) {
  console.warn(
    '[reviewAgent] WARNING: SERVICE_API_KEY is not set. ' +
    'All review-agent calls will be rejected with 401.'
  );
}

/**
 * Construct authorization headers for review-agent service calls.
 *
 * @param {{ id: string, email: string }} user - The user object representing identity
 * @param {string|null} role - Optional role override
 * @returns {object} headers object
 */
export function makeReviewAgentHeaders(user, role = null) {
  const userId = user ? (user.id || user.user_id || user.sub || '') : '';
  const userEmail = user ? (user.email || user.user_email || '') : '';

  const headers = {
    'Content-Type':      'application/json',
    'X-Service-Api-Key': SERVICE_API_KEY,
    'X-User-Id':         userId,
    'X-User-Email':      userEmail,
  };
  if (role) {
    headers['X-User-Role'] = role;
  }
  return headers;
}
