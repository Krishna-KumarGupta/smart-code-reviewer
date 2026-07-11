/**
 * AuthPage
 *
 * Single authentication page with two animated tabs:
 *  - Tab 1: Login (Email + Password)
 *  - Tab 2: Register (Full Name + Email + Password + Confirm Password)
 *
 * Already authenticated users are redirected to their dashboard.
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';

import { RiMailLine, RiLockLine, RiUserLine, RiCodeSSlashLine, RiShieldCheckLine } from 'react-icons/ri';

import useAuth from '../hooks/useAuth.js';
import Input from '../components/ui/Input.jsx';
import Button from '../components/ui/Button.jsx';
import { validateLoginForm, validateRegisterForm } from '../utils/validators.js';

// ─── Tab Definitions ──────────────────────────────────────────────────────────
const TABS = { LOGIN: 'login', REGISTER: 'register' };

// ─── Animation Variants ───────────────────────────────────────────────────────
const formVariants = {
  enter: (direction) => ({
    x: direction > 0 ? 30 : -30,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
    transition: { duration: 0.25, ease: 'easeOut' },
  },
  exit: (direction) => ({
    x: direction > 0 ? -30 : 30,
    opacity: 0,
    transition: { duration: 0.2, ease: 'easeIn' },
  }),
};

// ─── Login Form ───────────────────────────────────────────────────────────────
const LoginForm = ({ onSwitchTab }) => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [values, setValues] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({});

  const handleChange = (e) => {
    const { name, value } = e.target;
    setValues((prev) => ({ ...prev, [name]: value }));
    // Clear field error on change
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: null }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Client-side validation
    const validationErrors = validateLoginForm(values);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    setLoading(true);
    const result = await login(values.email, values.password);
    setLoading(false);

    if (!result.success) {
      setErrors({ form: result.error });
      return;
    }
    // Navigation handled by App.jsx based on role
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      {/* Form-level error */}
      {errors.form && (
        <div className="px-4 py-3 rounded-xl bg-error/10 border border-error/20 text-sm text-error">
          {errors.form}
        </div>
      )}

      <Input
        id="login-email"
        name="email"
        type="email"
        label="Email Address"
        placeholder="you@example.com"
        icon={<RiMailLine />}
        value={values.email}
        onChange={handleChange}
        error={errors.email}
        autoComplete="email"
      />

      <Input
        id="login-password"
        name="password"
        type="password"
        label="Password"
        placeholder="Enter your password"
        icon={<RiLockLine />}
        value={values.password}
        onChange={handleChange}
        error={errors.password}
        autoComplete="current-password"
      />

      <Button
        type="submit"
        id="login-submit-btn"
        fullWidth
        loading={loading}
      >
        {loading ? 'Signing in...' : 'Sign In'}
      </Button>

      {/* Switch to Register */}
      <p className="text-center text-sm text-text-muted">
        Don&apos;t have an account?{' '}
        <button
          type="button"
          onClick={onSwitchTab}
          className="text-primary hover:text-primary-light font-medium transition-colors"
        >
          Register
        </button>
      </p>
    </form>
  );
};

