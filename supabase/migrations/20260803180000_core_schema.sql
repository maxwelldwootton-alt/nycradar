-- Core reference and violation schema.
--
-- Deliberately shaped the way a nightly ETL would need it, even though the MVP
-- populates `violations` on demand. Moving to full ingest later is a backfill
-- against this same schema rather than a rewrite.

create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- Properties: one row per NYC tax lot, sourced from PLUTO.
-- ---------------------------------------------------------------------------
create table if not exists properties (
  bbl              char(10) primary key,
  borough_code     char(1)  not null,
  block            integer  not null,
  lot              integer  not null,
  address          text,
  -- Uppercased, punctuation-stripped, street types abbreviated. This is what
  -- address search matches against; `address` stays as PLUTO wrote it.
  address_normalized text,
  zip              text,
  bldg_class       text,
  units_res        integer,
  owner_name       text,
  year_built       integer,
  -- Condominium billing lots start at 7501. DOB files violations against the
  -- underlying physical lot instead, which is why this flag drives a second
  -- lookup rather than being cosmetic.
  is_condo_billing_lot boolean generated always as (lot >= 7501) stored,
  underlying_bbl   char(10),
  updated_at       timestamptz not null default now(),

  constraint properties_borough_valid check (borough_code in ('1','2','3','4','5')),
  constraint properties_block_valid check (block > 0 and block <= 99999),
  constraint properties_lot_valid check (lot >= 0 and lot <= 9999)
);

create index if not exists properties_address_trgm_idx
  on properties using gin (address_normalized gin_trgm_ops);
create index if not exists properties_borough_idx on properties (borough_code);
create index if not exists properties_zip_idx on properties (zip);
create index if not exists properties_underlying_idx on properties (underlying_bbl);

comment on column properties.underlying_bbl is
  'Physical tax lot backing a condominium billing lot. DOB violations are filed here, not against the billing lot.';

-- ---------------------------------------------------------------------------
-- BBL <-> BIN. Indexed both ways so condo recovery is a single indexed read.
-- ---------------------------------------------------------------------------
create table if not exists property_bins (
  bbl char(10) not null,
  bin char(7)  not null,
  primary key (bbl, bin)
);

create index if not exists property_bins_bin_idx on property_bins (bin);

-- ---------------------------------------------------------------------------
-- Violations, normalized across all four sources.
-- ---------------------------------------------------------------------------
do $$ begin
  create type violation_agency as enum ('DOB', 'HPD', 'ECB', 'OATH');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type violation_status as enum ('open', 'closed', 'unknown');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type correction_type as enum ('administrative', 'physical', 'unknown');
exception when duplicate_object then null;
end $$;

create table if not exists violations (
  id                bigserial primary key,
  agency            violation_agency not null,
  source_dataset    text not null,
  source_id         text not null,
  -- Cross-source identity with leading zeros stripped. OATH ticket numbers are
  -- ECB violation numbers with a leading zero; without this the same summons
  -- counts twice.
  dedup_key         text,
  bbl               char(10) not null,
  bin               char(7),
  issued_date       date,
  status            violation_status not null default 'unknown',
  raw_status        text,
  severity          text,
  description       text,
  balance_due       numeric(12,2),
  penalty_imposed   numeric(12,2),
  -- Docketed judgments accrue interest and can become property liens. This is
  -- the deal-blocking signal the product leads with.
  judgment_docketed date,
  issuing_agency    text,
  correction_type   correction_type not null default 'unknown',
  -- Provenance: whether this row was matched by BBL or recovered via BIN.
  -- Needed to audit accuracy complaints.
  matched_by        text not null default 'bbl',
  raw               jsonb,
  fetched_at        timestamptz not null default now(),

  constraint violations_source_unique unique (source_dataset, source_id),
  constraint violations_matched_by_valid check (matched_by in ('bbl', 'bin'))
);

create index if not exists violations_bbl_status_idx on violations (bbl, status);
create index if not exists violations_bbl_agency_idx on violations (bbl, agency);
create index if not exists violations_dedup_idx on violations (dedup_key)
  where dedup_key is not null;
create index if not exists violations_judgment_idx on violations (bbl)
  where judgment_docketed is not null;

-- ---------------------------------------------------------------------------
-- Fetch provenance. Drives cache TTL and the report's data-as-of timestamp.
-- ---------------------------------------------------------------------------
create table if not exists property_fetches (
  bbl             char(10) not null,
  dataset_id      text not null,
  -- The portal's own rowsUpdatedAt, not our fetch time. Reporting our fetch
  -- time as "data as of" would overstate freshness.
  rows_updated_at timestamptz,
  fetched_at      timestamptz not null default now(),
  row_count       integer,
  primary key (bbl, dataset_id)
);

create index if not exists property_fetches_fetched_idx on property_fetches (fetched_at);

-- ---------------------------------------------------------------------------
-- Bulk ingest runs (PLUTO today, full violation ETL later).
-- ---------------------------------------------------------------------------
create table if not exists ingest_runs (
  id              bigserial primary key,
  dataset_id      text not null,
  rows_updated_at timestamptz,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  row_count       integer,
  status          text not null default 'running',
  error           text
);

-- ---------------------------------------------------------------------------
-- RLS. Reference data is readable by anyone but writable only by the service
-- role, which is the only identity the server-side report path uses.
-- ---------------------------------------------------------------------------
alter table properties      enable row level security;
alter table property_bins   enable row level security;
alter table violations      enable row level security;
alter table property_fetches enable row level security;
alter table ingest_runs     enable row level security;

drop policy if exists properties_read on properties;
create policy properties_read on properties for select using (true);

drop policy if exists property_bins_read on property_bins;
create policy property_bins_read on property_bins for select using (true);

-- Violations are served through server-side report generation only; no
-- anonymous client should be able to bulk-read the cache.
drop policy if exists violations_service_only on violations;
create policy violations_service_only on violations for select
  using (auth.role() = 'service_role');

drop policy if exists property_fetches_service_only on property_fetches;
create policy property_fetches_service_only on property_fetches for select
  using (auth.role() = 'service_role');

drop policy if exists ingest_runs_service_only on ingest_runs;
create policy ingest_runs_service_only on ingest_runs for select
  using (auth.role() = 'service_role');
