/**
 * ResetPasswordPage
 *
 * Users land here after clicking the password-reset link in their email.
 * Supabase automatically exchanges the token in the URL hash for a session,
 * which triggers onAuthStateChange with event = 'PASSWORD_RECOVERY'.
 *
 * Flow:
 *   1. Page mounts → listen for PASSWORD_RECOVERY event
 *   2. Show "Set New Password" form
 *   3. On submit → call supabase.auth.updateUser({ password })
 *   4. On success → toast + redirect to /
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';

import { RiLockLine, RiShieldCheckLine, RiCodeSSlashLine, RiAlertLine } from 'react-icons/ri';

import useAuth from '../hooks/useAuth.js';
import Input from '../components/ui/Input.jsx';
import Button from '../components/ui/Button.jsx';
import { validatePassword, validatePasswordMatch } from '../utils/validators.js';
import supabase from '../services/supabase.js';

const ResetPasswordPage = () => {
  const { resetPassword } = useAuth();
  const navigate = useNavigate();

  const [ready, setReady] = useState(false);   // true once PASSWORD_RECOVERY event fires
  const [expired, setExpired] = useState(false);
  const [loading, setLoading] = useState(false);
  const [values, setValues] = useState({ password: '', confirmPassword: '' });
  const [errors, setErrors] = useState({});

  // ─── Listen for the PASSWORD_RECOVERY auth event ───────────────────────────
  useEffect(() => {
    // Give Supabase a moment to parse the URL hash and fire the event
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setReady(true);
      }
    });

    // If session already exists on mount (page refresh scenario)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setReady(true);
    });

    // Safety timeout: if no event fires in 5 s, mark as expired/invalid
    const timeout = setTimeout(() => {
      setExpired((prev) => {
        if (!ready) return true;
        return prev;
      });
    }, 5000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = (e) => {
    const { name, value } = e.target;
    setValues((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: null }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const passwordError = validatePassword(values.password);
    const matchError = validatePasswordMatch(values.password, values.confirmPassword);
    if (passwordError || matchError) {
      setErrors({ password: passwordError, confirmPassword: matchError });
      return;
    }

    setLoading(true);
    const result = await resetPassword(values.password);
    setLoading(false);

    if (!result.success) {
      setErrors({ form: result.error });
      return;
    }

    toast.success('Password updated successfully!', {
      duration: 5000,
      icon: '🔐',
    });
    navigate('/', { replace: true });
  };

  // ─── Expired / Invalid Link ────────────────────────────────────────────────
  if (expired && !ready) {
    return (
      <div className="min-h-screen bg-background bg-grid flex items-center justify-center px-4">
        <div
          className="glow-orb w-[400px] h-[400px] -top-32 -left-32 opacity-20"
          style={{ background: 'radial-gradient(circle, #ef4444, transparent 70%)' }}
        />
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="glass-card w-full max-w-sm p-8 text-center z-10 relative"
        >
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-error/10 border border-error/20 mb-4">
            <RiAlertLine className="text-error text-2xl" />
          </div>
          <h2 className="text-lg font-bold text-text-primary mb-2">Link expired or invalid</h2>
          <p className="text-sm text-text-muted mb-6">
            This password reset link is no longer valid. Please request a new one.
          </p>
          <Button
            id="back-to-login-expired"
            fullWidth
            onClick={() => navigate('/', { replace: true })}
          >
            Back to Sign In
          </Button>
        </motion.div>
      </div>
    );
  }

  // ─── Loading / Waiting for recovery event ─────────────────────────────────
  if (!ready) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <svg
            className="w-8 h-8 animate-spin text-primary"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="text-sm text-text-muted">Verifying reset link…</p>
        </div>
      </div>
    );
  }

  // ─── Main Form ─────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background bg-grid flex items-center justify-center px-4 py-12 relative overflow-hidden">
      {/* Background glow orbs */}
      <div
        className="glow-orb w-[500px] h-[500px] -top-48 -left-48 opacity-20"
        style={{ background: 'radial-gradient(circle, #6366f1, transparent 70%)' }}
      />
      <div
        className="glow-orb w-[400px] h-[400px] -bottom-32 -right-32 opacity-15"
        style={{ background: 'radial-gradient(circle, #8b5cf6, transparent 70%)' }}
      />

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="relative w-full max-w-md z-10"
      >
        {/* Logo & Heading */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-accent shadow-glow-lg mb-4">
            <RiCodeSSlashLine className="text-white text-2xl" />
          </div>
          <h1 className="text-2xl font-bold text-text-primary">
            Smart<span className="gradient-text">Review</span>
          </h1>
          <p className="text-text-muted text-sm mt-1">Set a new password for your account</p>
        </div>

        {/* Card */}
        <div className="glass-card p-8">
          <div className="mb-6">
            <h2 className="text-lg font-bold text-text-primary">Create new password</h2>
            <p className="text-sm text-text-muted mt-1">
              Choose a strong password — at least 8 characters.
            </p>
          </div>

          <form onSubmit={handleSubmit} noValidate className="space-y-5">
            {errors.form && (
              <div className="px-4 py-3 rounded-xl bg-error/10 border border-error/20 text-sm text-error">
                {errors.form}
              </div>
            )}

            <Input
              id="reset-password"
              name="password"
              type="password"
              label="New Password"
              placeholder="Minimum 8 characters"
              icon={<RiLockLine />}
              value={values.password}
              onChange={handleChange}
              error={errors.password}
              autoComplete="new-password"
            />

            <Input
              id="reset-confirm-password"
              name="confirmPassword"
              type="password"
              label="Confirm New Password"
              placeholder="Repeat your new password"
              icon={<RiShieldCheckLine />}
              value={values.confirmPassword}
              onChange={handleChange}
              error={errors.confirmPassword}
              autoComplete="new-password"
            />

            {/* Password strength hint */}
            {values.password.length > 0 && (
              <PasswordStrength password={values.password} />
            )}

            <Button type="submit" id="reset-submit-btn" fullWidth loading={loading}>
              {loading ? 'Updating password...' : 'Update Password'}
            </Button>
          </form>
        </div>
      </motion.div>
    </div>
  );
};

