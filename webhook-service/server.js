import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import webhookRoutes from './src/routes/webhookRoutes.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;

// ─── Middleware ──────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors());
app.use(morgan('dev'));

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'OK', service: 'webhook-service' });
});

// ─── Webhook Routing ──────────────────────────────────────────────────────────
// Mounted at /api/github matching original path: /api/github/webhook
app.use('/api/github', webhookRoutes);

// ─── Error Handling ───────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[Webhook Service Error]', err.message);
  res.status(err.statusCode || 500).json({
    success: false,
    error: 'Internal server error',
  });
});

// ─── Start server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Webhook Service running on http://localhost:${PORT}`);
  console.log(`Webhook endpoint: http://localhost:${PORT}/api/github/webhook`);
});
