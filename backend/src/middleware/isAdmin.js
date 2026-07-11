/**
 * isAdmin Middleware
 *
 * Must run AFTER verifyJWT (req.user must already be set).
 * Queries the profiles table using the admin client (bypasses RLS) to
 * check if the authenticated user has role='admin'.
 *
 * On success : attaches req.userRole = 'admin', calls next()
 * On failure : returns 403 Forbidden
 */

import { supabaseAdmin } from '../config/supabase.js';

const isAdmin = async (req, res, next) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized — no user context',
        code: 'NO_USER_CONTEXT',
      });
    }

    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', req.user.id)
      .single();

    if (error || !profile) {
      return res.status(500).json({
        success: false,
        error: 'Could not verify user role',
        code: 'ROLE_FETCH_ERROR',
      });
    }

    if (profile.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Forbidden — admin access required',
        code: 'INSUFFICIENT_ROLE',
      });
    }

    req.userRole = profile.role;
    next();
  } catch (err) {
    next(err);
  }
};

export default isAdmin;
