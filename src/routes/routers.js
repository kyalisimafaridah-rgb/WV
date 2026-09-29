import { z } from 'zod';
import { encrypt, decrypt } from '../utils/encryption.js';
import { testConnection, deleteHotspotUsers } from '../services/mikrotik.js';
import { requireAuth, requireActiveSubscription } from '../middleware/auth.js';
import { supabase } from '../db/supabase.js';

const addRouterSchema = z.object({
  label: z.string().min(1).max(100),
  host: z.string().min(1).max(255),
  api_port: z.number().int().min(1).max(65535).default(8729),
  api_tls: z.boolean().optional(),
  api_username: z.string().min(1).max(100),
  api_password: z.string().min(1).max(200),
});

export default async function routerRoutes(fastify) {
  fastify.addHook('preHandler', requireAuth);
  fastify.addHook('preHandler', requireActiveSubscription);

  fastify.post('/routers/test', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const body = addRouterSchema.parse(request.body);
    const apiTls = body.api_tls ?? body.api_port === 8729;
    try {
      const result = await testConnection({ host: body.host, port: body.api_port, username: body.api_username, password: body.api_password, secure: apiTls });
      return { success: true, message: 'Successfully connected to the router', router: result };
    } catch (err) {
      return reply.code(400).send({ success: false, error: 'Connection failed', message: err.message, code: err.code || 'CONNECTION_ERROR' });
    }
  });

  fastify.post('/routers', async (request, reply) => {
    const body = addRouterSchema.parse(request.body);
    const apiTls = body.api_tls ?? body.api_port === 8729;
    const { data: existing } = await request.supabase.from('routers').select('id, label').eq('owner_id', request.user.id).eq('host', body.host).eq('api_port', body.api_port).maybeSingle();
    if (existing) return reply.code(409).send({ success: false, error: 'Duplicate router', message: `You already have a router saved for ${body.host}:${body.api_port} (labeled "${existing.label}"). Delete it first if you want to re-add it.` });

    let testResult;
    try {
      testResult = await testConnection({ host: body.host, port: body.api_port, username: body.api_username, password: body.api_password, secure: apiTls });
    } catch (err) {
      return reply.code(400).send({ success: false, error: 'Cannot save router — connection test failed', message: err.message, hint: 'Fix the connection first, then try again. We never save unreachable routers.' });
    }

    const encryptedPassword = encrypt(body.api_password);
    const { data, error } = await request.supabase.from('routers').insert({
      owner_id: request.user.id, label: body.label, host: body.host, api_port: body.api_port, api_tls: apiTls,
      api_username: body.api_username, api_password_encrypted: encryptedPassword,
      last_connected_at: new Date().toISOString(), status: 'connected',
    }).select('id, label, host, api_port, api_tls, api_username, last_connected_at, status, created_at').single();

    if (error) return reply.code(error.code === '23505' ? 409 : 500).send({ success: false, error: error.code === '23505' ? 'Duplicate router' : 'Failed to save router', message: error.code === '23505' ? 'This router was just added. Refresh your router list.' : error.message });
    return { success: true, message: 'Router connected and saved successfully', router: data, test: testResult };
  });

  fastify.get('/routers', async (request, reply) => {
    const { data, error } = await request.supabase.from('routers').select('id, label, host, api_port, api_tls, api_username, last_connected_at, status, created_at').eq('owner_id', request.user.id).order('created_at', { ascending: false });
    if (error) return reply.code(500).send({ error: error.message });
    return { routers: data };
  });

  fastify.post('/routers/:id/retest', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { id } = request.params;
    const { data: router, error } = await request.supabase.from('routers').select('id, label, host, api_port, api_tls, api_username, api_password_encrypted, last_connected_at, status, owner_id, created_at, updated_at').eq('id', id).eq('owner_id', request.user.id).single();
    if (error || !router) return reply.code(404).send({ error: 'Router not found' });
    let password;
    try { password = decrypt(router.api_password_encrypted); } catch { return reply.code(500).send({ error: 'Failed to decrypt credentials' }); }
    try {
      const result = await testConnection({ host: router.host, port: router.api_port, username: router.api_username, password, secure: router.api_tls });
      await supabase.from('routers').update({ status: 'connected', last_connected_at: new Date().toISOString() }).eq('id', id);
      return { success: true, message: 'Router is reachable', router: result };
    } catch (err) {
      await supabase.from('routers').update({ status: 'unreachable' }).eq('id', id);
      return reply.code(400).send({ success: false, error: 'Router is currently unreachable', message: err.message });
    }
  });

  fastify.delete('/routers/:id', async (request, reply) => {
    const { id } = request.params;
    const { data: router, error: routerError } = await request.supabase.from('routers').select('id, host, api_port, api_tls, api_username, api_password_encrypted').eq('id', id).eq('owner_id', request.user.id).single();
    if (routerError || !router) return reply.code(404).send({ error: 'Router not found' });
    const { data: vouchers, error: vouchersError } = await request.supabase.from('vouchers').select('code').eq('router_id', id).eq('owner_id', request.user.id);
    if (vouchersError) return reply.code(500).send({ error: 'Could not inspect router vouchers' });
    if (vouchers?.length) {
      let password;
      try { password = decrypt(router.api_password_encrypted); } catch { return reply.code(500).send({ error: 'Failed to decrypt router credentials' }); }
      try {
        const cleanup = await deleteHotspotUsers({ host: router.host, port: router.api_port, secure: router.api_tls, username: router.api_username, password, names: vouchers.map(v => v.code) });
        if (cleanup.errors.length) return reply.code(409).send({ error: 'Router was not deleted', message: 'The router still contains voucher users that could not be cleaned up. Reconnect the router and try again.', cleanup });
      } catch {
        return reply.code(409).send({ error: 'Router was not deleted', message: 'The router must be reachable before it can be safely removed, so its voucher users are not left behind.' });
      }
    }
    const { error } = await request.supabase.from('routers').delete().eq('id', id).eq('owner_id', request.user.id);
    if (error) return reply.code(500).send({ error: 'Failed to delete router' });
    return { success: true, message: 'Router and its voucher users were removed safely' };
  });
}
