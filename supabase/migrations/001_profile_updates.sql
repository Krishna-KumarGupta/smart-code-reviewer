-- ============================================================
-- Migration 001: Extend profiles table
-- Run in Supabase SQL Editor after the initial schema.sql
-- ============================================================

-- ─── 1. Add new columns to profiles ──────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS github_username  TEXT,
  ADD COLUMN IF NOT EXISTS github_connected BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- ─── 2. Auto-maintain updated_at with a trigger ───────────────────────────────
-- This function sets updated_at = NOW() on every UPDATE.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Attach trigger to profiles
DROP TRIGGER IF EXISTS profiles_set_updated_at ON public.profiles;

CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ─── 3. Backfill updated_at for existing rows ─────────────────────────────────
UPDATE public.profiles
SET updated_at = created_at
WHERE updated_at IS NULL OR updated_at = NOW() - INTERVAL '0 seconds';

-- ─── 4. Update the handle_new_user trigger to populate new fields ─────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (
    id,
    full_name,
    email,
    avatar_url,
    role,
    github_username,
    github_connected
  )
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data ->> 'full_name',
    NEW.email,
    NEW.raw_user_meta_data ->> 'avatar_url',
    'user',
    NULL,   -- github_username populated later via GitHub OAuth
    FALSE   -- not connected until GitHub OAuth flow completes
  );
  RETURN NEW;
END;
$$;

-- ─── 5. Verify ───────────────────────────────────────────────────────────────
-- SELECT column_name, data_type, column_default
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'profiles'
-- ORDER BY ordinal_position;
