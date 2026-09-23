create table if not exists public.booking_orders (
  id uuid primary key default gen_random_uuid(),
  client_session_id uuid not null unique,
  service text not null default 'Moving & delivery',
  pickup text not null,
  drop_location text not null,
  pickup_date text not null,
  pickup_time text not null,
  items text not null,
  vehicle text,
  contact text not null,
  notes text,
  status text not null default 'confirmed' check (status in ('confirmed')),
  created_at timestamptz not null default now()
);

alter table public.booking_orders enable row level security;

-- This app writes through a server-only Supabase secret. No browser policy is needed.
