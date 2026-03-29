alter table public.aircraft_types
  add column if not exists body_class text,
  add column if not exists deck_count integer;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'aircraft_types_body_class_check'
  ) then
    alter table public.aircraft_types
      add constraint aircraft_types_body_class_check
      check (body_class is null or body_class in ('narrowbody', 'widebody'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'aircraft_types_deck_count_check'
  ) then
    alter table public.aircraft_types
      add constraint aircraft_types_deck_count_check
      check (deck_count is null or deck_count in (1, 2));
  end if;
end $$;
