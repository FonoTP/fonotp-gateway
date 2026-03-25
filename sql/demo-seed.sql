create extension if not exists pgcrypto;

insert into users (id, email, display_name)
values
  ('11111111-1111-1111-1111-111111111111', 'demo.voice@example.com', 'Demo Voice User')
on conflict (id) do update
set
  email = excluded.email,
  display_name = excluded.display_name;

insert into user_sessions (id, user_id, token_hash, expires_at, revoked_at)
values (
  '22222222-2222-2222-2222-222222222222',
  '11111111-1111-1111-1111-111111111111',
  crypt('demo-user-token', gen_salt('bf')),
  now() + interval '30 days',
  null
)
on conflict (id) do update
set
  token_hash = crypt('demo-user-token', gen_salt('bf')),
  expires_at = now() + interval '30 days',
  revoked_at = null;

insert into service_authorizations (id, user_id, service_key, ws_endpoint, allowed)
values (
  '33333333-3333-3333-3333-333333333333',
  '11111111-1111-1111-1111-111111111111',
  'voice-realtime-demo',
  'ws://127.0.0.1:9000',
  true
)
on conflict (user_id, service_key) do update
set
  ws_endpoint = excluded.ws_endpoint,
  allowed = excluded.allowed;
