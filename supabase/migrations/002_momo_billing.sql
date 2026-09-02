-- MoMo subscription billing (owners -> platform)
-- Run this in the Supabase SQL editor AFTER schema.sql.
--
-- Matching note: the SMS "Reason:" field (MTN) / sender name field
-- (Airtel cash deposit) is auto-populated with the PAYER's own
-- MoMo-registered name — it is not free text the payer can type.
-- So the reference we match against has to be each owner's actual
-- registered name, set once by the owner themselves (see
-- src/routes/billing.js), not a generated code.
--
-- Model: no separate "invoice" table. Every owner with a registered
-- name is a standing candidate to renew at the flat subscription
-- price; if two owners happen to share a name, the matcher reports
-- "ambiguous" for manual review rather than guessing.

-- ============================================
-- OWNERS: registered MoMo name + paid-until expiry
-- ============================================
alter table public.owners
  add column momo_registered_name text,
  add column subscription_paid_until timestamptz;

-- ============================================
-- MOMO_EVENTS (dedup log + audit trail)
-- One row per inbound SMS the relay app forwards. transaction_id is
-- the real idempotency key (unique, nullable — parse failures have
-- none). This is the "reserveEvent" contract the matcher relies on
-- to prevent double-crediting a replayed SMS.
-- ============================================
create table public.momo_events (
  id uuid primary key default uuid_generate_v4(),
  transaction_id text unique,
  network text not null check (network in ('mtn', 'airtel')),
  raw_body text not null,
  parsed_amount_ugx integer,
  parsed_reason_name text,
  parsed_reason_phone text,
  status text not null default 'no_match' check (status in ('matched', 'no_match', 'ambiguous', 'duplicate', 'parse_failed')),
  matched_owner_id uuid references public.owners(id),
  note text,
  created_at timestamptz not null default now()
);

create index momo_events_transaction_id_idx on public.momo_events(transaction_id);
create index momo_events_matched_owner_id_idx on public.momo_events(matched_owner_id);
create index momo_events_status_idx on public.momo_events(status);

-- Service-role only (the webhook uses the service client) — no owner-
-- facing policies. RLS enabled with zero policies locks this to
-- service role by default.
alter table public.momo_events enable row level security;
