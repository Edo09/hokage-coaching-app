-- ==========================================================================
-- Remove the 12 catalog exercises that have no demo GIF and that no routine
-- or program uses. No exact GIF exists for them in ExerciseDB or the
-- exercises dataset (audit, Oct 2026). "Curl de Femoral con Goma Elástica"
-- also has no GIF but is in use, so it stays.
--
-- Safe to re-run. A row is only deleted while it still has no GIF and no
-- foreign key anywhere points at it; any other is kept and listed in a notice.
-- Apply in the Supabase SQL editor.
-- ==========================================================================
begin;

create temp table _drop (name text primary key) on commit drop;
insert into _drop (name) values
  ('curl de bíceps en suspensión (trx)'),
  ('curl de femoral con mancuerna (entre pies)'),
  ('dragon flag'),
  ('good morning con banda elástica'),
  ('hip thrust unilateral'),
  ('hiperextensiones en suelo (superman)'),
  ('patada de glúteo en 4 apoyos (fire hydrant)'),
  ('plancha con banda elástica'),
  ('saltos de gemelos (pliométricos)'),
  ('snatch (arrancada)'),
  ('suitcase carry (carga maletero)'),
  ('sujeción con pinza (plate pinch)');

do $$
declare
  r record;
  ex record;
  used boolean;
  kept text[] := '{}';
begin
  for ex in
    select e.id, e.name from public.exercises e
      join _drop d on d.name = lower(e.name)
     where e.video_url is null
  loop
    used := false;
    for r in
      select c.conrelid::regclass as tbl, a.attname as col
        from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
       where c.contype = 'f' and c.confrelid = 'public.exercises'::regclass
    loop
      execute format('select exists (select 1 from %s where %I = $1)', r.tbl, r.col) into used using ex.id;
      exit when used;
    end loop;
    if used then
      kept := kept || ex.name;
    else
      delete from public.exercises where id = ex.id;
    end if;
  end loop;
  if cardinality(kept) > 0 then
    raise notice 'In use, kept: %', array_to_string(kept, ' | ');
  end if;
end $$;

commit;

-- Verify (expect 1 — the in-use one):
-- select name from public.exercises where video_url is null;
