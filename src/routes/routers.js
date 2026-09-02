import { z } from 'zod';
import { encrypt, decrypt } from '../utils/encryption.js';
import { testConnection } from '../services/mikrotik.js';
import { requireAuth, requireActiveSubscription } from '../middleware/auth.js';

const addRouterSchema = z.object({
  label: z.string().min(1).max(100),
  host: z.string().min(1).max(255),
  api_port: z.number().int().min(1).max(65535).default(8728),
  api_username: z.string().min(1).max(100),
  api_password: z.string().min(1).max(200),
});

export default async function routerRoutes(fastify) {
  // All router routes require auth + active/trial subscription
  fastify.addHook('preHandler', requireAuth);
  fastify.addHook('preHandler', requireActiveSubscription);

  /**
   * POST /routers/test
   * Test credentials WITHOUT saving. Critical for reliability UX.
   */
  fastify.post('/routers/test', async (request, reply) => {
    const body = addRouterSchema.parse(request.body);

    try {
      const result = await testConnection({
        host: body.host,
        port: body.api_port,
        username: body.api_username,
        password: body.api_password,
      });

      return {
        success: true,
        message: 'Successfully connected to the router',
        router: result,
      };
    } catch (err) {
      return reply.code(400).send({
        success: false,
        error: 'Connection failed',
        message: err.message,
        code: err.code || 'CONNECTION_ERROR',
      });
    }
  });

  /**
   * POST /routers
   * Add a new router — only after successful connection test.
   */
  fastify.post('/routers', async (request, reply) => {
    const body = addRouterSchema.parse(request.body);

    // 0. Reject obvious duplicates early — before wasting time on a live test
    const { data: existing } = await request.supabase
      .from('routers')
      .select('id, label')
      .eq('owner_id', request.user.id)
      .eq('host', body.host)
      .eq('api_port', body.api_port)
      .maybeSingle();

    if (existing) {
      return reply.code(409).send({
        success: false,
        error: 'Duplicate router',
        message: `You already have a router saved for ${body.host}:${body.api_port} (labeled "${existing.label}"). Delete it first if you want to re-add it.`,
      });
    }

    // 1. Mandatory live test
    let testResult;
    try {
      testResult = await testConnection({
        host: body.host,
        port: body.api_port,
        username: body.api_username,
        password: body.api_password,
      });
    } catch (err) {
      return reply.code(400).send({
        success: false,
        error: 'Cannot save router — connection test failed',
        message: err.message,
        hint: 'Fix the connection first, then try again. We never save unreachable routers.',
      });
    }

    // 2. Encrypt password
    const encryptedPassword = encrypt(body.api_password);

    // 3. Save
    const { data, error } = await request.supabase
      .from('routers')
      .insert({
        owner_id: request.user.id,
        label: body.label,
        host: body.host,
        api_port: body.api_port,
        api_username: body.api_username,
        api_password_encrypted: encryptedPassword,
        last_connected_at: new Date().toISOString(),
        status: 'connected',
      })
      .select('id, label, host, api_port, api_username, last_connected_at, status, created_at')
      .single();

    if (error) {
      // Race condition: another request created the same router between our check and this insert
      if (error.code === '23505') {
        return reply.code(409).send({
          success: false,
          error: 'Duplicate router',
          message: 'This router was just added (possibly from a duplicate submission). Refresh your router list.',
        });
      }
      return reply.code(500).send({
        error: 'Failed to save router',
        message: error.message,
      });
    }

    return {
      success: true,
      message: 'Router connected and saved successfully',
      router: data,
      test: testResult,
    };
  });

  /**
   * GET /routers
   */
  fastify.get('/routers', async (request, reply) => {
    const { data, error } = await request.supabase
      .from('routers')
      .select('id, label, host, api_port, api_username, last_connected_at, status, created_at')
      .eq('owner_id', request.user.id)
      .order('created_at', { ascending: false });

    if (error) {
      return reply.code(500).send({ error: error.message });
    }

    return { routers: data };
  });

  /**
   * POST /routers/:id/retest
   * One-click re-test of an existing router.
   */
  fastify.post('/routers/:id/retest', async (request, reply) => {
    const { id } = request.params;

    const { data: router, error } = await request.supabase
      .from('routers')
      .select('*')
      .eq('id', id)
      .eq('owner_id', request.user.id)
      .single();

    if (error || !router) {
      return reply.code(404).send({ error: 'Router not found' });
    }

    let password;
    try {
      password = decrypt(router.api_password_encrypted);
    } catch (e) {
      return reply.code(500).send({ error: 'Failed to decrypt credentials' });
    }

    try {
      const result = await testConnection({
        host: router.host,
        port: router.api_port,
        username: router.api_username,
        password,
      });

      // Update status
      await request.supabase
        .from('routers')
        .update({
          status: 'connected',
          last_connected_at: new Date().toISOString(),
        })
        .eq('id', id);

      return {
        success: true,
        message: 'Router is reachable',
        router: result,
      };
    } catch (err) {
      await request.supabase
        .from('routers')
        .update({ status: 'unreachable' })
        .eq('id', id);

      return reply.code(400).send({
        success: false,
        error: 'Router is currently unreachable',
        message: err.message,
      });
    }
  });

  /**
   * DELETE /routers/:id
   */
  fastify.delete('/routers/:id', async (request, reply) => {
    const { id } = request.params;

    const { error } = await request.supabase
      .from('routers')
      .delete()
      .eq('id', id)
      .eq('owner_id', request.user.id);

    if (error) {
      return reply.code(500).send({ error: error.message });
    }

    return { success: true, message: 'Router deleted' };
  });
}
