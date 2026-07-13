/**
 * GitHub OAuth Configuration
 *
 * Validates all required GitHub env vars on startup (fail-fast).
 * Exports a frozen config object consumed by the entire github module.
 *
 * Required .env vars:
 *   GITHUB_CLIENT_ID      — From GitHub OAuth App settings
 *   GITHUB_CLIENT_SECRET  — From GitHub OAuth App settings
 *   GITHUB_CALLBACK_URL   — Must match exactly what's registered in GitHub App
 *   TOKEN_ENCRYPTION_KEY  — 64 hex chars (32 bytes) for AES-256-GCM
 *   GITHUB_STATE_SECRET   — Arbitrary secret for HMAC-SHA256 state signing
 */

const {
  GITHUB_CLIENT_ID,
  GITHUB_CLIENT_SECRET,
  GITHUB_CALLBACK_URL,
  TOKEN_ENCRYPTION_KEY,
  GITHUB_STATE_SECRET,
} = process.env;

// ─── Startup Validation ───────────────────────────────────────────────────────

if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET || !GITHUB_CALLBACK_URL) {
  throw new Error(
    '[githubConfig] Missing GitHub OAuth env vars.\n' +
    'Required: GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GITHUB_CALLBACK_URL'
  );
}

if (!TOKEN_ENCRYPTION_KEY || TOKEN_ENCRYPTION_KEY.length !== 64) {
  throw new Error(
    '[githubConfig] TOKEN_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes).\n' +
    'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
  );
}

if (!GITHUB_STATE_SECRET || GITHUB_STATE_SECRET.length < 32) {
  throw new Error(
    '[githubConfig] GITHUB_STATE_SECRET must be at least 32 characters.\n' +
    'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
  );
}

// ─── Config Object ────────────────────────────────────────────────────────────

const githubConfig = Object.freeze({
  clientId:      GITHUB_CLIENT_ID,
  clientSecret:  GITHUB_CLIENT_SECRET,
  callbackUrl:   GITHUB_CALLBACK_URL,
  encryptionKey: TOKEN_ENCRYPTION_KEY,
  stateSecret:   GITHUB_STATE_SECRET,

  // GitHub OAuth endpoints
  authorizeUrl: 'https://github.com/login/oauth/authorize',
  tokenUrl:     'https://github.com/login/oauth/access_token',
  userApiUrl:   'https://api.github.com/user',

  // OAuth scopes — read:user and user:email are enough for account connection
  scopes: 'read:user user:email',

  // State token validity window (milliseconds) — reject callbacks older than 10 min
  stateMaxAgeMs: 10 * 60 * 1000,
});

export default githubConfig;
