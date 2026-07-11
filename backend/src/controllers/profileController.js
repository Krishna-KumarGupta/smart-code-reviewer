/**
 * Profile Controller
 * Contains all business logic for profile-related endpoints.
 * Routes are thin — they only call these controller functions.
 */

import { supabaseAdmin } from '../config/supabase.js';
import { sendSuccess, sendError } from '../utils/response.js';

/**
 * GET /api/profile
 * Returns the full profile row for the authenticated user.
 */
export const getProfile = async (req, res, next) => {
  try {
    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name, email, avatar_url, role, github_username, github_connected, created_at, updated_at')
      .eq('id', req.user.id)
      .single();

    if (error || !profile) {
      return sendError(res, 'Profile not found', 404);
    }

    return sendSuccess(res, { profile });
  } catch (err) {
    next(err); // Delegate to global error handler
  }
};

/**
 * PUT /api/profile
 * Updates allowed profile fields for the authenticated user.
 * Role changes are NOT allowed through this endpoint.
 */
export const updateProfile = async (req, res, next) => {
  try {
    const { full_name, avatar_url, github_username } = req.body;

    // Only allow safe fields — role is never updatable here
    const updates = {};
    if (full_name !== undefined) updates.full_name = full_name;
    if (avatar_url !== undefined) updates.avatar_url = avatar_url;
    if (github_username !== undefined) updates.github_username = github_username;

    if (Object.keys(updates).length === 0) {
      return sendError(res, 'No updatable fields provided', 400);
    }

    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .update(updates)
      .eq('id', req.user.id)
      .select('id, full_name, email, avatar_url, role, github_username, github_connected, created_at, updated_at')
      .single();

    if (error || !profile) {
      return sendError(res, 'Failed to update profile', 500);
    }

    return sendSuccess(res, { profile });
  } catch (err) {
    next(err);
  }
};
