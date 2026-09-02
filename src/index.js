import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

import routerRoutes from './routes/routers.js';
import profileRoutes from './routes/profiles.js';
import voucherRoutes from './routes/vouchers.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import billingRoutes from './routes/billing.js';
import momoWebhookRoutes from './routes/momo-webhook.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  },
  trustProxy: true,
});

// Security & CORS
await app.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // supabase-js is loaded from jsdelivr; no other inline/external scripts used
      scriptSrc: ["'self'", 'https://cdn.jsdelivr.net'],
      // index.html uses inline style="" attributes, so 'unsafe-inline' is needed here
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      // API calls + realtime go to the Supabase project itself
      connectSrc: ["'self'", 'https://brpkuuptddkefosunhul.supabase.co', 'wss://brpkuuptddkefosunhul.supabase.co'],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'self'"],
    },
  },
});
await app.register(cors, {
  origin: true,
  credentials: true,
});

// Rate limiting — global baseline, tighter caps on sensitive routes below
await app.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
  addHeaders: {
    'x-ratelimit-limit': true,
    'x-ratelimit-remaining': true,
    'x-ratelimit-reset': true,
  },
});

// Health check (important for Render)
app.get('/health', async () => ({
  status: 'ok',
  time: new Date().toISOString(),
  service: 'wifi-voucher-mvp',
}));

// API routes FIRST so they are not swallowed by static
await app.register(authRoutes);
await app.register(routerRoutes);
await app.register(profileRoutes);
await app.register(voucherRoutes);
await app.register(adminRoutes);
await app.register(billingRoutes);
await app.register(momoWebhookRoutes);

// Static frontend (after API routes)
await app.register(fastifyStatic, {
  root: join(__dirname, '..', 'public'),
  prefix: '/',
  wildcard: false,
});

// Global error handler — never leak stack traces in production
app.setErrorHandler((error, request, reply) => {
  request.log.error(error);

  // Zod validation errors
  if (error.name === 'ZodError') {
    return reply.code(400).send({
      error: 'Validation failed',
      details: error.errors,
    });
  }

  const status = error.statusCode || 500;
  reply.code(status).send({
    error: error.message || 'Internal server error',
    code: error.code || undefined,
  });
});

const port = Number(process.env.PORT) || 3000;
const host = '0.0.0.0';

try {
  await app.listen({ port, host });
  console.log(`✅ WiFi Voucher MVP running on http://${host}:${port}`);
  console.log(`   Health: http://${host}:${port}/health`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
