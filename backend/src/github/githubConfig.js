/**
 * GitHub OAuth Configuration
 *
 * Validates that all required GitHub OAuth environment variables are present
 * and exports them as a single frozen config object.
 *
 * Required .env vars:
 *   GITHUB_CLIENT_ID      — From GitHub OAuth App settings
 *   GITHUB_CLIENT_SECRET  — From GitHub OAuth App settings
 *   GITHUB_CALLBACK_URL   — Must match exactly what's registered in GitHub App
 *   TOKEN_ENCRYPTION_KEY  — 64 hex chars (32 bytes) for AES-256-GCM
 */

const {
  GITHUB_CLIENT_ID,
  GITHUB_CLIENT_SECRET,
  GITHUB_CALLBACK_URL,
  TOKEN_ENCRYPTION_KEY,
} = process.env;

// Validate on startup — fail fast rather than at request time
if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET || !GITHUB_CALLBACK_URL) {
  throw new Error(
    '[githubConfig] Missing GitHub OAuth env vars.\n' +
    'Required: GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GITHUB_CALLBACK_URL'
  );
}

if (!TOKEN_ENCRYPTION_KEY || TOKEN_ENCRYPTION_KEY.length !== 64) {
  throw new Error(
    '[githubConfig] TOKEN_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes).\n' +
    'Generate with: openssl rand -hex 32'
  );
}

const githubConfig = Object.freeze({
  clientId:     GITHUB_CLIENT_ID,
  clientSecret: GITHUB_CLIENT_SECRET,
  callbackUrl:  GITHUB_CALLBACK_URL,
  encryptionKey: TOKEN_ENCRYPTION_KEY,

  // GitHub OAuth endpoints
  authorizeUrl:  'https://github.com/login/oauth/authorize',
  tokenUrl:      'https://github.com/login/oauth/access_token',
  userApiUrl:    'https://api.github.com/user',

  // OAuth scopes — read:user and user:email are enough for account connection
  scopes: 'read:user user:email',
});

export default githubConfig;
