-- Random property sampling, for the pre-launch accuracy measurements.
--
-- PLAN.md §8 asks for two numbers before launch that nobody has yet: the
-- citywide join match rate (the spike measured 27 lots, which proves the
-- mechanism and says nothing about the rate) and the address resolver's
-- accuracy, which the spike could not measure at all. Both need a
-- *representative* sample, and PostgREST offers no way to draw one — paging to
-- a random offset returns physically adjacent lots, which for this data means
-- one block of one neighbourhood.
--
-- `order by random()` is a sequential scan over ~858k rows. That is the right
-- trade here and not the usual one: this is an operator tool run a handful of
-- times before launch, never on a request path, and the alternative measured
-- worse. `TABLESAMPLE SYSTEM` is the cheap option, but it selects whole pages
-- probabilistically, so small requests routinely return *nothing* — verified,
-- not assumed: at a 0.06% rate it returned 0 rows where 3 were asked for. A
-- sampling function that silently returns an empty set reads as "PLUTO isn't
-- loaded", which is exactly the wrong thing to debug the night before launch.

create or replace function sample_properties(p_count integer default 500)
returns table (
  bbl          char(10),
  address      text,
  borough_code char(1),
  lot          integer
)
language sql
stable
set search_path = public, pg_temp
as $$
  select p.bbl, p.address, p.borough_code, p.lot
  from properties as p
  order by random()
  limit greatest(1, p_count);
$$;

-- Operator tool, same posture as ingest_pluto_page: nothing the web clients
-- have any reason to call, and a full scan is not something to expose publicly.
revoke all on function sample_properties(integer) from public, anon, authenticated;
