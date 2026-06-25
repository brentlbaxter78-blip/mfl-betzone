-- MFL Betzone Database Schema
-- Run this in Supabase SQL Editor (supabase.com → SQL Editor → New Query)

-- USERS TABLE
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  display_name text not null,
  password_hash text not null,
  balance numeric(10,2) default 0,
  cash_in numeric(10,2) default 0,
  cash_out numeric(10,2) default 0,
  privacy_public boolean default true,
  created_at timestamptz default now()
);

-- BETS TABLE
create table if not exists public.bets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  type text not null check (type in ('single','parlay')),
  status text not null default 'pending' check (status in ('pending','won','lost','cancelled')),
  stake numeric(10,2) not null,
  potential_win numeric(10,2) not null,
  legs jsonb not null,
  placed_at timestamptz default now()
);

-- TRANSACTIONS TABLE
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  type text not null check (type in ('deposit','withdraw')),
  amount numeric(10,2) not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz default now()
);

-- Disable RLS so our anon key can read/write freely (admin controls access via app logic)
alter table public.users disable row level security;
alter table public.bets disable row level security;
alter table public.transactions disable row level security;

-- Indexes for speed
create index if not exists bets_user_id_idx on public.bets(user_id);
create index if not exists transactions_user_id_idx on public.transactions(user_id);
create index if not exists users_username_idx on public.users(username);
