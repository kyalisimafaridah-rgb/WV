-- WiFi Voucher MVP Schema
-- Run this in Supabase SQL Editor

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ============================================
-- OWNERS (extends Supabase auth.users)
-- ============================================
create table public.owners (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  subscription_status text not null default 'trial' check (subscription_status in ('trial', 'active', 'expired')),
  trial_ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================
-- ROUTERS
-- ============================================
create table public.routers (
  id uuid primary key default uuid_generate_v4(),
  owner_id uuid not null references public.owners(id) on delete cascade,
  label text not null,
  host text not null,                    -- IP or DDNS hostname
  api_port integer not null default 8728,
  api_username text not null,
  api_password_encrypted text not null,  -- AES-256-GCM encrypted
  last_connected_at timestamptz,
  status text not null default 'unknown' check (status in ('connected', 'unreachable', 'unknown')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index routers_owner_id_idx on public.routers(owner_id);

-- ============================================
-- PROFILES (voucher packages)
-- ============================================
create table public.profiles (
  id uuid primary key default uuid_generate_v4(),
  router_id uuid not null references public.routers(id) on delete cascade,
  name text not null,                    -- e.g. "1 Hour", "1 Day", "500MB"
  duration_minutes integer,              -- null if data-only
  data_limit_mb integer,                 -- null if time-only
  price numeric(10,2) default 0,
  currency text default 'UGX',
  code_prefix text default '',           -- optional prefix e.g. "SHOP-"
  grace_minutes integer default 0,       -- optional grace period
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profile_has_limit check (duration_minutes is not null or data_limit_mb is not null)
);

create index profiles_router_id_idx on public.profiles(router_id);

-- ============================================
-- VOUCHERS
-- ============================================
create table public.vouchers (
  id uuid primary key default uuid_generate_v4(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  router_id uuid not null references public.routers(id) on delete cascade,
  owner_id uuid not null references public.owners(id) on delete cascade,
  code text not null unique,             -- unguessable random code
  status text not null default 'unused' check (status in ('unused', 'active', 'expired', 'disabled')),
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  expires_at timestamptz,
  last_synced_at timestamptz
);

create index vouchers_owner_id_idx on public.vouchers(owner_id);
create index vouchers_router_id_idx on public.vouchers(router_id);
create index vouchers_profile_id_idx on public.vouchers(profile_id);
create index vouchers_code_idx on public.vouchers(code);
create index vouchers_status_idx on public.vouchers(status);

-- ============================================
-- VOUCHER GENERATION LOGS (for soft rate limiting + audit)
-- ============================================
create table public.voucher_generation_logs (
  id uuid primary key default uuid_generate_v4(),
  owner_id uuid not null references public.owners(id) on delete cascade,
  router_id uuid not null references public.routers(id) on delete cascade,
  quantity integer not null,
  success boolean not null,
  error_message text,
  created_at timestamptz not null default now()
);

create index voucher_gen_logs_owner_day_idx on public.voucher_generation_logs(owner_id, created_at);

-- ============================================
-- RLS POLICIES
-- ============================================
alter table public.owners enable row level security;
alter table public.routers enable row level security;
alter table public.profiles enable row level security;
alter table public.vouchers enable row level security;
alter table public.voucher_generation_logs enable row level security;

-- Owners can only see/edit their own data
create policy "Owners can view own profile"
  on public.owners for select
  using (auth.uid() = id);

create policy "Owners can update own profile"
  on public.owners for update
  using (auth.uid() = id);

-- Routers
create policy "Owners can manage own routers"
  on public.routers for all
  using (auth.uid() = owner_id);

-- Profiles
create policy "Owners can manage own profiles"
  on public.profiles for all
  using (
    exists (
      select 1 from public.routers r
      where r.id = profiles.router_id and r.owner_id = auth.uid()
    )
  );

-- Vouchers
create policy "Owners can manage own vouchers"
  on public.vouchers for all
  using (auth.uid() = owner_id);

-- Generation logs
create policy "Owners can view own generation logs"
  on public.voucher_generation_logs for select
  using (auth.uid() = owner_id);

create policy "Owners can insert own generation logs"
  on public.voucher_generation_logs for insert
  with check (auth.uid() = owner_id);

-- ============================================
-- FUNCTIONS & TRIGGERS
-- ============================================

-- Auto-create owner record on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.owners (id, email, trial_ends_at)
  values (
    new.id,
    new.email,
    now() + interval '14 days'
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Updated_at trigger
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger owners_updated_at before update on public.owners
  for each row execute procedure public.set_updated_at();

create trigger routers_updated_at before update on public.routers
  for each row execute procedure public.set_updated_at();

create trigger profiles_updated_at before update on public.profiles
  for each row execute procedure public.set_updated_at();
