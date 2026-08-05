-- A self-check for "merged does not mean deployed".
--
-- Twice now, schema in the repo was not schema in the database, and both times
-- it failed silently rather than loudly:
--
--   * `rate_limits` / `sample_properties` were merged and never applied, so the
--     rate limiter had no table to write to. It fails open by design, so it
--     simply stopped limiting and nothing looked wrong.
--   * `claim_free_lookup` was merged and never applied, so every free-tier
--     claim errored, `recordLookup` failed open, no row was ever written to
--     `lookups`, and `free_lookups_remaining` answered 1 forever — an unlimited
--     free tier, with no error surfaced anywhere.
--
-- Comparing migration *filenames* to the remote ledger does not catch this
-- well: this project's ledger legitimately contains entries with no file in the
-- repo (squashed address-search iterations, an orphaned `report_cache`), so a
-- filename diff is noisy in exactly the way that trains people to ignore it.
--
-- This asserts the thing that actually matters instead — that every database
-- object the application calls at runtime is present — and says which ones are
-- missing. It is deliberately a data-returning function rather than one that
-- raises: the caller decides whether a gap is fatal, and a partial answer is
-- more useful than an exception on the first missing object.
--
-- Adding a new table or RPC that the app depends on? Add it here too.

create or replace function assert_db_contract()
returns table (object_name text, kind text, present boolean)
language sql
stable
set search_path = public, pg_temp
as $$
  with required(object_name, kind) as (
    values
      -- Reference data and the report pipeline.
      ('properties',              'table'),
      ('violations',              'table'),
      ('property_seo_summaries',  'table'),
      -- Product state. `lookups` backs the free-tier limit; `reports` backs
      -- share links, which are the only delivery for the one-time tier.
      ('accounts',                'table'),
      ('lookups',                 'table'),
      ('reports',                 'table'),
      ('single_report_purchases', 'table'),
      ('rate_limits',             'table'),
      -- RPCs the app calls by name. A missing one is invisible to the type
      -- checker: these are string literals at every call site.
      ('claim_free_lookup',       'function'),
      ('free_lookups_remaining',  'function'),
      ('search_properties_smart', 'function'),
      ('consume_rate_limit',      'function'),
      ('prune_rate_limits',       'function')
  )
  select
    r.object_name,
    r.kind,
    case r.kind
      when 'table' then exists (
        select 1 from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = r.object_name and c.relkind in ('r','p')
      )
      when 'function' then exists (
        select 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = r.object_name
      )
      else false
    end as present
  from required r
  order by present, r.kind, r.object_name;
$$;

-- Readable by the service role only, same posture as the other operator tools.
-- It leaks nothing sensitive, but it is a deployment check, not an API.
revoke all on function assert_db_contract() from public, anon, authenticated;
