# WebRTC Gateway Server

This project provides a WebRTC gateway for real-time voice. A browser or mobile client sends audio over WebRTC, the gateway validates the user and authorized service against PostgreSQL, and then bridges audio to a downstream WebSocket voice service.

This repository also includes:

- A browser demo UI
- A mock downstream voice WebSocket service
- PostgreSQL schema and demo seed data

## What Is Included

- `src/server.js`: Fastify server and static asset hosting
- `src/routes.js`: health, bootstrap, create-session, and close-session APIs
- `src/webrtc-gateway.js`: WebRTC peer connection and audio bridge lifecycle
- `src/audio-bridge.js`: binary audio framing over WebSocket
- `src/mock-voice-service.js`: local mock downstream voice service
- `public/`: browser demo
- `sql/schema.sql`: database schema
- `sql/demo-seed.sql`: demo user, session, and service authorization seed

## Requirements

- Node.js 20+
- npm 10+
- PostgreSQL with `pgcrypto` available
- A browser with microphone access enabled

## Install

```bash
npm install
```

## Configuration

Copy the example environment file:

```bash
cp .env.example .env
```

Default environment values:

```env
PORT=8080
HOST=0.0.0.0
LOG_LEVEL=info
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/fonotp
SESSION_TTL_SECONDS=900
AUTH_BEARER_PREFIX=Bearer
ALLOWED_SERVICE_ORIGINS=ws://127.0.0.1:9000,wss://voice.example.com
ICE_SERVERS=[{"urls":"stun:stun.l.google.com:19302"}]
DEMO_DEFAULT_TOKEN=demo-user-token
```

Important variables:

- `DATABASE_URL`: PostgreSQL connection string for gateway auth and session state
- `ALLOWED_SERVICE_ORIGINS`: comma-separated allowlist for downstream WebSocket service origins
- `ICE_SERVERS`: JSON array of ICE server definitions used by the backend peer connection
- `DEMO_DEFAULT_TOKEN`: token prefilled in the browser demo

## PostgreSQL Setup

Create the database if needed:

```bash
createdb fonotp
```

Load the schema:

```bash
psql -d fonotp -f sql/schema.sql
```

Load the demo data:

```bash
psql -d fonotp -f sql/demo-seed.sql
```

The schema creates these tables:

- `users`
- `user_sessions`
- `service_authorizations`
- `gateway_sessions`

The auth model expects:

- `user_sessions.token_hash` to be stored with `crypt(...)`
- `service_authorizations` to contain one row per authorized user and service
- `gateway_sessions` to be used for live session tracking and audit state

## Demo Seed Data

The demo seed creates:

- User: `demo.voice@example.com`
- Display name: `Demo Voice User`
- Bearer token: `demo-user-token`
- Authorized service: `voice-realtime-demo`
- Authorized downstream WebSocket endpoint: `ws://127.0.0.1:9000`

## Running The Local Demo

Open two terminals.

Terminal 1: start the mock downstream voice service.

```bash
npm run mock:voice
```

Expected output:

```text
Mock voice service listening on ws://127.0.0.1:9000
```

Terminal 2: start the gateway.

```bash
npm start
```

Then open:

```text
http://127.0.0.1:8080
```

In the browser:

1. Leave the default token as `demo-user-token`, or paste another valid bearer token.
2. Click `Load Profile`.
3. Confirm the authorized service dropdown is populated.
4. Click `Connect`.
5. Allow microphone access when the browser prompts.
6. Speak into the microphone.
7. Listen for the returned audio from the mock voice service.
8. Click `Disconnect` to close the session.

What you should see in the UI:

- User details after profile load
- Session state transitions such as `authorizing`, `connecting`, and `connected`
- A mic level meter
- A remote audio player
- A log of gateway and peer connection events

## Running Without The Demo UI

You can also run only the backend and use your own client:

```bash
npm start
```

The backend serves:

- `GET /health`
- `GET /api/demo/bootstrap`
- `POST /api/webrtc/session`
- `DELETE /api/webrtc/session/:sessionId`

