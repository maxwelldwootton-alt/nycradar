-- Rate limiting for the unauthenticated surfaces.
--
-- The problem this solves is a cost and availability one, not an abuse one.
-- `/property/[bbl]` renders for *any* of NYC's ~858k tax lots with no
-- `generateStaticParams`, and every uncached render fans out to roughly six
-- SODA calls against NYC Open Data. A crawler that discovers the URL shape, or
-- anyone enumerating BBLs, can therefore burn the app's entire Socrata quota
-- on pages nobody asked for — and once throttled, paying customers get
-- degraded reports.
--
-- Postgres rather than an in-memory counter because Vercel runs many isolated
-- instances: a per-instance map would let the effective limit scale with
-- however many lambdas happen to be warm, which is not a limit.

create table if not exists rate_limits (
  bucket       text primary key,
  window_start timestamptz not null default now(),
  count        integer     not null default 0
);

-- Only ever touched by the service role through `consume_rate_limit`. RLS on
-- with no policy is the correct end state here, not an oversight.
alter table rate_limits enable row level security;

/**
 * Consume one unit from a bucket. Returns true when the caller is under limit.
 *
 * The whole check-and-increment is a single `insert ... on conflict do update`
 * so it is atomic under concurrency: the row lock taken by the upsert is what
 * makes two simultaneous requests unable to both read the same pre-increment
 * count. A read-then-write pair here would be the same TOCTOU bug that
 * `claim_free_lookup` exists to fix on the free tier.
 *
 * Fixed window rather than sliding — a sliding window needs per-request
 * timestamps and this table would then grow with traffic rather than with the
 * number of distinct buckets. The cost is that a caller can spend two windows'
 * worth of budget across a window boundary, which for a quota guard is fine.
 */
create or replace function consume_rate_limit(
  p_bucket         text,
  p_limit          integer,
  p_window_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
  v_cutoff timestamptz := now() - make_interval(secs => p_window_seconds);
begin
  insert into rate_limits as rl (bucket, window_start, count)
  values (p_bucket, now(), 1)
  on conflict (bucket) do update
    set count        = case when rl.window_start < v_cutoff then 1 else rl.count + 1 end,
        window_start = case when rl.window_start < v_cutoff then now() else rl.window_start end
  returning rl.count into v_count;

  return v_count <= p_limit;
end;
$$;

/**
 * Drop buckets whose window closed long ago.
 *
 * Without this the table accumulates one permanent row per distinct client IP
 * ever seen. Called opportunistically from the app rather than on a schedule,
 * so there is no cron dependency to forget to set up.
 */
create or replace function prune_rate_limits(p_older_than_seconds integer default 86400)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted integer;
begin
  delete from rate_limits
  where window_start < now() - make_interval(secs => p_older_than_seconds);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- Operator/server-side only. An RPC that lets a caller name its own bucket and
-- limit is trivially defeated if the client can call it directly.
revoke all on function consume_rate_limit(text, integer, integer)
  from public, anon, authenticated;
revoke all on function prune_rate_limits(integer)
  from public, anon, authenticated;
