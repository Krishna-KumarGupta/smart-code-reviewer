/**
 * AuthPage
 *
 * Single authentication page with three views:
 *  - View 1: Login        (Email + Password)
 *  - View 2: Register     (Full Name + Email + Password + Confirm Password)
 *  - View 3: ForgotPwd    (Email — sends reset link)
 *
 * Already authenticated users are redirected to their dashboard.
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';

import {
  RiMailLine,
  RiLockLine,
  RiUserLine,
  RiCodeSSlashLine,
  RiShieldCheckLine,
  RiArrowLeftLine,
  RiMailSendLine,
} from 'react-icons/ri';

import useAuth from '../hooks/useAuth.js';
import Input from '../components/ui/Input.jsx';
import Button from '../components/ui/Button.jsx';
import { validateLoginForm, validateRegisterForm, validateEmail } from '../utils/validators.js';

// ─── View Keys ────────────────────────────────────────────────────────────────
const VIEWS = { LOGIN: 'login', REGISTER: 'register', FORGOT: 'forgot' };

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
const LoginForm = ({ onSwitchToRegister, onForgotPassword }) => {
  const { login } = useAuth();
  const [loading, setLoading] = useState(false);
  const [values, setValues] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({});

  const handleChange = (e) => {
    const { name, value } = e.target;
    setValues((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: null }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
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
    }
    // Navigation handled by App.jsx based on role
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
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

      <div>
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
        {/* Forgot password link */}
        <div className="mt-1.5 flex justify-end">
          <button
            type="button"
            id="forgot-password-link"
            onClick={onForgotPassword}
            className="text-xs text-text-muted hover:text-primary transition-colors font-medium"
          >
            Forgot password?
          </button>
        </div>
      </div>

      <Button type="submit" id="login-submit-btn" fullWidth loading={loading}>
        {loading ? 'Signing in...' : 'Sign In'}
      </Button>

      <p className="text-center text-sm text-text-muted">
        Don&apos;t have an account?{' '}
        <button
          type="button"
          onClick={onSwitchToRegister}
          className="text-primary hover:text-primary-light font-medium transition-colors"
        >
          Register
        </button>
      </p>
    </form>
  );
};

// ─── Register Form ────────────────────────────────────────────────────────────
const RegisterForm = ({ onSwitchToLogin }) => {
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
      toast.success('Account created! Please check your email to confirm before logging in.', {
        duration: 6000,
        icon: '🎉',
      });
      onSwitchToLogin();
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
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

      <Button type="submit" id="register-submit-btn" fullWidth loading={loading}>
        {loading ? 'Creating account...' : 'Create Account'}
      </Button>

      <p className="text-center text-sm text-text-muted">
        Already have an account?{' '}
        <button
          type="button"
          onClick={onSwitchToLogin}
          className="text-primary hover:text-primary-light font-medium transition-colors"
        >
          Login
        </button>
      </p>
    </form>
  );
};

