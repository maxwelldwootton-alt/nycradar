-- Security hardening flagged by Supabase's database linter.

-- 1. ingest_pluto_page is SECURITY DEFINER and was exposed over PostgREST to
--    the anon and authenticated roles, meaning anyone could trigger arbitrary
--    bulk ingests. It is an operator tool, not an API.
revoke all on function ingest_pluto_page(integer, integer) from public, anon, authenticated;

-- 2. Pin search_path on every function. Without it a caller-controlled
--    search_path can shadow the functions and operators these bodies resolve.
alter function normalize_address_text(text) set search_path = public, pg_temp;
alter function split_house_number(text)     set search_path = public, pg_temp;
alter function split_street(text)           set search_path = public, pg_temp;
alter function house_number_numeric(text)   set search_path = public, pg_temp;
alter function search_properties_smart(text, text, integer)
  set search_path = public, extensions, pg_temp;
alter function free_lookups_remaining(text) set search_path = public, pg_temp;

-- 3. Drop the search functions superseded by search_properties_smart. Unused
--    exposed RPCs are surface area for no benefit.
drop function if exists search_properties(text, text, integer);
drop function if exists search_properties_by_street(text, text, integer);

-- 4. Keep extensions out of the public schema.
alter extension pg_trgm set schema extensions;
