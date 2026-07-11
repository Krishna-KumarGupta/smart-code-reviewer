/**
 * Form Validation Utilities
 * Pure functions — no side effects, fully reusable.
 */

/**
 * Validates an email address format.
 * @param {string} email
 * @returns {string|null} Error message or null if valid
 */
export const validateEmail = (email) => {
  if (!email || !email.trim()) return 'Email is required';
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email.trim())) return 'Please enter a valid email address';
  return null;
};

/**
 * Validates a password.
 * @param {string} password
 * @returns {string|null} Error message or null if valid
 */
export const validatePassword = (password) => {
  if (!password) return 'Password is required';
  if (password.length < 8) return 'Password must be at least 8 characters';
  return null;
};

/**
 * Validates full name.
 * @param {string} name
 * @returns {string|null} Error message or null if valid
 */
export const validateFullName = (name) => {
  if (!name || !name.trim()) return 'Full name is required';
  if (name.trim().length < 2) return 'Full name must be at least 2 characters';
  return null;
};

/**
 * Validates that passwords match.
 * @param {string} password
 * @param {string} confirmPassword
 * @returns {string|null} Error message or null if valid
 */
export const validatePasswordMatch = (password, confirmPassword) => {
  if (!confirmPassword) return 'Please confirm your password';
  if (password !== confirmPassword) return 'Passwords do not match';
  return null;
};

/**
 * Validate the entire login form.
 * @param {{ email: string, password: string }} values
 * @returns {{ email?: string, password?: string }} Error map
 */
export const validateLoginForm = ({ email, password }) => {
  const errors = {};
  const emailError = validateEmail(email);
  const passwordError = validatePassword(password);
  if (emailError) errors.email = emailError;
  if (passwordError) errors.password = passwordError;
  return errors;
};

/**
 * Validate the entire register form.
 * @param {{ fullName: string, email: string, password: string, confirmPassword: string }} values
 * @returns {object} Error map
 */
export const validateRegisterForm = ({ fullName, email, password, confirmPassword }) => {
  const errors = {};
  const nameError = validateFullName(fullName);
  const emailError = validateEmail(email);
  const passwordError = validatePassword(password);
  const matchError = validatePasswordMatch(password, confirmPassword);
  if (nameError) errors.fullName = nameError;
  if (emailError) errors.email = emailError;
  if (passwordError) errors.password = passwordError;
  if (matchError) errors.confirmPassword = matchError;
  return errors;
};
