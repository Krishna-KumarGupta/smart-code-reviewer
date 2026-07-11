/**
 * NotFoundPage — 404
 * Shown when a user navigates to a non-existent route.
 */

import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { RiHome4Line, RiCodeSSlashLine } from 'react-icons/ri';
import useAuth from '../hooks/useAuth.js';

const NotFoundPage = () => {
  const { isAuthenticated, isAdmin } = useAuth();
  const homeLink = isAdmin ? '/admin' : isAuthenticated ? '/home' : '/';

  return (
    <div className="min-h-screen bg-background bg-grid flex items-center justify-center px-4 relative overflow-hidden">
      {/* Background glow */}
      <div
        className="glow-orb w-[400px] h-[400px] -top-20 left-1/2 -translate-x-1/2 opacity-10"
        style={{ background: 'radial-gradient(circle, #6366f1, transparent 70%)' }}
      />

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="text-center relative z-10"
      >
        {/* Logo */}
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-accent shadow-glow-lg mb-8">
          <RiCodeSSlashLine className="text-white text-3xl" />
        </div>

        {/* 404 Number */}
        <h1 className="text-8xl font-black gradient-text mb-4 leading-none">404</h1>

        {/* Message */}
        <h2 className="text-2xl font-bold text-text-primary mb-3">Page Not Found</h2>
        <p className="text-text-muted text-sm max-w-sm mx-auto leading-relaxed mb-8">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
          Let&apos;s get you back on track.
        </p>

        {/* Return Home Button */}
        <Link
          to={homeLink}
          className="
            inline-flex items-center gap-2
            px-6 py-3
            bg-gradient-to-r from-primary to-primary-hover
            text-white text-sm font-semibold
            rounded-xl
            transition-all duration-200
            hover:shadow-glow hover:-translate-y-0.5
            active:translate-y-0
          "
          id="not-found-home-btn"
        >
          <RiHome4Line className="text-base" />
          Return to Dashboard
        </Link>
      </motion.div>
    </div>
  );
};

export default NotFoundPage;
