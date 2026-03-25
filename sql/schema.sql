create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key,
  email text not null unique,
  display_name text not null,
  created_at timestamptz not null default now()
);

create table if not exists user_sessions (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists service_authorizations (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  service_key text not null,
  ws_endpoint text not null,
  allowed boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, service_key)
);

create table if not exists gateway_sessions (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  auth_session_id uuid not null references user_sessions(id) on delete cascade,
  service_key text not null,
  ws_endpoint text not null,
  status text not null,
  expires_at timestamptz not null,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_sessions_user_id_idx on user_sessions(user_id);
create index if not exists user_sessions_expires_idx on user_sessions(expires_at);
create index if not exists service_authorizations_user_id_idx on service_authorizations(user_id);
create index if not exists gateway_sessions_user_id_idx on gateway_sessions(user_id);
