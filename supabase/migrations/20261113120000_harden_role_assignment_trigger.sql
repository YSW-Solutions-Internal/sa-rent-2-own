-- Security fix: handle_new_auth_user() previously read the new profile's
-- role from auth.users.raw_user_meta_data, a.k.a. the "user_metadata" the
-- Supabase client SDK exposes. That field is fully controlled by whoever
-- creates the account — including a public, unauthenticated caller of the
-- Auth signUp() REST endpoint, since the checked-in config (supabase/
-- config.toml) still has auth.email.enable_signup on even though this app
-- documents (README.md, SPEC.md §5) and only ever actually uses an
-- invite-only, admin-created-account model (phone + password, no public
-- sign-up). Anyone who could reach that endpoint with the project's public
-- anon key could set { "role": "admin" } in their own signup payload and
-- have this trigger hand them an admin profile outright.
--
-- Fix: read role from raw_app_meta_data ("app_metadata") instead.
-- app_metadata can only ever be set via the service-role Admin API
-- (supabase.auth.admin.createUser/updateUserById) — never by the user
-- themselves, through signUp() or updateUser() or any other
-- publicly-reachable call. That's the Supabase-enforced boundary this
-- trigger should have been relying on from the start. The app's own
-- account-creation path (createStaffUser, admin/users/actions.ts) is
-- updated in the same change to pass role via app_metadata.
--
-- This does not, by itself, re-disable public signup on an already-linked
-- production project — supabase/config.toml's [auth] section only governs
-- `supabase start`'s local stack unless separately pushed. The project's
-- live Authentication settings (Dashboard -> Authentication -> Providers)
-- must be checked and signup disabled there directly; this migration is
-- the defense-in-depth half of the fix, so that even if signup is ever
-- accidentally left on, it can no longer hand out a role.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, phone, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', 'Unnamed user'),
    coalesce(new.phone, ''),
    new.email,
    coalesce((new.raw_app_meta_data ->> 'role')::public.user_role, 'technician')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
