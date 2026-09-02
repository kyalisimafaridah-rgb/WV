import crypto from 'crypto';
import momoMatcher from '../lib/momo-sms-billing/matcher.cjs';
import { momoStorageAdapter } from '../services/momo-storage-adapter.js';

const { processInboundMomoSms } = momoMatcher;

/**
 * This endpoint is hit by the relay app on the phone that receives
 * your MTN/Airtel SMS notifications — not by owners or their browsers.
 * It has no JWT (the relay app isn't a logged-in user), so it's
 * protected by a shared secret header instead. Keep MOMO_SMS_WEBHOOK_SECRET
 * out of version control and only in the relay app's config.
 */
export default async function momoWebhookRoutes(fastify) {
  fastify.post('/webhooks/momo-sms', {
    // Tighter than the global limit — this is a single relay app, not
    // a browser, so normal traffic is low and a spike likely means abuse.
    config: {
      rateLimit: {
        max: 30,
        timeWindow: '1 minute',
      },
    },
  }, async (request, reply) => {
    const expectedSecret = process.env.MOMO_SMS_WEBHOOK_SECRET;

    if (!expectedSecret) {
      request.log.error('MOMO_SMS_WEBHOOK_SECRET is not configured');
      return reply.code(503).send({ error: 'Webhook not configured' });
    }

    const providedSecret = request.headers['x-momo-secret'];
    const expectedBuf = Buffer.from(expectedSecret);
    const providedBuf = Buffer.from(typeof providedSecret === 'string' ? providedSecret : '');

    const secretValid =
      expectedBuf.length === providedBuf.length && crypto.timingSafeEqual(expectedBuf, providedBuf);

    if (!secretValid) {
      return reply.code(401).send({ error: 'Invalid or missing X-Momo-Secret header' });
    }

    const { rawBody, network } = request.body || {};

    if (!rawBody || !network) {
      return reply.code(400).send({ error: 'rawBody and network are required' });
    }
    if (network !== 'mtn' && network !== 'airtel') {
      return reply.code(400).send({ error: 'network must be "mtn" or "airtel"' });
    }

    try {
      const result = await processInboundMomoSms(rawBody, network, momoStorageAdapter);
      // Always 200 once we've processed it (even no_match/ambiguous) —
      // the relay app just needs to know "delivered", not "matched".
      // Non-2xx would make it retry-storm on legitimately unmatched SMS.
      return reply.code(200).send(result);
    } catch (err) {
      request.log.error(err, 'momo-sms processing failed');
      return reply.code(500).send({ error: 'Processing failed' });
    }
  });
}
