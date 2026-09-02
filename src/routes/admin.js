import { z } from 'zod';
import { supabase, createUserClient } from '../db/supabase.js';

/**
 * Admin routes for the super admin dashboard + manual (cash) subscription management.
 *
 * Two ways in:
 *   1. Header: X-Admin-Secret: <ADMIN_SECRET from env>  (for scripts/curl)
 *   2. Logged-in Supabase user whose owners.role = 'admin'  (for the dashboard UI)
 */
// Tighter than the global 100/min limit — admin endpoints are low-traffic
// (you, not customers) and the X-Admin-Secret path is exactly what you'd
// want to slow down against brute-forcing.
const adminRateLimit = { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } };

export default async function adminRoutes(fastify) {
  fastify.addHook('preHandler', async (request, reply) => {
    const secret = request.headers['x-admin-secret'];
    if (process.env.ADMIN_SECRET && secret === process.env.ADMIN_SECRET) {
      return; // header-based access, no user context needed
    }

    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'Provide X-Admin-Secret header or a Bearer token for an admin account',
      });
    }

    const token = authHeader.slice(7);
    const userSupabase = createUserClient(token);
    const { data: { user }, error: userError } = await userSupabase.auth.getUser(token);

    if (userError || !user) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Invalid or expired token' });
    }

    const { data: owner, error: ownerError } = await supabase
      .from('owners')
      .select('role')
      .eq('id', user.id)
      .single();

    if (ownerError || !owner || owner.role !== 'admin') {
      return reply.code(403).send({ error: 'Forbidden', message: 'Admin role required' });
    }

    request.user = user;
  });

  /**
   * GET /admin/stats
   * Quick counts for the dashboard header.
   */
  fastify.get('/admin/stats', adminRateLimit, async (request, reply) => {
    const [owners, routers, vouchers, activeVouchers] = await Promise.all([
      supabase.from('owners').select('id', { count: 'exact', head: true }),
      supabase.from('routers').select('id', { count: 'exact', head: true }),
      supabase.from('vouchers').select('id', { count: 'exact', head: true }),
      supabase.from('vouchers').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    ]);

    return {
      owners: owners.count || 0,
      routers: routers.count || 0,
      vouchers: vouchers.count || 0,
      active_vouchers: activeVouchers.count || 0,
    };
  });

  /**
   * GET /admin/routers
   * List all routers across all owners.
   */
  fastify.get('/admin/routers', adminRateLimit, async (request, reply) => {
    const { data, error } = await supabase
      .from('routers')
      .select('id, label, host, status, owner_id, owners(email, full_name), created_at')
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) {
      return reply.code(500).send({ error: error.message });
    }

    return { routers: data };
  });

  /**
   * GET /admin/owners
   * List all owners (for you to manage subscriptions)
   */
  fastify.get('/admin/owners', adminRateLimit, async (request, reply) => {
    const { data, error } = await supabase
      .from('owners')
      .select('id, email, full_name, subscription_status, trial_ends_at, created_at')
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) {
      return reply.code(500).send({ error: error.message });
    }

    return { owners: data };
  });

  /**
   * PATCH /admin/owners/:id/subscription
   * Manually set subscription status after cash payment.
   */
  const subscriptionSchema = z.object({
    status: z.enum(['trial', 'active', 'expired']),
    // Optional: extend trial or set a note
    trial_ends_at: z.string().datetime().optional().nullable(),
  });

  fastify.patch('/admin/owners/:id/subscription', adminRateLimit, async (request, reply) => {
    const { id } = request.params;
    const body = subscriptionSchema.parse(request.body);

    const update = {
      subscription_status: body.status,
    };

    if (body.trial_ends_at !== undefined) {
      update.trial_ends_at = body.trial_ends_at;
    }

    // If activating from cash payment, clear any old trial end
    if (body.status === 'active' && body.trial_ends_at === undefined) {
      update.trial_ends_at = null;
    }

    const { data, error } = await supabase
      .from('owners')
      .update(update)
      .eq('id', id)
      .select('id, email, full_name, subscription_status, trial_ends_at')
      .single();

    if (error) {
      return reply.code(500).send({ error: error.message });
    }

    if (!data) {
      return reply.code(404).send({ error: 'Owner not found' });
    }

    return {
      success: true,
      message: `Subscription set to "${body.status}"`,
      owner: data,
    };
  });
}
