import { supabase } from '../db/supabase.js';

// Flat monthly subscription price. One price for now — if you add
// tiers later, findPendingPaymentsByAmount is the only place that
// needs to change (match against a price->owners lookup instead of
// a single constant).
const SUBSCRIPTION_PRICE_UGX = Number(process.env.SUBSCRIPTION_PRICE_UGX || 0);
const SUBSCRIPTION_PERIOD_DAYS = Number(process.env.SUBSCRIPTION_PERIOD_DAYS || 30);

const POSTGRES_UNIQUE_VIOLATION = '23505';

/**
 * Implements the momo-sms-billing StorageAdapter contract against
 * Supabase. See src/lib/momo-sms-billing/types.cjs (compiled from the
 * original StorageAdapter interface) for the exact contract this is
 * held to — in particular reserveEvent MUST be a real atomic insert,
 * which is why it relies on the DB unique constraint + catching
 * 23505, not a check-then-insert.
 *
 * referenceText = the owner's own MoMo-registered name (see
 * src/routes/billing.js), because that's what the SMS "Reason:"
 * field is actually auto-populated with — not a code we invent.
 */
export const momoStorageAdapter = {
  async findPendingPaymentsByAmount(amountUgx) {
    if (!SUBSCRIPTION_PRICE_UGX || amountUgx !== SUBSCRIPTION_PRICE_UGX) {
      return [];
    }

    const { data, error } = await supabase
      .from('owners')
      .select('id, momo_registered_name')
      .not('momo_registered_name', 'is', null);

    if (error) {
      throw new Error(`findPendingPaymentsByAmount failed: ${error.message}`);
    }

    return (data || []).map((owner) => ({
      id: owner.id,
      amountUgx: SUBSCRIPTION_PRICE_UGX,
      referenceText: owner.momo_registered_name,
    }));
  },

  async reserveEvent(params) {
    const { data, error } = await supabase
      .from('momo_events')
      .insert({
        transaction_id: params.transactionId,
        network: params.network,
        raw_body: params.rawBody,
        parsed_amount_ugx: params.parsedAmountUgx,
        parsed_reason_name: params.parsedReasonName,
        parsed_reason_phone: params.parsedReasonPhone,
      })
      .select('id')
      .single();

    if (!error) {
      return { reserved: true, eventId: data.id };
    }

    if (error.code === POSTGRES_UNIQUE_VIOLATION) {
      const { data: existing, error: lookupError } = await supabase
        .from('momo_events')
        .select('id')
        .eq('transaction_id', params.transactionId)
        .single();

      if (lookupError || !existing) {
        throw new Error(
          `reserveEvent: unique violation but could not find existing row for transaction ${params.transactionId}: ${lookupError?.message}`
        );
      }
      return { reserved: false, existingEventId: existing.id };
    }

    throw new Error(`reserveEvent failed: ${error.message}`);
  },

  async updateEventStatus(eventId, update) {
    const { error } = await supabase
      .from('momo_events')
      .update({
        status: update.status,
        matched_owner_id: update.matchedPaymentId ?? null,
        note: update.note ?? null,
      })
      .eq('id', eventId);

    if (error) {
      throw new Error(`updateEventStatus failed: ${error.message}`);
    }
  },

  async recordParseFailure(rawBody, network) {
    const { error } = await supabase.from('momo_events').insert({
      transaction_id: null,
      network,
      raw_body: rawBody,
      status: 'parse_failed',
    });

    if (error) {
      throw new Error(`recordParseFailure failed: ${error.message}`);
    }
  },

  async onPaymentMatched(payment, _parsed) {
    const { data: owner, error: fetchError } = await supabase
      .from('owners')
      .select('subscription_paid_until')
      .eq('id', payment.id)
      .single();

    if (fetchError) {
      throw new Error(`onPaymentMatched: could not load owner ${payment.id}: ${fetchError.message}`);
    }

    // Renewing early stacks on top of remaining time rather than
    // resetting it — an owner who pays a week before expiry keeps
    // that week.
    const now = new Date();
    const currentPaidUntil = owner.subscription_paid_until ? new Date(owner.subscription_paid_until) : null;
    const base = currentPaidUntil && currentPaidUntil > now ? currentPaidUntil : now;
    const newPaidUntil = new Date(base.getTime() + SUBSCRIPTION_PERIOD_DAYS * 24 * 60 * 60 * 1000);

    const { error: updateError } = await supabase
      .from('owners')
      .update({
        subscription_status: 'active',
        subscription_paid_until: newPaidUntil.toISOString(),
      })
      .eq('id', payment.id);

    if (updateError) {
      throw new Error(`onPaymentMatched: could not update owner ${payment.id}: ${updateError.message}`);
    }
  },
};
