-- ============================================================
-- Migration 003 — GitHub DB Ownership Cleanup
-- Smart Code Reviewer
--
-- Enforces the rule: profiles stores ONLY github_connected.
-- All other GitHub identity data lives in github_accounts.
--
-- Run AFTER migration 002.
-- Run in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- ─── 1. Remove github_username from profiles ─────────────────────────────────
-- Username lives in github_accounts.github_username.
-- This column was added in migration 002 and is now removed to enforce
-- clean table ownership boundaries.

ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS github_username;


-- ─── 2. Verification ─────────────────────────────────────────────────────────
-- After running, confirm the column is gone:
--
--   SELECT column_name
--   FROM information_schema.columns
--   WHERE table_name = 'profiles'
--   ORDER BY ordinal_position;
--
-- You should see: id, full_name, email, avatar_url, role, created_at,
--                 github_connected, updated_at
-- You should NOT see: github_username