// ─── Forgot Password Form ─────────────────────────────────────────────────────
const ForgotPasswordForm = ({ onBack }) => {
  const { forgotPassword } = useAuth();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const emailError = validateEmail(email);
    if (emailError) {
      setError(emailError);
      return;
    }
    setLoading(true);
    const result = await forgotPassword(email);
    setLoading(false);

    if (!result.success) {
      setError(result.error);
      return;
    }
    setSent(true);
  };

  // ── Success State ──
  if (sent) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="flex flex-col items-center text-center gap-4 py-4"
      >
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/20 to-accent/20 border border-primary/30 mb-2">
          <RiMailSendLine className="text-primary text-3xl" />
        </div>
        <h2 className="text-lg font-bold text-text-primary">Check your inbox</h2>
        <p className="text-sm text-text-muted leading-relaxed">
          We sent a password reset link to{' '}
          <span className="text-text-primary font-medium">{email}</span>.
          <br />
          The link expires in 1 hour.
        </p>
        <p className="text-xs text-text-muted">
          Didn&apos;t receive it? Check your spam folder or{' '}
          <button
            type="button"
            onClick={() => setSent(false)}
            className="text-primary hover:text-primary-light font-medium transition-colors"
          >
            try again
          </button>
          .
        </p>
        <button
          type="button"
          onClick={onBack}
          className="mt-2 inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-primary transition-colors font-medium"
        >
          <RiArrowLeftLine />
          Back to Sign In
        </button>
      </motion.div>
    );
  }

  // ── Input State ──
  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      {/* Header */}
      <div className="mb-1">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-primary transition-colors mb-4 font-medium"
        >
          <RiArrowLeftLine />
          Back to Sign In
        </button>
        <h2 className="text-lg font-bold text-text-primary">Reset your password</h2>
        <p className="text-sm text-text-muted mt-1">
          Enter your email and we&apos;ll send you a link to reset your password.
        </p>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-xl bg-error/10 border border-error/20 text-sm text-error">
          {error}
        </div>
      )}

      <Input
        id="forgot-email"
        name="email"
        type="email"
        label="Email Address"
        placeholder="you@example.com"
        icon={<RiMailLine />}
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          if (error) setError(null);
        }}
        error={null}
        autoComplete="email"
      />

      <Button type="submit" id="forgot-submit-btn" fullWidth loading={loading}>
        {loading ? 'Sending link...' : 'Send Reset Link'}
      </Button>
    </form>
  );
};

// ─── AuthPage (Main) ──────────────────────────────────────────────────────────
const AuthPage = () => {
  const { user, profile, loading } = useAuth();
  const navigate = useNavigate();
  const [activeView, setActiveView] = useState(VIEWS.LOGIN);
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

  const switchView = (view, dir = 1) => {
    setDirection(dir);
    setActiveView(view);
  };

  // Whether to show the tab bar (hidden when in forgot-password view)
  const showTabs = activeView !== VIEWS.FORGOT;

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
          {/* Tab Switcher — hidden in forgot-password view */}
          <AnimatePresence>
            {showTabs && (
              <motion.div
                key="tabs"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="flex border-b border-border overflow-hidden"
              >
                {[
                  { key: VIEWS.LOGIN, label: 'Sign In' },
                  { key: VIEWS.REGISTER, label: 'Create Account' },
                ].map((tab) => (
                  <button
                    key={tab.key}
                    id={`auth-tab-${tab.key}`}
                    onClick={() =>
                      switchView(tab.key, tab.key === VIEWS.REGISTER ? 1 : -1)
                    }
                    className={`
                      relative flex-1 py-4 text-sm font-semibold transition-all duration-200
                      ${activeView === tab.key
                        ? 'text-primary'
                        : 'text-text-muted hover:text-text-primary'
                      }
                    `}
                  >
                    {tab.label}
                    {activeView === tab.key && (
                      <motion.div
                        layoutId="tab-underline"
                        className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary to-accent"
                        initial={false}
                        transition={{ type: 'spring', stiffness: 400, damping: 35 }}
                      />
                    )}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Animated Form Area */}
          <div className="p-8 overflow-hidden">
            <AnimatePresence mode="wait" custom={direction}>
              <motion.div
                key={activeView}
                custom={direction}
                variants={formVariants}
                initial="enter"
                animate="center"
                exit="exit"
              >
                {activeView === VIEWS.LOGIN && (
                  <LoginForm
                    onSwitchToRegister={() => switchView(VIEWS.REGISTER, 1)}
                    onForgotPassword={() => switchView(VIEWS.FORGOT, 1)}
                  />
                )}
                {activeView === VIEWS.REGISTER && (
                  <RegisterForm
                    onSwitchToLogin={() => switchView(VIEWS.LOGIN, -1)}
                  />
                )}
                {activeView === VIEWS.FORGOT && (
                  <ForgotPasswordForm
                    onBack={() => switchView(VIEWS.LOGIN, -1)}
                  />
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