// ─── Password Strength Indicator ──────────────────────────────────────────────
const PasswordStrength = ({ password }) => {
  const checks = [
    { label: '8+ characters', passed: password.length >= 8 },
    { label: 'Uppercase letter', passed: /[A-Z]/.test(password) },
    { label: 'Number', passed: /[0-9]/.test(password) },
    { label: 'Special character', passed: /[^A-Za-z0-9]/.test(password) },
  ];

  const passed = checks.filter((c) => c.passed).length;
  const strength = passed <= 1 ? 'Weak' : passed <= 2 ? 'Fair' : passed === 3 ? 'Good' : 'Strong';
  const colors = {
    Weak: 'bg-red-500',
    Fair: 'bg-amber-400',
    Good: 'bg-blue-400',
    Strong: 'bg-emerald-500',
  };

  return (
    <div className="space-y-2">
      {/* Bar */}
      <div className="flex gap-1 h-1">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={`flex-1 rounded-full transition-all duration-300 ${
              i < passed ? colors[strength] : 'bg-surface-2'
            }`}
          />
        ))}
      </div>
      <div className="flex items-center justify-between">
        <div className="flex gap-3 flex-wrap">
          {checks.map((c) => (
            <span
              key={c.label}
              className={`text-xs flex items-center gap-1 ${
                c.passed ? 'text-emerald-400' : 'text-text-muted'
              }`}
            >
              <span>{c.passed ? '✓' : '·'}</span>
              {c.label}
            </span>
          ))}
        </div>
        <span
          className={`text-xs font-semibold ${
            strength === 'Strong'
              ? 'text-emerald-400'
              : strength === 'Good'
              ? 'text-blue-400'
              : strength === 'Fair'
              ? 'text-amber-400'
              : 'text-red-400'
          }`}
        >
          {strength}
        </span>
      </div>
    </div>
  );
};

export default ResetPasswordPage;