## API

### `GET /health`

Returns a simple health payload.

Example response:

```json
{
  "status": "ok",
  "service": "webrtc-gateway",
  "requestId": "..."
}
```

### `GET /api/demo/bootstrap`

Returns the authenticated user and their authorized services for the browser demo.

Headers:

- `Authorization: Bearer <session-token>`

Example response:

```json
{
  "userId": "11111111-1111-1111-1111-111111111111",
  "email": "demo.voice@example.com",
  "displayName": "Demo Voice User",
  "expiresAt": "2026-04-24T00:00:00.000Z",
  "services": [
    {
      "serviceKey": "voice-realtime-demo",
      "wsEndpoint": "ws://127.0.0.1:9000"
    }
  ],
  "bearerPrefix": "Bearer"
}
```

### `POST /api/webrtc/session`

Creates a gateway session from a client SDP offer.

Headers:

- `Authorization: Bearer <session-token>`
- `Content-Type: application/json`

Request body:

```json
{
  "offerSdp": "v=0\r\n...",
  "serviceKey": "voice-realtime-demo",
  "wsEndpoint": "ws://127.0.0.1:9000"
}
```

Notes:

- `offerSdp` is required
- `serviceKey` is required
- `wsEndpoint` is optional, but if provided it must match an allowed origin
- The service key must already be authorized for the authenticated user

Example response:

```json
{
  "sessionId": "9f4fc57f-03ea-4b78-9db0-86c0e2b928f0",
  "answerSdp": "v=0\r\n...",
  "expiresAt": "2026-03-25T12:00:00.000Z"
}
```

### `DELETE /api/webrtc/session/:sessionId`

Closes an active gateway session.

Headers:

- `Authorization: Bearer <session-token>`

Behavior:

- Only the owning user can close the session
- Returns `204 No Content` on success

## WebSocket Downstream Framing

The downstream voice service uses a simple binary frame protocol.

- Byte `0x01`: 16-bit PCM mono audio at 48kHz, little-endian
- Byte `0x02`: ping/pong keepalive

When a gateway session starts, the gateway first emits:

```json
{
  "type": "gateway.session.started",
  "sessionId": "..."
}
```

The mock voice service responds with JSON control messages and streams a generated tone back as PCM frames.

## Security Model

Connection establishment is gated by:

- Bearer token validation from `user_sessions`
- Expiration checks on the auth session
- Revocation checks on the auth session
- Service-level authorization from `service_authorizations`
- WebSocket destination allowlisting through `ALLOWED_SERVICE_ORIGINS`

This demo is intentionally simple. For production use, you would usually also add:

- HTTPS and WSS termination
- Token issuance and refresh flow
- CSRF/origin restrictions for web clients where needed
- Structured audit logging and rate limiting
- TURN servers for difficult network environments

## Useful Commands

Install dependencies:

```bash
npm install
```

Run the gateway:

```bash
npm start
```

Run the gateway in watch mode:

```bash
npm run dev
```

Run the mock downstream voice service:

```bash
npm run mock:voice
```

Run syntax checks:

```bash
npm run check
node --check public/app.js
node --check src/mock-voice-service.js
```

## Troubleshooting

- If `Load Profile` fails, check that PostgreSQL is running and `sql/demo-seed.sql` has been applied.
- If `Connect` fails immediately, verify the bearer token is valid and the selected service is authorized for that user.
- If the browser never reaches `connected`, verify the gateway and mock voice service are both running.
- If you do not hear audio, confirm microphone permission was granted and the browser audio output is not muted.
- If the downstream connection is rejected, check `ALLOWED_SERVICE_ORIGINS`.
- If `npm install` fails on WebRTC dependencies, verify your local Node toolchain is compatible with `@roamhq/wrtc`.

## Notes

- The backend peer connection uses `@roamhq/wrtc`.
- The current audio bridge assumes mono 48kHz PCM frames on the WebSocket boundary.
- The browser demo is intentionally thin and exists to validate the full auth plus media path locally.
