-- ============================================================
-- Migration 002 — GitHub OAuth Account Connection
-- Smart Code Reviewer
--
-- Run this in your Supabase SQL Editor:
--   Dashboard → SQL Editor → New query → Paste → Run
-- ============================================================


-- ─── 1. Update profiles table ────────────────────────────────────────────────

-- Add github_connected flag (tracks whether a GitHub account is linked)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS github_connected BOOLEAN NOT NULL DEFAULT FALSE;

-- Add updated_at column to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Also add github_username if not already present (used in existing code)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS github_username TEXT;


-- ─── 2. updated_at trigger for profiles ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_profiles_updated_at ON public.profiles;

CREATE TRIGGER set_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();


-- ─── 3. Create github_accounts table ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.github_accounts (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  github_user_id        BIGINT      UNIQUE,
  github_username       TEXT,
  github_avatar         TEXT,
  encrypted_access_token   TEXT,
  encrypted_refresh_token  TEXT,
  token_expires_at      TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One user can only have one connected GitHub account
  CONSTRAINT github_accounts_user_id_unique UNIQUE (user_id)
);


-- ─── 4. updated_at trigger for github_accounts ───────────────────────────────

DROP TRIGGER IF EXISTS set_github_accounts_updated_at ON public.github_accounts;

CREATE TRIGGER set_github_accounts_updated_at
  BEFORE UPDATE ON public.github_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();


-- ─── 5. Enable Row Level Security ────────────────────────────────────────────

ALTER TABLE public.github_accounts ENABLE ROW LEVEL SECURITY;


-- ─── 6. RLS Policies for github_accounts ─────────────────────────────────────

-- Users can view only their own GitHub account record
CREATE POLICY "Users can view own github_account"
  ON public.github_accounts
  FOR SELECT
  USING (auth.uid() = user_id);

-- No INSERT/UPDATE/DELETE from client — backend uses service role key only.
-- Service role bypasses RLS, so no additional policy is needed for server ops.


-- ─── 7. Verification ─────────────────────────────────────────────────────────
-- After running this script, verify:
--
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'profiles' AND column_name IN ('github_connected', 'updated_at', 'github_username');
--
--   SELECT * FROM public.github_accounts LIMIT 1;
