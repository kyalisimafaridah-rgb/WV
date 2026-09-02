-- Adds the owners.role column that /me (GET, PATCH) and the admin
-- routes have always queried for, but which was never created by
-- any prior migration. Without this, GET /me 500s for every owner.
--
-- Default 'owner' for all existing and new signups. Promote your own
-- account to 'admin' manually afterward to use the admin dashboard:
--   update public.owners set role = 'admin' where id = '<your-user-id>';

alter table public.owners
  add column role text not null default 'owner' check (role in ('owner', 'admin'));
