import { createUserClient, supabase } from '../db/supabase.js';

/**
 * Fastify preHandler that verifies the Supabase JWT
 * and attaches the user + a user-scoped supabase client to the request.
 */
export async function requireAuth(request, reply) {
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.code(401).send({
      error: 'Unauthorized',
      message: 'Missing or invalid Authorization header. Use: Bearer <supabase_access_token>',
    });
  }

  const token = authHeader.slice(7);

  try {
    const userSupabase = createUserClient(token);
    const { data: { user }, error } = await userSupabase.auth.getUser(token);

    if (error || !user) {
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'Invalid or expired token',
      });
    }

    // Attach to request for use in route handlers
    request.user = user;
    request.supabase = userSupabase;
  } catch (err) {
    return reply.code(401).send({
      error: 'Unauthorized',
      message: 'Token verification failed',
    });
  }
}

/**
 * Optional: also check that the owner has an active or trial subscription
 */
export async function requireActiveSubscription(request, reply) {
  const { data: owner, error } = await request.supabase
    .from('owners')
    .select('subscription_status, trial_ends_at, subscription_paid_until')
    .eq('id', request.user.id)
    .single();

  if (error || !owner) {
    return reply.code(403).send({
      error: 'Forbidden',
      message: 'Owner profile not found',
    });
  }

  if (owner.subscription_status === 'expired') {
    return reply.code(403).send({
      error: 'Subscription expired',
      message: 'Your subscription has expired. Pay via Mobile Money to reactivate (see /billing/momo-info).',
    });
  }

  // Paid subscriptions carry an expiry now that MoMo billing sets it
  // automatically. subscription_paid_until === null means the owner
  // was activated manually (e.g. by admin) with no auto-expiry — that
  // path still works as before, indefinitely.
  if (owner.subscription_status === 'active' && owner.subscription_paid_until) {
    if (new Date(owner.subscription_paid_until) < new Date()) {
      // Service-role client, not request.supabase: after the column
      // grant revoke in 003_lock_billing_columns.sql, the owner's own
      // token can no longer write subscription_status/subscription_paid_until
      // at all (that's the point), so the app's own writes to those
      // columns have to go through the service-role client too.
      await supabase
        .from('owners')
        .update({ subscription_status: 'expired' })
        .eq('id', request.user.id);

      return reply.code(403).send({
        error: 'Subscription expired',
        message: 'Your paid period has ended. Pay via Mobile Money to reactivate (see /billing/momo-info).',
      });
    }
  }

  if (owner.subscription_status === 'trial' && owner.trial_ends_at) {
    if (new Date(owner.trial_ends_at) < new Date()) {
      // Auto-expire — service-role client, same reasoning as above.
      await supabase
        .from('owners')
        .update({ subscription_status: 'expired' })
        .eq('id', request.user.id);

      return reply.code(403).send({
        error: 'Trial expired',
        message: 'Your free trial has ended. Please contact support to activate (cash payment).',
      });
    }
  }

  request.owner = owner;
}
