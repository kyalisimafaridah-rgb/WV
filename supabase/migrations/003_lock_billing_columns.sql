-- Fixes a privilege gap: "Owners can update own profile" (schema.sql)
-- is row-scoped, not column-scoped, so an owner's own JWT can write
-- ANY column on their own row via a direct Supabase REST call —
-- including subscription_status and subscription_paid_until. That
-- means an owner could set themselves to active with a far-future
-- paid-until date, permanently, without paying, entirely outside
-- this app.
--
-- momo_registered_name is meant to stay owner-writable (that's what
-- PUT /billing/momo-name is for). subscription_status and
-- subscription_paid_until must not be. Run this after
-- 002_momo_billing.sql.
--
-- Column-level REVOKE and RLS are independent layers — this doesn't
-- touch or weaken the existing RLS policies, it just removes write
-- permission on two specific columns for the role every logged-in
-- owner's request runs as. service_role (used by the app's backend
-- and the momo-sms webhook) is unaffected — it bypasses grants and
-- RLS both.

revoke update (subscription_status, subscription_paid_until)
  on public.owners
  from authenticated;

-- After this migration, src/middleware/auth.js's auto-expire writes
-- and the MoMo adapter's onPaymentMatched write MUST use the
-- service-role client (supabase from src/db/supabase.js), never
-- request.supabase — that's already how both are written as of this
-- migration, but if you touch that code later, keep it that way or
-- those writes will silently affect 0 rows.
