alter table public.items
  add column price numeric(10, 2) check (price is null or price >= 0),
  add column quantity integer not null default 1 check (quantity >= 1),
  add column available_quantity integer not null default 1 check (available_quantity >= 0);

alter table public.reservations
  add column quantity integer not null default 1 check (quantity >= 1);

update public.items i
set available_quantity = greatest(i.quantity - coalesce(active.quantity, 0), 0),
    is_reserved = greatest(i.quantity - coalesce(active.quantity, 0), 0) = 0
from (
  select item_id, sum(quantity)::integer as quantity
  from public.reservations
  where released_at is null
  group by item_id
) active
where i.id = active.item_id;

alter table public.items
  add constraint items_available_quantity_lte_quantity
  check (available_quantity <= quantity);

drop index public.reservations_one_active_per_item;
create index reservations_active_item_id
  on public.reservations (item_id)
  where released_at is null;

grant insert (quantity) on public.reservations to anon, authenticated;

create or replace function public.reserve_item_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  available integer;
begin
  select available_quantity into available
  from public.items
  where id = new.item_id and is_listed
  for update;

  if not found or available < new.quantity then
    raise exception 'ITEM_UNAVAILABLE' using errcode = 'P0001';
  end if;

  update public.items
  set available_quantity = available_quantity - new.quantity,
      is_reserved = available_quantity - new.quantity = 0
  where id = new.item_id;

  return new;
end;
$$;

create or replace function public.release_reservation(p_reservation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  reserved_item_id uuid;
  released_quantity integer;
begin
  select item_id into reserved_item_id
  from public.reservations
  where id = p_reservation_id and released_at is null;

  if reserved_item_id is null then
    raise exception 'RESERVATION_NOT_FOUND' using errcode = 'P0002';
  end if;

  perform 1 from public.items where id = reserved_item_id for update;

  update public.reservations
  set released_at = now()
  where id = p_reservation_id and released_at is null
  returning quantity into released_quantity;

  if released_quantity is null then
    raise exception 'RESERVATION_NOT_FOUND' using errcode = 'P0002';
  end if;

  update public.items
  set available_quantity = available_quantity + released_quantity,
      is_reserved = available_quantity + released_quantity = 0
  where id = reserved_item_id;
end;
$$;

create or replace function public.admin_update_item(
  p_item_id uuid,
  p_name text,
  p_category text,
  p_condition text,
  p_description text,
  p_image_url text,
  p_price numeric,
  p_quantity integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  active_quantity integer;
begin
  perform 1 from public.items where id = p_item_id and is_listed for update;
  if not found then
    raise exception 'ITEM_NOT_FOUND' using errcode = 'P0002';
  end if;

  select coalesce(sum(quantity), 0)::integer into active_quantity
  from public.reservations
  where item_id = p_item_id and released_at is null;

  if p_quantity < active_quantity then
    raise exception 'ITEM_QUANTITY_TOO_LOW' using errcode = 'P0001';
  end if;

  update public.items
  set name = p_name,
      category = p_category,
      condition = p_condition,
      description = p_description,
      image_url = p_image_url,
      price = p_price,
      quantity = p_quantity,
      available_quantity = p_quantity - active_quantity,
      is_reserved = p_quantity = active_quantity
  where id = p_item_id;
end;
$$;

create or replace function public.admin_remove_item(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  active_quantity integer;
begin
  perform 1 from public.items where id = p_item_id and is_listed for update;
  if not found then
    raise exception 'ITEM_NOT_FOUND' using errcode = 'P0002';
  end if;

  select coalesce(sum(quantity), 0)::integer into active_quantity
  from public.reservations
  where item_id = p_item_id and released_at is null;

  if active_quantity > 0 then
    raise exception 'ITEM_HAS_RESERVATIONS' using errcode = 'P0001';
  end if;

  update public.items set is_listed = false where id = p_item_id;
end;
$$;

revoke all on function public.admin_update_item(uuid, text, text, text, text, text, numeric, integer) from public, anon, authenticated;
revoke all on function public.admin_remove_item(uuid) from public, anon, authenticated;
grant execute on function public.admin_update_item(uuid, text, text, text, text, text, numeric, integer) to service_role;
grant execute on function public.admin_remove_item(uuid) to service_role;
