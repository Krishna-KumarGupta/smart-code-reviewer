/**
 * Admin Controller
 * Contains all business logic for admin-only endpoints.
 * Routes are thin — they only call these controller functions.
 */

import { supabaseAdmin } from '../config/supabase.js';
import { sendSuccess, sendError } from '../utils/response.js';

/**
 * GET /api/admin/dashboard
 * Returns system-wide stats for the admin dashboard.
 * Accessible only by users with role='admin'.
 */
export const getDashboard = async (req, res, next) => {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Run all count queries in parallel for efficiency
    const [totalResult, newUsersResult, adminResult, githubResult] = await Promise.all([
      supabaseAdmin
        .from('profiles')
        .select('*', { count: 'exact', head: true }),

      supabaseAdmin
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', sevenDaysAgo),

      supabaseAdmin
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .eq('role', 'admin'),

      supabaseAdmin
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .eq('github_connected', true),
    ]);

    if (totalResult.error) {
      return sendError(res, 'Failed to fetch dashboard statistics', 500);
    }

    const totalUsers     = totalResult.count ?? 0;
    const newUsers       = newUsersResult.error ? 0 : (newUsersResult.count ?? 0);
    const adminCount     = adminResult.error ? 0 : (adminResult.count ?? 0);
    const githubCount    = githubResult.error ? 0 : (githubResult.count ?? 0);

    return sendSuccess(res, {
      stats: {
        totalUsers,
        newUsersThisWeek: newUsers,
        adminCount,
        regularUsers: totalUsers - adminCount,
        githubConnected: githubCount,
      },
      admin: {
        id: req.user.id,
        email: req.user.email,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/admin/users
 * Returns a paginated list of all users.
 * Query params: page (default 1), limit (default 20)
 */
export const getUsers = async (req, res, next) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const from  = (page - 1) * limit;
    const to    = from + limit - 1;

    const { data: users, count, error } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name, email, role, github_connected, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) {
      return sendError(res, 'Failed to fetch users', 500);
    }

    return sendSuccess(res, {
      users,
      pagination: {
        page,
        limit,
        total: count ?? 0,
        totalPages: Math.ceil((count ?? 0) / limit),
      },
    });
  } catch (err) {
    next(err);
  }
};
