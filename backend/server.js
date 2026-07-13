/**
 * Express Server — Smart Code Reviewer Backend
 * Entry point for the API server.
 *
 * Middleware stack (order matters):
 *   1. helmet      — security headers
 *   2. morgan      — request logging
 *   3. cors        — cross-origin policy
 *   4. body parser — JSON + urlencoded
 *   5. routes      — API route handlers
 *   6. notFound    — 404 catcher (must be after routes)
 *   7. errorHandler — global error formatter (must be last)
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

import profileRoutes from './src/routes/profile.js';
import adminRoutes   from './src/routes/admin.js';
import githubRoutes  from './src/github/routes/githubRoutes.js';
import notFound      from './src/middleware/notFound.js';
import errorHandler  from './src/middleware/errorHandler.js';

const app  = express();
const PORT = process.env.PORT || 5000;

// ─── Security & Logging ───────────────────────────────────────────────────────
app.use(helmet());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ─── CORS ─────────────────────────────────────────────────────────────────────
app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// ─── Body Parser ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10kb' }));       // Limit body size for security
app.use(express.urlencoded({ extended: true }));

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'smart-code-reviewer-api',
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
  });
});

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api', profileRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/github', githubRoutes);

// ─── 404 — must be after all routes ──────────────────────────────────────────
app.use(notFound);

// ─── Global Error Handler — must be last ─────────────────────────────────────
app.use(errorHandler);

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 Server running on http://localhost:${PORT}`);
  console.log(`   Environment : ${process.env.NODE_ENV || 'development'}`);
  console.log(`   CORS Origin : ${process.env.FRONTEND_URL || 'http://localhost:5173'}`);
  console.log(`   Health      : http://localhost:${PORT}/health\n`);
});

export default app;
