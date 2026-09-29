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

if (process.env.NODE_ENV === 'production') {
  const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'ENCRYPTION_KEY', 'APP_URL', 'BUSINESS_NAME', 'BUSINESS_EMAIL'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`Missing required production environment variables: ${missing.join(', ')}`);
}

const app = Fastify({ logger: { level: process.env.NODE_ENV === 'production' ? 'info' : 'debug' }, trustProxy: true, bodyLimit: 1024 * 1024 });

await app.register(helmet, {
  contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'", 'https://cdn.jsdelivr.net'], styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:'], connectSrc: ["'self'", ...(process.env.SUPABASE_URL ? [process.env.SUPABASE_URL, process.env.SUPABASE_URL.replace(/^https:/, 'wss:')] : [])],
    fontSrc: ["'self'"], objectSrc: ["'none'"], baseUri: ["'self'"], frameAncestors: ["'self'"],
  }},
});
await app.register(cors, {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    const allowed = new Set([process.env.APP_URL, process.env.NODE_ENV === 'production' ? null : 'http://localhost:3000', process.env.NODE_ENV === 'production' ? null : 'http://127.0.0.1:3000'].filter(Boolean));
    cb(null, allowed.has(origin));
  }, credentials: true,
});
await app.register(rateLimit, { max: 100, timeWindow: '1 minute', addHeaders: { 'x-ratelimit-limit': true, 'x-ratelimit-remaining': true, 'x-ratelimit-reset': true } });

app.get('/config.js', async (request, reply) => {
  reply.header('Cache-Control', 'no-store').type('application/javascript').send(
    `window.SUPABASE_URL=${JSON.stringify(process.env.SUPABASE_URL || '')};\n` +
    `window.SUPABASE_ANON_KEY=${JSON.stringify(process.env.SUPABASE_ANON_KEY || '')};\n` +
    `window.BUSINESS_NAME=${JSON.stringify(process.env.BUSINESS_NAME || 'WiFi Voucher')};\n` +
    `window.BUSINESS_EMAIL=${JSON.stringify(process.env.BUSINESS_EMAIL || '')};\n` +
    `window.BUSINESS_PHONE=${JSON.stringify(process.env.BUSINESS_PHONE || '')};\n` +
    `window.BUSINESS_ADDRESS=${JSON.stringify(process.env.BUSINESS_ADDRESS || '')};\n`
  );
});
app.get('/health', async () => ({ status: 'ok', time: new Date().toISOString(), service: 'wifi-voucher-mvp' }));
await app.register(authRoutes);
await app.register(routerRoutes);
await app.register(profileRoutes);
await app.register(voucherRoutes);
await app.register(adminRoutes);
await app.register(billingRoutes);
await app.register(momoWebhookRoutes);
await app.register(fastifyStatic, { root: join(__dirname, '..', 'public'), prefix: '/', wildcard: false });

app.setErrorHandler((error, request, reply) => {
  request.log.error(error);
  if (error.name === 'ZodError') return reply.code(400).send({ error: 'Validation failed', details: error.errors });
  const status = error.statusCode || 500;
  const safeMessage = status >= 500 && process.env.NODE_ENV === 'production' ? 'Internal server error' : (error.message || 'Request failed');
  reply.code(status).send({ error: safeMessage, code: error.code || undefined });
});

const port = Number(process.env.PORT) || 3000;
try { await app.listen({ port, host: '0.0.0.0' }); console.log(`WiFi Voucher running on port ${port}`); }
catch (err) { app.log.error(err); process.exit(1); }
