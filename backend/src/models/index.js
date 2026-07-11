/**
 * Models — Placeholder
 *
 * This directory contains type definitions and data-shape documentation
 * for Supabase table rows. JavaScript doesn't have types, but these
 * JSDoc definitions serve as the source of truth for data shapes.
 *
 *   models/
 *   ├── profile.js         — Profile row shape
 *   ├── installation.js    — GitHub installation row shape
 *   ├── repository.js      — Repository row shape
 *   └── review.js          — Review row shape
 */

/**
 * @typedef {Object} Profile
 * @property {string} id
 * @property {string|null} full_name
 * @property {string} email
 * @property {string|null} avatar_url
 * @property {'user'|'admin'} role
 * @property {string|null} github_username
 * @property {boolean} github_connected
 * @property {string} created_at
 * @property {string} updated_at
 */

/**
 * @typedef {Object} GitHubInstallation
 * @property {string} id
 * @property {string} user_id
 * @property {number} installation_id
 * @property {string} account_login
 * @property {'User'|'Organization'} account_type
 * @property {string|null} access_token
 * @property {string|null} token_expires_at
 * @property {string} created_at
 * @property {string} updated_at
 */

/**
 * @typedef {Object} Repository
 * @property {string} id
 * @property {string} user_id
 * @property {string} installation_id
 * @property {number} github_repo_id
 * @property {string} full_name
 * @property {string} name
 * @property {string} owner
 * @property {boolean} private
 * @property {string|null} default_branch
 * @property {string} created_at
 * @property {string} updated_at
 */

/**
 * @typedef {Object} Review
 * @property {string} id
 * @property {string} user_id
 * @property {string} repository_id
 * @property {number} pr_number
 * @property {string} pr_title
 * @property {string} pr_url
 * @property {'pending'|'processing'|'completed'|'failed'} status
 * @property {object|null} result
 * @property {string} created_at
 * @property {string} updated_at
 */

export {};
