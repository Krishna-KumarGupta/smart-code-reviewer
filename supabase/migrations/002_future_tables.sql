-- ============================================================
-- Migration 002: Future tables for GitHub App integration
-- These are empty schemas — no business logic yet.
-- Run in Supabase SQL Editor after 001_profile_updates.sql
-- ============================================================

-- ─── 1. github_installations ──────────────────────────────────────────────────
-- Tracks each GitHub App installation (per user or organization).
-- One user can have multiple installations (e.g., personal + org).

CREATE TABLE IF NOT EXISTS public.github_installations (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  installation_id BIGINT      NOT NULL UNIQUE,  -- GitHub's installation ID
  account_login   TEXT        NOT NULL,          -- GitHub username or org name
  account_type    TEXT        NOT NULL CHECK (account_type IN ('User', 'Organization')),
  access_token    TEXT,                           -- Installation access token (short-lived)
  token_expires_at TIMESTAMPTZ,                  -- When the above token expires
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.github_installations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own installations"
  ON public.github_installations FOR SELECT
  USING (auth.uid() = user_id);

CREATE TRIGGER github_installations_set_updated_at
  BEFORE UPDATE ON public.github_installations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_github_installations_user_id
  ON public.github_installations(user_id);

-- ─── 2. repositories ──────────────────────────────────────────────────────────
-- Tracks GitHub repositories the user has enabled for code review.

CREATE TABLE IF NOT EXISTS public.repositories (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  installation_id UUID        REFERENCES public.github_installations(id) ON DELETE SET NULL,
  github_repo_id  BIGINT      NOT NULL,          -- GitHub's repository ID
  full_name       TEXT        NOT NULL,           -- e.g. "owner/repo-name"
  name            TEXT        NOT NULL,           -- e.g. "repo-name"
  owner           TEXT        NOT NULL,           -- e.g. "owner"
  private         BOOLEAN     NOT NULL DEFAULT FALSE,
  default_branch  TEXT        DEFAULT 'main',
  webhook_secret  TEXT,                           -- For validating webhook payloads
  is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, github_repo_id)
);

ALTER TABLE public.repositories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own repositories"
  ON public.repositories FOR SELECT
  USING (auth.uid() = user_id);

CREATE TRIGGER repositories_set_updated_at
  BEFORE UPDATE ON public.repositories
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_repositories_user_id
  ON public.repositories(user_id);

CREATE INDEX IF NOT EXISTS idx_repositories_github_repo_id
  ON public.repositories(github_repo_id);

-- ─── 3. reviews ───────────────────────────────────────────────────────────────
-- Stores each AI review job triggered by a GitHub PR event.

CREATE TABLE IF NOT EXISTS public.reviews (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  repository_id   UUID        NOT NULL REFERENCES public.repositories(id) ON DELETE CASCADE,
  pr_number       INTEGER     NOT NULL,
  pr_title        TEXT,
  pr_url          TEXT,
  pr_author       TEXT,
  base_branch     TEXT,
  head_branch     TEXT,
  status          TEXT        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  result          JSONB,      -- Full AI review output (structured JSON)
  error_message   TEXT,       -- Error details if status='failed'
  github_review_id BIGINT,    -- GitHub review ID after posting comment
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own reviews"
  ON public.reviews FOR SELECT
  USING (auth.uid() = user_id);

CREATE TRIGGER reviews_set_updated_at
  BEFORE UPDATE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_reviews_user_id
  ON public.reviews(user_id);

CREATE INDEX IF NOT EXISTS idx_reviews_repository_id
  ON public.reviews(repository_id);

CREATE INDEX IF NOT EXISTS idx_reviews_status
  ON public.reviews(status);

-- ─── Verify ──────────────────────────────────────────────────────────────────
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public'
-- ORDER BY table_name;
