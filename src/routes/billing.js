import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';

// Intentionally NOT gated by requireActiveSubscription — an owner
// whose subscription just expired still needs to see how to pay.
const momoNameSchema = z.object({
  momo_registered_name: z.string().trim().min(2).max(100),
});

export default async function billingRoutes(fastify) {
  fastify.addHook('preHandler', requireAuth);

  // What to pay, and whether the name we'll match against is set.
  fastify.get('/billing/momo-info', async (request, reply) => {
    const { data: owner, error } = await request.supabase
      .from('owners')
      .select('subscription_status, subscription_paid_until, momo_registered_name')
      .eq('id', request.user.id)
      .single();

    if (error || !owner) {
      return reply.code(404).send({ error: 'Owner profile not found' });
    }

    return reply.send({
      amount_ugx: Number(process.env.SUBSCRIPTION_PRICE_UGX || 0),
      momo_registered_name: owner.momo_registered_name,
      subscription_status: owner.subscription_status,
      subscription_paid_until: owner.subscription_paid_until,
      instructions: owner.momo_registered_name
        ? `Send the subscription fee via Mobile Money from the account registered as "${owner.momo_registered_name}". It's applied automatically within a few minutes.`
        : 'Set the name your Mobile Money account sends under (below) before paying — that name is how we recognize your payment automatically.',
    });
  });

  // Set (or correct) the name that shows up in the MoMo SMS.
  fastify.put('/billing/momo-name', async (request, reply) => {
    const parsed = momoNameSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', details: parsed.error.errors });
    }

    const { error } = await request.supabase
      .from('owners')
      .update({ momo_registered_name: parsed.data.momo_registered_name })
      .eq('id', request.user.id);

    if (error) {
      return reply.code(500).send({ error: 'Could not save name' });
    }

    return reply.send({ ok: true, momo_registered_name: parsed.data.momo_registered_name });
  });
}
