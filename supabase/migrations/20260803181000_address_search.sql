-- Address normalization, PLUTO ingest, and property search.
--
-- This replaces the external geocoder the original design assumed. NYC's
-- GeoSearch and GeoClient are the obvious choice for address→BBL, but neither
-- is reachable from our build environment, and the spike measured direct
-- address matching against the violation datasets at only 70–78% accuracy with
-- 22% ambiguity. PLUTO is an authoritative address list (858,602 tax lots), so
-- resolving against it is more accurate *and* removes the external dependency.

-- ---------------------------------------------------------------------------
-- Normalization. MIRRORED EXACTLY in src/lib/nyc/address.ts.
-- A divergence does not error — it silently returns no search results — so
-- tests/address-parity.live.test.ts asserts the two agree on real data.
-- ---------------------------------------------------------------------------
create or replace function normalize_address_text(input text)
returns text
language plpgsql
immutable
as $$
declare
  cleaned text;
  tok text;
  out_tokens text[] := '{}';
begin
  if input is null then
    return null;
  end if;

  cleaned := upper(input);
  -- Elide apostrophes rather than splitting on them: "ST ANN'S AVENUE" must
  -- become "ST ANNS AVE" to match a user typing "St Anns Avenue".
  cleaned := replace(cleaned, '''', '');
  cleaned := regexp_replace(cleaned, '[.,#]', ' ', 'g');
  cleaned := regexp_replace(cleaned, '\m(\d+)(ST|ND|RD|TH)\M', '\1', 'g');
  cleaned := trim(regexp_replace(cleaned, '\s+', ' ', 'g'));

  if cleaned = '' then
    return null;
  end if;

  foreach tok in array string_to_array(cleaned, ' ') loop
    out_tokens := out_tokens || case tok
      -- Street types are ABBREVIATED, never dropped: removing them would
      -- collapse "5 AVENUE" and "5 STREET" onto the same key.
      when 'STREET'     then 'ST'
      when 'AVENUE'     then 'AVE'
      when 'BOULEVARD'  then 'BLVD'
      when 'PLACE'      then 'PL'
      when 'ROAD'       then 'RD'
      when 'DRIVE'      then 'DR'
      when 'COURT'      then 'CT'
      when 'LANE'       then 'LN'
      when 'TERRACE'    then 'TER'
      when 'PARKWAY'    then 'PKWY'
      when 'PLAZA'      then 'PLZ'
      when 'SQUARE'     then 'SQ'
      when 'HIGHWAY'    then 'HWY'
      when 'TURNPIKE'   then 'TPKE'
      when 'EXPRESSWAY' then 'EXPY'
      when 'CIRCLE'     then 'CIR'
      when 'NORTH'      then 'N'
      when 'SOUTH'      then 'S'
      when 'EAST'       then 'E'
      when 'WEST'       then 'W'
      -- PLUTO spells out numbered thoroughfares ("FIFTH AVENUE") while users
      -- type "5th Ave".
      when 'FIRST'      then '1'
      when 'SECOND'     then '2'
      when 'THIRD'      then '3'
      when 'FOURTH'     then '4'
      when 'FIFTH'      then '5'
      when 'SIXTH'      then '6'
      when 'SEVENTH'    then '7'
      when 'EIGHTH'     then '8'
      when 'NINTH'      then '9'
      when 'TENTH'      then '10'
      when 'ELEVENTH'   then '11'
      when 'TWELFTH'    then '12'
      else tok
    end;
  end loop;

  return nullif(array_to_string(out_tokens, ' '), '');
end;
$$;

create or replace function split_house_number(normalized text)
returns text language sql immutable as $$
  select (regexp_match(coalesce(normalized, ''), '^([0-9]+(?:-[0-9]+)?[A-Z]?)\s'))[1];
$$;

create or replace function split_street(normalized text)
returns text language sql immutable as $$
  select coalesce(
    (regexp_match(coalesce(normalized, ''), '^[0-9]+(?:-[0-9]+)?[A-Z]?\s+(.*)$'))[1],
    normalized
  );
$$;

-- Queens house numbers are hyphenated ("114-15"); the leading segment is what
-- orders sensibly along a street.
create or replace function house_number_numeric(hn text)
returns integer language plpgsql immutable as $$
declare head text;
begin
  head := regexp_replace(split_part(coalesce(hn, ''), '-', 1), '[^0-9]', '', 'g');
  if head = '' then return null; end if;
  return head::integer;
end;
$$;

alter table properties add column if not exists house_number text;
alter table properties add column if not exists street_normalized text;

create index if not exists properties_street_trgm_idx
  on properties using gin (street_normalized gin_trgm_ops);
create index if not exists properties_house_idx
  on properties (house_number) where house_number is not null;

-- ---------------------------------------------------------------------------
-- Bulk PLUTO ingest, run in-database via the http extension so the load needs
-- no external worker. Paged and idempotent — a partial load resumes cleanly.
-- ---------------------------------------------------------------------------
create extension if not exists http with schema extensions;

create or replace function ingest_pluto_page(p_offset integer, p_limit integer default 5000)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  url text;
  payload jsonb;
  inserted integer;
begin
  url := 'https://data.cityofnewyork.us/resource/64uk-42ks.json'
      || '?$select=bbl,borough,block,lot,address,zipcode,bldgclass,unitsres,ownername,yearbuilt'
      || '&$order=bbl&$limit=' || p_limit || '&$offset=' || p_offset;

  select content::jsonb into payload from extensions.http_get(url);

  if payload is null or jsonb_array_length(payload) = 0 then
    return 0;
  end if;

  with rows as (
    select
      lpad(split_part(r->>'bbl', '.', 1), 10, '0') as bbl_clean,
      r->>'address' as address, r->>'zipcode' as zip,
      r->>'bldgclass' as bldg_class, r->>'unitsres' as units_res,
      r->>'ownername' as owner_name, r->>'yearbuilt' as year_built
    from jsonb_array_elements(payload) as r
  ),
  valid as (
    select
      bbl_clean as bbl,
      left(bbl_clean, 1) as borough_code,
      substr(bbl_clean, 2, 5)::integer as block,
      substr(bbl_clean, 7, 4)::integer as lot,
      address,
      normalize_address_text(address) as address_normalized,
      split_house_number(normalize_address_text(address)) as house_number,
      split_street(normalize_address_text(address)) as street_normalized,
      zip, bldg_class,
      nullif(units_res, '')::numeric::integer as units_res,
      owner_name,
      nullif(year_built, '')::numeric::integer as year_built
    from rows
    where bbl_clean ~ '^[1-5][0-9]{9}$'
      and substr(bbl_clean, 2, 5)::integer between 1 and 99999
      and substr(bbl_clean, 7, 4)::integer between 0 and 9999
  )
  insert into properties (
    bbl, borough_code, block, lot, address, address_normalized,
    house_number, street_normalized, zip, bldg_class, units_res,
    owner_name, year_built, updated_at
  )
  select bbl, borough_code, block, lot, address, address_normalized,
         house_number, street_normalized, zip, bldg_class, units_res,
         owner_name, year_built, now()
  from valid
  on conflict (bbl) do update set
    address = excluded.address,
    address_normalized = excluded.address_normalized,
    house_number = excluded.house_number,
    street_normalized = excluded.street_normalized,
    zip = excluded.zip,
    bldg_class = excluded.bldg_class,
    units_res = excluded.units_res,
    owner_name = excluded.owner_name,
    year_built = excluded.year_built,
    updated_at = now();

  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

-- ---------------------------------------------------------------------------
-- Cascading search: exact house number -> nearest on street -> street only.
-- ---------------------------------------------------------------------------
create or replace function search_properties_smart(
  q text, boro text default null, lim integer default 10
)
returns table (
  bbl char(10), address text, borough_code char(1), zip text, bldg_class text,
  units_res integer, is_condo_billing_lot boolean, score real, match_type text
)
language plpgsql stable as $$
declare
  n text; house text; street text; house_num integer; found integer;
  -- 0.8, not lower: "ROCKAWAY BEACH BLVD" scores 0.74 against "ROCKAWAY BLVD",
  -- a genuinely different Queens street. Confidently returning the wrong
  -- building is the costliest error this product can make, so near-misses fall
  -- through to the clearly-labelled "nearby" tier instead.
  exact_threshold constant real := 0.8;
begin
  n := normalize_address_text(q);
  if n is null then return; end if;
  house := split_house_number(n);
  street := split_street(n);
  house_num := house_number_numeric(house);

  if house is not null then
    return query
    select p.bbl, p.address, p.borough_code, p.zip, p.bldg_class, p.units_res,
           p.is_condo_billing_lot, similarity(p.street_normalized, street), 'exact'::text
    from properties p
    where p.house_number = house
      and (boro is null or p.borough_code = boro)
      and (p.street_normalized = street
           or similarity(p.street_normalized, street) >= exact_threshold)
    order by (p.street_normalized = street) desc,
             similarity(p.street_normalized, street) desc,
             coalesce(p.units_res, 0) desc, p.bbl
    limit lim;
    get diagnostics found = row_count;
    if found > 0 then return; end if;
  end if;

  -- PLUTO stores one *primary* address per tax lot, not every alias. The
  -- Empire State Building's lot is "338 5 AVENUE" in PLUTO, so a user typing
  -- the colloquial "350 5th Ave" would otherwise get nothing. Full alias
  -- coverage needs DCP's PAD file, which is a download rather than an API.
  if house_num is not null then
    return query
    select p.bbl, p.address, p.borough_code, p.zip, p.bldg_class, p.units_res,
           p.is_condo_billing_lot, similarity(p.street_normalized, street), 'nearby'::text
    from properties p
    where (boro is null or p.borough_code = boro)
      and p.street_normalized = street
      and house_number_numeric(p.house_number) is not null
    order by abs(house_number_numeric(p.house_number) - house_num),
             coalesce(p.units_res, 0) desc, p.bbl
    limit lim;
    get diagnostics found = row_count;
    if found > 0 then return; end if;
  end if;

  return query
  select p.bbl, p.address, p.borough_code, p.zip, p.bldg_class, p.units_res,
         p.is_condo_billing_lot, similarity(p.address_normalized, n), 'street'::text
  from properties p
  where (boro is null or p.borough_code = boro)
    and p.address_normalized is not null
    and p.address_normalized % n
  order by (p.address_normalized = n) desc,
           similarity(p.address_normalized, n) desc,
           coalesce(p.units_res, 0) desc, p.bbl
  limit lim;
end;
$$;
