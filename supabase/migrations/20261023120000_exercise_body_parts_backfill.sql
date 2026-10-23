-- ==========================================================================
-- Body part for the 14 original catalog exercises that never had one
-- (created 2026-07-08, before the body-part seed). Each takes the body part
-- the exercises dataset gives the GIF it shows, like every other exercise.
-- Only fills empty values; re-runnable. Apply in the Supabase SQL editor.
-- ==========================================================================
begin;

create temp table _bp (name text, body_part text) on commit drop;
insert into _bp (name, body_part) values
  ('Bicicleta', 'cardio'),
  ('Correr en la cinta', 'cardio'),
  ('Correr en lugar', 'cardio'),
  ('Elevaciones de rodillas', 'waist'),
  ('Flexiones de brazos', 'chest'),
  ('Fondos de tríceps', 'upper arms'),
  ('Peso muerto', 'upper legs'),
  ('Peso muerto con mancuernas', 'upper legs'),
  ('Plancha con Peso (Weighted Plank)', 'waist'),
  ('Press de hombros', 'shoulders'),
  ('Saltos de tijera', 'cardio'),
  ('Sentadillas', 'upper legs'),
  ('Tríceps con cuerda', 'upper arms'),
  ('Tríceps con mancuernas', 'upper arms');

do $$
declare missing text;
begin
  select string_agg(b.name, ' | ') into missing from _bp b
   where not exists (select 1 from public.exercises e where lower(e.name) = lower(b.name));
  if missing is not null then
    raise exception 'Exercises not found (renamed?): %', missing;
  end if;
  select string_agg(distinct b.body_part, ' | ') into missing from _bp b
   where not exists (select 1 from public.bodyparts p where p.name = b.body_part);
  if missing is not null then
    raise exception 'Unknown body parts: %', missing;
  end if;
end $$;

update public.exercises e set
  body_part_id = p.id,
  updated_at = now()
from _bp b
join public.bodyparts p on p.name = b.body_part
where lower(e.name) = lower(b.name)
  and e.body_part_id is null;

commit;

-- Verify (expect 0): select count(*) from public.exercises where body_part_id is null;
