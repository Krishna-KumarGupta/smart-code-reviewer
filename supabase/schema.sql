-- ============================================================
-- Smart Code Reviewer — Supabase Database Schema
-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor)
-- ============================================================

-- ─── 1. Create Profiles Table ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name   TEXT,
  email       TEXT,
  avatar_url  TEXT,
  role        TEXT        NOT NULL DEFAULT 'user'
                          CHECK (role IN ('user', 'admin')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 2. Enable Row Level Security ────────────────────────────────────────────
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ─── 3. RLS Policies ─────────────────────────────────────────────────────────

-- Users can view only their own profile
CREATE POLICY "Users can view own profile"
  ON public.profiles
  FOR SELECT
  USING (auth.uid() = id);

-- Users can update only their own profile
-- (role column updates should be done manually via SQL — not allowed through this policy)
CREATE POLICY "Users can update own profile"
  ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    -- Prevent users from changing their own role via this policy
    AND role = (SELECT role FROM public.profiles WHERE id = auth.uid())
  );

-- ─── 4. Auto-Insert Profile on User Signup ───────────────────────────────────
-- Trigger function: runs after every new row in auth.users

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, avatar_url, role)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data ->> 'full_name',
    NEW.email,
    NEW.raw_user_meta_data ->> 'avatar_url',
    'user'  -- Default role — change to 'admin' manually for admin users
  );
  RETURN NEW;
END;
$$;

-- Drop trigger if it exists (idempotent)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Attach trigger to auth.users
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();


-- ─── 5. Promote a User to Admin (Run Manually) ───────────────────────────────
-- To make a user an admin, run this after they register:
--
-- UPDATE public.profiles
-- SET role = 'admin'
-- WHERE email = 'admin@yourdomain.com';


-- ─── 6. Verify Setup ─────────────────────────────────────────────────────────
-- After running this script, verify with:
--
-- SELECT * FROM public.profiles;
-- SELECT * FROM information_schema.triggers WHERE trigger_name = 'on_auth_user_created';
