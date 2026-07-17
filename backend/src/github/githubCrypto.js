/**
 * GitHub Crypto Utility — AES-256-GCM
 *
 * Provides symmetric encryption/decryption for OAuth tokens before they are
 * stored in the database.
 *
 * Algorithm: AES-256-GCM
 *   - 256-bit key (TOKEN_ENCRYPTION_KEY — 64 hex chars)
 *   - 96-bit random IV per encryption (12 bytes)
 *   - 128-bit auth tag (GCM integrity verification)
 *
 * Storage format (single string, colon-separated):
 *   <iv_hex>:<authTag_hex>:<ciphertext_hex>
 *
 * NEVER:
 *   - Store the encryption key in the database
 *   - Return decrypted tokens to the frontend
 *   - Log decrypted token values
 */

import crypto from 'crypto';
import githubConfig from './githubConfig.js';

const ALGORITHM  = 'aes-256-gcm';
const IV_LENGTH  = 12; // bytes — recommended for GCM
const KEY_BUFFER = Buffer.from(githubConfig.encryptionKey, 'hex'); // 32 bytes

/**
 * Encrypt a plaintext string using AES-256-GCM.
 *
 * @param {string} plaintext - The value to encrypt (e.g., OAuth access token)
 * @returns {string} Encrypted string in the format: iv:authTag:ciphertext (all hex)
 */
export const encrypt = (plaintext) => {
  if (!plaintext) throw new Error('[githubCrypto] Cannot encrypt empty value');

  const iv     = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY_BUFFER, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  // Combine iv + authTag + ciphertext into a single storable string
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
};

/**
 * Decrypt an AES-256-GCM encrypted string.
 *
 * @param {string} encryptedString - In the format iv:authTag:ciphertext (hex)
 * @returns {string} The original plaintext value
 * @throws If the format is invalid or decryption/auth verification fails
 */
export const decrypt = (encryptedString) => {
  if (!encryptedString) throw new Error('[githubCrypto] Cannot decrypt empty value');

  const parts = encryptedString.split(':');
  if (parts.length !== 3) {
    throw new Error('[githubCrypto] Invalid encrypted string format');
  }

  const [ivHex, authTagHex, ciphertextHex] = parts;

  const iv         = Buffer.from(ivHex, 'hex');
  const authTag    = Buffer.from(authTagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, KEY_BUFFER, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(), // Throws if auth tag verification fails
  ]);

  return decrypted.toString('utf8');
};
