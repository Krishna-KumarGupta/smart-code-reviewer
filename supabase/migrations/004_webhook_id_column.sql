-- ============================================================
-- Migration 004 — Add github_webhook_id to repositories
-- Smart Code Reviewer
--
-- Phase 3B: Automatic webhook creation.
-- Stores the GitHub webhook ID returned by POST /repos/{owner}/{repo}/hooks
-- so we can:
--   1. Check idempotency — avoid creating duplicate webhooks
--   2. Support future webhook deletion (DELETE /repos/{owner}/{repo}/hooks/{id})
--
-- Run in: Supabase Dashboard → SQL Editor → New query → Paste → Run
-- Run AFTER: 002_future_tables.sql (which creates the repositories table)
-- ============================================================

-- ─── 1. Add github_webhook_id column ─────────────────────────────────────────
-- Nullable BIGINT: NULL means no webhook has been created yet for this repo.
-- GitHub webhook IDs are 64-bit integers.
-- A non-NULL value means the webhook was successfully registered.

ALTER TABLE public.repositories
  ADD COLUMN IF NOT EXISTS github_webhook_id BIGINT DEFAULT NULL;

-- ─── 2. Add index for fast webhook existence checks ───────────────────────────
-- We query by github_webhook_id to detect duplicates on the GitHub side
-- if our DB row were ever lost. The index makes this check O(log n).

CREATE INDEX IF NOT EXISTS idx_repositories_github_webhook_id
  ON public.repositories(github_webhook_id)
  WHERE github_webhook_id IS NOT NULL;

-- ─── 3. Verification ─────────────────────────────────────────────────────────
-- After running this script, verify:
--
--   SELECT column_name, data_type, column_default, is_nullable
--   FROM information_schema.columns
--   WHERE table_name = 'repositories'
--     AND column_name = 'github_webhook_id';
--
-- Expected row:
--   column_name       | data_type | column_default | is_nullable
--   github_webhook_id | bigint    | NULL           | YES
