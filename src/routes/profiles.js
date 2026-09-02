import { z } from 'zod';
import { requireAuth, requireActiveSubscription } from '../middleware/auth.js';

const profileSchema = z.object({
  router_id: z.string().uuid(),
  name: z.string().min(1).max(100),
  duration_minutes: z.number().int().positive().nullable().optional(),
  data_limit_mb: z.number().int().positive().nullable().optional(),
  price: z.number().min(0).default(0),
  currency: z.string().default('UGX'),
  code_prefix: z.string().max(20).default(''),
  grace_minutes: z.number().int().min(0).default(0),
}).refine(
  (data) => data.duration_minutes != null || data.data_limit_mb != null,
  { message: 'At least one of duration_minutes or data_limit_mb is required' }
);

export default async function profileRoutes(fastify) {
  fastify.addHook('preHandler', requireAuth);
  fastify.addHook('preHandler', requireActiveSubscription);

  // List profiles for a router
  fastify.get('/profiles', async (request, reply) => {
    const routerId = request.query.router_id;

    let query = request.supabase
      .from('profiles')
      .select('*, routers!inner(owner_id)')
      .eq('routers.owner_id', request.user.id)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (routerId) {
      query = query.eq('router_id', routerId);
    }

    const { data, error } = await query;

    if (error) {
      return reply.code(500).send({ error: error.message });
    }

    // Clean up the join
    const profiles = (data || []).map(({ routers, ...p }) => p);
    return { profiles };
  });

  // Create profile
  fastify.post('/profiles', async (request, reply) => {
    const body = profileSchema.parse(request.body);

    // Verify router belongs to owner
    const { data: router, error: routerError } = await request.supabase
      .from('routers')
      .select('id')
      .eq('id', body.router_id)
      .eq('owner_id', request.user.id)
      .single();

    if (routerError || !router) {
      return reply.code(404).send({ error: 'Router not found' });
    }

    const { data, error } = await request.supabase
      .from('profiles')
      .insert({
        router_id: body.router_id,
        name: body.name,
        duration_minutes: body.duration_minutes ?? null,
        data_limit_mb: body.data_limit_mb ?? null,
        price: body.price,
        currency: body.currency,
        code_prefix: body.code_prefix || '',
        grace_minutes: body.grace_minutes || 0,
      })
      .select()
      .single();

    if (error) {
      return reply.code(500).send({ error: error.message });
    }

    return { success: true, profile: data };
  });

  // Update profile
  fastify.patch('/profiles/:id', async (request, reply) => {
    const { id } = request.params;
    const body = profileSchema.partial().parse(request.body);

    // Ownership check via join
    const { data: existing } = await request.supabase
      .from('profiles')
      .select('id, routers!inner(owner_id)')
      .eq('id', id)
      .eq('routers.owner_id', request.user.id)
      .single();

    if (!existing) {
      return reply.code(404).send({ error: 'Profile not found' });
    }

    const { data, error } = await request.supabase
      .from('profiles')
      .update(body)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return reply.code(500).send({ error: error.message });
    }

    return { success: true, profile: data };
  });

  // Soft delete
  fastify.delete('/profiles/:id', async (request, reply) => {
    const { id } = request.params;

    const { data: existing } = await request.supabase
      .from('profiles')
      .select('id, routers!inner(owner_id)')
      .eq('id', id)
      .eq('routers.owner_id', request.user.id)
      .single();

    if (!existing) {
      return reply.code(404).send({ error: 'Profile not found' });
    }

    await request.supabase
      .from('profiles')
      .update({ is_active: false })
      .eq('id', id);

    return { success: true, message: 'Profile deactivated' };
  });
}
