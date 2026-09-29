import { createUserClient, supabase } from '../db/supabase.js';

export async function requireAuth(request, reply) {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return reply.code(401).send({ error: 'Unauthorized', message: 'Missing or invalid Authorization header. Use: Bearer <supabase_access_token>' });
  const token = authHeader.slice(7);
  try {
    const userSupabase = createUserClient(token);
    const { data: { user }, error } = await userSupabase.auth.getUser(token);
    if (error || !user) return reply.code(401).send({ error: 'Unauthorized', message: 'Invalid or expired token' });
    request.user = user; request.supabase = userSupabase;
  } catch { return reply.code(401).send({ error: 'Unauthorized', message: 'Token verification failed' }); }
}

export async function requireActiveSubscription(request, reply) {
  const { data: owner, error } = await request.supabase.from('owners').select('subscription_status, trial_ends_at, subscription_paid_until').eq('id', request.user.id).single();
  if (error || !owner) return reply.code(403).send({ error: 'Forbidden', message: 'Owner profile not found' });
  if (owner.subscription_status === 'expired') return reply.code(403).send({ error: 'Subscription expired', message: 'Your subscription has expired. Pay via Mobile Money to reactivate (see /billing/momo-info).' });
  if (owner.subscription_status === 'active' && owner.subscription_paid_until && new Date(owner.subscription_paid_until) < new Date()) {
    await supabase.from('owners').update({ subscription_status: 'expired' }).eq('id', request.user.id);
    return reply.code(403).send({ error: 'Subscription expired', message: 'Your paid period has ended. Pay via Mobile Money to reactivate (see /billing/momo-info).' });
  }
  if (owner.subscription_status === 'trial' && owner.trial_ends_at && new Date(owner.trial_ends_at) < new Date()) {
    await supabase.from('owners').update({ subscription_status: 'expired' }).eq('id', request.user.id);
    return reply.code(403).send({ error: 'Trial expired', message: 'Your free trial has ended. Please contact support to activate.' });
  }
  request.owner = owner;
}
