create table public.items (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  category text not null default 'Inne' check (char_length(category) <= 40),
  condition text not null default 'Używany' check (char_length(condition) <= 40),
  description text not null default '' check (char_length(description) <= 500),
  image_url text not null default '' check (char_length(image_url) <= 500),
  is_reserved boolean not null default false,
  is_listed boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  contact text not null check (char_length(btrim(contact)) between 1 and 120),
  created_at timestamptz not null default now(),
  released_at timestamptz
);

create unique index reservations_one_active_per_item
  on public.reservations (item_id)
  where released_at is null;

alter table public.items enable row level security;
alter table public.reservations enable row level security;

revoke all on public.items, public.reservations from anon, authenticated;
grant select on public.items to anon, authenticated;
grant insert (item_id, name, contact) on public.reservations to anon, authenticated;
grant all on public.items, public.reservations to service_role;

create policy "Anyone can view listed items"
  on public.items for select to anon, authenticated
  using (is_listed);

create policy "Visitors can create reservations"
  on public.reservations for insert to anon, authenticated
  with check (
    released_at is null
    and char_length(btrim(name)) between 1 and 80
    and char_length(btrim(contact)) between 1 and 120
  );

create or replace function public.reserve_item_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.items
  set is_reserved = true
  where id = new.item_id
    and is_listed
    and not is_reserved;

  if not found then
    raise exception 'ITEM_UNAVAILABLE' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function public.reserve_item_before_insert() from public, anon, authenticated;

create trigger reservation_claims_item
  before insert on public.reservations
  for each row execute function public.reserve_item_before_insert();

create or replace function public.release_reservation(p_reservation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  reserved_item_id uuid;
begin
  update public.reservations
  set released_at = now()
  where id = p_reservation_id
    and released_at is null
  returning item_id into reserved_item_id;

  if reserved_item_id is null then
    raise exception 'RESERVATION_NOT_FOUND' using errcode = 'P0002';
  end if;

  update public.items
  set is_reserved = false
  where id = reserved_item_id;
end;
$$;

revoke all on function public.release_reservation(uuid) from public, anon, authenticated;
grant execute on function public.release_reservation(uuid) to service_role;

create table public.admin_pin_failures (
  client_hash text primary key check (client_hash ~ '^[0-9a-f]{64}$'),
  attempt_count integer not null default 0,
  window_started_at timestamptz not null default now()
);

alter table public.admin_pin_failures enable row level security;
revoke all on public.admin_pin_failures from public, anon, authenticated;
grant all on public.admin_pin_failures to service_role;

create or replace function public.record_admin_pin_failure(p_client_hash text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_attempt_count integer;
begin
  if p_client_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_CLIENT_HASH' using errcode = '22023';
  end if;

  delete from public.admin_pin_failures
  where window_started_at < now() - interval '1 day';

  insert into public.admin_pin_failures (client_hash, attempt_count, window_started_at)
  values (p_client_hash, 1, now())
  on conflict (client_hash) do update
  set attempt_count = case
        when admin_pin_failures.window_started_at < now() - interval '15 minutes' then 1
        else admin_pin_failures.attempt_count + 1
      end,
      window_started_at = case
        when admin_pin_failures.window_started_at < now() - interval '15 minutes' then now()
        else admin_pin_failures.window_started_at
      end
  returning attempt_count into current_attempt_count;

  return current_attempt_count <= 5;
end;
$$;

create or replace function public.clear_admin_pin_failures(p_client_hash text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.admin_pin_failures where client_hash = p_client_hash;
$$;

revoke all on function public.record_admin_pin_failure(text) from public, anon, authenticated;
revoke all on function public.clear_admin_pin_failures(text) from public, anon, authenticated;
grant execute on function public.record_admin_pin_failure(text) to service_role;
grant execute on function public.clear_admin_pin_failures(text) to service_role;