// ─── Register Form ────────────────────────────────────────────────────────────
const RegisterForm = ({ onSwitchTab }) => {
  const { register } = useAuth();
  const [loading, setLoading] = useState(false);
  const [values, setValues] = useState({
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [errors, setErrors] = useState({});

  const handleChange = (e) => {
    const { name, value } = e.target;
    setValues((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: null }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const validationErrors = validateRegisterForm(values);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    setLoading(true);
    const result = await register(values.fullName, values.email, values.password);
    setLoading(false);

    if (!result.success) {
      setErrors({ form: result.error });
      return;
    }

    if (result.requiresConfirmation) {
      // Show inline confirmation message and switch to login tab
      setErrors({ form: 'Account created! Please check your email to confirm before logging in.' });
      onSwitchTab();
    }
    // On success with no confirmation needed, navigation handled by App.jsx via onAuthStateChange
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      {/* Form-level error */}
      {errors.form && (
        <div className="px-4 py-3 rounded-xl bg-error/10 border border-error/20 text-sm text-error">
          {errors.form}
        </div>
      )}

      <Input
        id="register-fullname"
        name="fullName"
        type="text"
        label="Full Name"
        placeholder="John Doe"
        icon={<RiUserLine />}
        value={values.fullName}
        onChange={handleChange}
        error={errors.fullName}
        autoComplete="name"
      />

      <Input
        id="register-email"
        name="email"
        type="email"
        label="Email Address"
        placeholder="you@example.com"
        icon={<RiMailLine />}
        value={values.email}
        onChange={handleChange}
        error={errors.email}
        autoComplete="email"
      />

      <Input
        id="register-password"
        name="password"
        type="password"
        label="Password"
        placeholder="Minimum 8 characters"
        icon={<RiLockLine />}
        value={values.password}
        onChange={handleChange}
        error={errors.password}
        autoComplete="new-password"
      />

      <Input
        id="register-confirm-password"
        name="confirmPassword"
        type="password"
        label="Confirm Password"
        placeholder="Repeat your password"
        icon={<RiShieldCheckLine />}
        value={values.confirmPassword}
        onChange={handleChange}
        error={errors.confirmPassword}
        autoComplete="new-password"
      />

      <Button
        type="submit"
        id="register-submit-btn"
        fullWidth
        loading={loading}
      >
        {loading ? 'Creating account...' : 'Create Account'}
      </Button>

      {/* Switch to Login */}
      <p className="text-center text-sm text-text-muted">
        Already have an account?{' '}
        <button
          type="button"
          onClick={onSwitchTab}
          className="text-primary hover:text-primary-light font-medium transition-colors"
        >
          Login
        </button>
      </p>
    </form>
  );
};

// ─── AuthPage (Main) ──────────────────────────────────────────────────────────
const AuthPage = () => {
  const { user, profile, loading } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState(TABS.LOGIN);
  const [direction, setDirection] = useState(1);

  // Redirect authenticated users to their dashboard
  useEffect(() => {
    if (!loading && user && profile) {
      if (profile.role === 'admin') {
        navigate('/admin', { replace: true });
      } else {
        navigate('/home', { replace: true });
      }
    }
  }, [user, profile, loading, navigate]);

  const switchTab = (tab) => {
    setDirection(tab === TABS.REGISTER ? 1 : -1);
    setActiveTab(tab);
  };

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
          <p className="text-text-muted text-sm mt-1">AI-powered GitHub PR Reviews</p>
        </div>

        {/* Auth Card */}
        <div className="glass-card overflow-hidden">
          {/* Tab Switcher */}
          <div className="flex border-b border-border">
            {[
              { key: TABS.LOGIN, label: 'Sign In' },
              { key: TABS.REGISTER, label: 'Create Account' },
            ].map((tab) => (
              <button
                key={tab.key}
                id={`auth-tab-${tab.key}`}
                onClick={() => switchTab(tab.key)}
                className={`
                  relative flex-1 py-4 text-sm font-semibold transition-all duration-200
                  ${activeTab === tab.key
                    ? 'text-primary'
                    : 'text-text-muted hover:text-text-primary'
                  }
                `}
              >
                {tab.label}
                {/* Active tab indicator */}
                {activeTab === tab.key && (
                  <motion.div
                    layoutId="tab-underline"
                    className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary to-accent"
                    initial={false}
                    transition={{ type: 'spring', stiffness: 400, damping: 35 }}
                  />
                )}
              </button>
            ))}
          </div>

          {/* Animated Form Area */}
          <div className="p-8 overflow-hidden">
            <AnimatePresence mode="wait" custom={direction}>
              <motion.div
                key={activeTab}
                custom={direction}
                variants={formVariants}
                initial="enter"
                animate="center"
                exit="exit"
              >
                {activeTab === TABS.LOGIN ? (
                  <LoginForm onSwitchTab={() => switchTab(TABS.REGISTER)} />
                ) : (
                  <RegisterForm onSwitchTab={() => switchTab(TABS.LOGIN)} />
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-text-muted mt-6">
          By continuing, you agree to our{' '}
          <span className="text-text-secondary cursor-pointer hover:text-primary transition-colors">
            Terms of Service
          </span>{' '}
          and{' '}
          <span className="text-text-secondary cursor-pointer hover:text-primary transition-colors">
            Privacy Policy
          </span>
        </p>
      </motion.div>
    </div>
  );
};

export default AuthPage;
