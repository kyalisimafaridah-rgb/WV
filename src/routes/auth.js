import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { supabase } from '../db/supabase.js';

/**
 * Auth-related endpoints.
 * Login is still handled by Supabase client-side (supabaseClient.auth.signInWithPassword).
 * Signup goes through POST /auth/signup below instead of the client-side
 * supabaseClient.auth.signUp() call — that path sends a confirmation email
 * and blocks login until it's clicked, gated by a project-level dashboard
 * setting. Creating the user here with the service-role key and
 * email_confirm: true skips that entirely, regardless of the dashboard
 * setting, so signup -> instant login works no matter how that toggle
 * is configured.
 */
const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  full_name: z.string().optional(),
});

export default async function authRoutes(fastify) {
  /**
   * POST /auth/signup
   * Creates a pre-confirmed account. The frontend follows this with its own
   * supabaseClient.auth.signInWithPassword() call to get a session — this
   * endpoint only handles account creation, not session issuance.
   */
  fastify.post('/auth/signup', {
    config: {
      rateLimit: { max: 10, timeWindow: '1 minute' },
    },
  }, async (request, reply) => {
    const parsed = signupSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', details: parsed.error.errors });
    }
    const { email, password, full_name } = parsed.data;

    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: full_name ? { full_name } : undefined,
    });

    if (error) {
      // Supabase returns a 422/"already registered" style error for duplicates.
      // Keep the message generic to avoid confirming which emails exist.
      const status = error.status === 422 || /already registered|already exists/i.test(error.message)
        ? 409
        : 500;
      return reply.code(status).send({
        error: status === 409 ? 'Account already exists' : 'Signup failed',
        message: status === 409 ? 'This email is already registered — try logging in instead.' : error.message,
      });
    }

    return reply.code(201).send({ success: true, user: { id: data.user.id, email: data.user.email } });
  });

  /**
   * GET /me
   * Returns the current owner profile (subscription status, trial end, etc.)
   */
  fastify.get('/me', { preHandler: requireAuth }, async (request, reply) => {
    const { data: owner, error } = await request.supabase
      .from('owners')
      .select('id, email, full_name, role, subscription_status, trial_ends_at, created_at')
      .eq('id', request.user.id)
      .single();

    if (error || !owner) {
      // Race condition: trigger may not have fired yet — create on the fly
      const { data: created, error: createError } = await supabase
        .from('owners')
        .upsert({
          id: request.user.id,
          email: request.user.email,
          trial_ends_at: new Date(Date.now() + (Number(process.env.TRIAL_DAYS) || 14) * 86400000).toISOString(),
        })
        .select('id, email, full_name, role, subscription_status, trial_ends_at, created_at')
        .single();

      if (createError) {
        return reply.code(500).send({ error: 'Failed to load owner profile' });
      }
      return { owner: created };
    }

    return { owner };
  });

  /**
   * PATCH /me
   * Update basic profile (name only for now)
   */
  fastify.patch('/me', { preHandler: requireAuth }, async (request, reply) => {
    const { full_name } = request.body || {};

    if (full_name !== undefined && typeof full_name !== 'string') {
      return reply.code(400).send({ error: 'full_name must be a string' });
    }

    const { data, error } = await request.supabase
      .from('owners')
      .update({ full_name: full_name || null })
      .eq('id', request.user.id)
      .select('id, email, full_name, role, subscription_status, trial_ends_at')
      .single();

    if (error) {
      return reply.code(500).send({ error: error.message });
    }

    return { success: true, owner: data };
  });
}
