-- Accounts, usage tracking, shareable reports, and billing state.
-- Applied to the hosted project; kept here so the repo is the source of truth.

create table if not exists accounts (
  id                    uuid primary key references auth.users(id) on delete cascade,
  email                 text not null,
  stripe_customer_id    text unique,
  -- Mirrors Stripe. The webhook is the sole writer; never trust client state.
  subscription_status   text,
  subscription_price_id text,
  current_period_end    timestamptz,
  created_at            timestamptz not null default now()
);
create index if not exists accounts_email_idx on accounts (lower(email));
create index if not exists accounts_stripe_idx on accounts (stripe_customer_id);

-- Every report generation. Backs both the free-tier rate limit (FR4) and the
-- subscriber lookup history (FR8).
create table if not exists lookups (
  id          bigserial primary key,
  account_id  uuid references accounts(id) on delete set null,
  -- Free-tier users may have no account, so the limit is keyed on email.
  email       text,
  bbl         char(10) not null,
  address     text,
  entitlement text not null,
  created_at  timestamptz not null default now(),
  constraint lookups_entitlement_valid
    check (entitlement in ('free', 'subscription', 'single_purchase', 'shared'))
);
create index if not exists lookups_email_created_idx
  on lookups (lower(email), created_at desc) where email is not null;
create index if not exists lookups_account_created_idx
  on lookups (account_id, created_at desc) where account_id is not null;

-- Shareable read-only reports (FR6, Flow C).
--
-- Stores a *snapshot* rather than regenerating on view: the recipient must see
-- exactly what the sender saw, with the sender's data-as-of date. Regenerating
-- would silently show different numbers than the person who shared it described.
create table if not exists reports (
  id         uuid primary key default gen_random_uuid(),
  token      text not null unique,
  bbl        char(10) not null,
  address    text,
  snapshot   jsonb not null,
  data_as_of timestamptz,
  account_id uuid references accounts(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);
create index if not exists reports_token_idx on reports (token);
create index if not exists reports_account_idx on reports (account_id, created_at desc);

-- One-time $49 purchases (FR5a) — deliberately not tied to an account, since
-- that path requires no signup.
create table if not exists single_report_purchases (
  id                    bigserial primary key,
  stripe_session_id     text not null unique,
  stripe_payment_intent text,
  email                 text,
  bbl                   char(10) not null,
  report_id             uuid references reports(id) on delete set null,
  amount_total          integer,
  status                text not null default 'pending',
  created_at            timestamptz not null default now()
);
create index if not exists single_purchases_email_idx
  on single_report_purchases (lower(email));

-- Free tier: one lookup per email per rolling 30 days (FR4).
create or replace function free_lookups_remaining(p_email text)
returns integer
language sql
stable
as $$
  select greatest(0, 1 - count(*)::integer)
  from lookups
  where email is not null
    and lower(email) = lower(p_email)
    and entitlement = 'free'
    and created_at > now() - interval '30 days';
$$;

alter table accounts                enable row level security;
alter table lookups                 enable row level security;
alter table reports                 enable row level security;
alter table single_report_purchases enable row level security;

-- Users see only their own rows. Everything else goes through server-side
-- routes using the service role.
drop policy if exists accounts_self on accounts;
create policy accounts_self on accounts for select using (auth.uid() = id);

drop policy if exists lookups_self on lookups;
create policy lookups_self on lookups for select using (auth.uid() = account_id);

drop policy if exists reports_self on reports;
create policy reports_self on reports for select using (auth.uid() = account_id);

-- Share links are intentionally unauthenticated, but are resolved by a server
-- route using the service role rather than by exposing the table anonymously.
drop policy if exists purchases_service_only on single_report_purchases;
create policy purchases_service_only on single_report_purchases for select
  using (auth.role() = 'service_role');
