-- Production hardening for direct Supabase access.
-- Run after 004_add_owner_role.sql.

alter table public.routers add column if not exists api_tls boolean not null default false;
revoke update (subscription_status, subscription_paid_until, role) on public.owners from authenticated;
grant update (full_name, momo_registered_name, updated_at) on public.owners to authenticated;
revoke insert, update on public.routers from authenticated;
grant insert (owner_id, label, host, api_port, api_tls, api_username, api_password_encrypted, last_connected_at, status) on public.routers to authenticated;
grant update (label, host, api_port, api_tls, api_username, updated_at) on public.routers to authenticated;
drop policy if exists "Owners can manage own profiles" on public.profiles;
create policy "Owners can manage own profiles" on public.profiles for all using (exists (select 1 from public.routers r where r.id = profiles.router_id and r.owner_id = auth.uid())) with check (exists (select 1 from public.routers r where r.id = profiles.router_id and r.owner_id = auth.uid()));
drop policy if exists "Owners can manage own vouchers" on public.vouchers;
create policy "Owners can manage own vouchers" on public.vouchers for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id and exists (select 1 from public.routers r where r.id = vouchers.router_id and r.owner_id = auth.uid()) and exists (select 1 from public.profiles p join public.routers r on r.id = p.router_id where p.id = vouchers.profile_id and p.router_id = vouchers.router_id and r.owner_id = auth.uid() and p.is_active = true));
drop policy if exists "Owners can insert own generation logs" on public.voucher_generation_logs;
create policy "Owners can insert own generation logs" on public.voucher_generation_logs for insert with check (auth.uid() = owner_id and exists (select 1 from public.routers r where r.id = router_id and r.owner_id = auth.uid()));
create index if not exists vouchers_owner_created_at_idx on public.vouchers(owner_id, created_at desc);
create index if not exists routers_owner_host_port_idx on public.routers(owner_id, host, api_port);
create or replace function public.renew_owner_subscription(p_owner_id uuid, p_days integer) returns timestamptz language sql security definer set search_path = public as $$ update public.owners set subscription_status = 'active', subscription_paid_until = greatest(coalesce(subscription_paid_until, now()), now()) + make_interval(days => greatest(1, p_days)) where id = p_owner_id returning subscription_paid_until; $$;
revoke all on function public.renew_owner_subscription(uuid, integer) from public, anon, authenticated;
grant execute on function public.renew_owner_subscription(uuid, integer) to service_role;
