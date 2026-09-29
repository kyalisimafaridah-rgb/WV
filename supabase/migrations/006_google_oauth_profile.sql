-- Google OAuth support
create or replace function public.handle_new_user() returns trigger as $$
begin
  insert into public.owners (id, email, full_name, trial_ends_at)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'), now() + interval '14 days');
  return new;
end;
$$ language plpgsql security definer set search_path = public;
