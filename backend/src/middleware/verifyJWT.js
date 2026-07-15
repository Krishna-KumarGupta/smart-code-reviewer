/**
 * verifyJWT Middleware
 *
 * Verifies the Supabase JWT sent in the Authorization: Bearer <token> header.
 * Uses supabase.auth.getUser(token) — the official Supabase approach.
 *
 * Why NOT JWKS?
 * Supabase rotates its JWT signing keys. Using getUser() delegates validation
 * to Supabase's auth server, which always uses the current key. This is both
 * simpler and more robust than maintaining a local JWKS cache.
 *
 * On success : attaches req.user = Supabase User object, calls next()
 * On failure : returns 401 Unauthorized
 */

import { supabaseAnon } from '../config/supabase.js';

const verifyJWT = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Missing or malformed Authorization header',
        code: 'AUTH_HEADER_MISSING',
      });
    }
    console.info('[verifyJWT] Bearer token received — verifying with Supabase');

    const token = authHeader.slice(7); // Remove "Bearer " prefix

    // Verify token via Supabase — validates signature and expiry
    const { data, error } = await supabaseAnon.auth.getUser(token);

    if (error || !data?.user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired token',
        code: 'TOKEN_INVALID',
      });
    }

    req.user = data.user; // { id, email, role, ... }
    next();
  } catch (err) {
    next(err); // Delegate unexpected errors to global handler
  }
};

export default verifyJWT;
