-- Close a TOCTOU race in the free tier: resolveAccess read
-- free_lookups_remaining and recordLookup inserted the usage row as two
-- separate statements, so two concurrent first-views for two different BBLs
-- could both observe an unused lookup and both get a free full report in the
-- same 30-day window. Folding the check and the insert into one statement,
-- serialized by a per-email advisory lock, makes the claim atomic.

create or replace function claim_free_lookup(
  p_email text,
  p_bbl char(10),
  p_address text,
  p_account_id uuid
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  claimed boolean;
begin
  -- Serialize concurrent claims for the same email; released automatically at
  -- transaction end.
  perform pg_advisory_xact_lock(hashtext(lower(p_email)));

  insert into lookups (account_id, email, bbl, address, entitlement)
  select p_account_id, p_email, p_bbl, p_address, 'free'
  where free_lookups_remaining(p_email) > 0
  returning true into claimed;

  return coalesce(claimed, false);
end;
$$;

revoke all on function claim_free_lookup(text, char(10), text, uuid) from public, anon, authenticated;
