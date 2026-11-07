# MotoConnect Voice API

A small Node.js service that issues short-lived LiveKit participant tokens.

## Required environment variables

Copy .env.example into the deployment environment and set real values there. Never commit real credentials.

- PORT — HTTP port (defaults to 8080).
- LIVEKIT_URL — LiveKit Cloud WebSocket URL, usually wss://...
- LIVEKIT_API_KEY — LiveKit project API key.
- LIVEKIT_API_SECRET — LiveKit project API secret. Server-side only.
- APP_JWT_SECRET — secret used by the MotoConnect authentication service to sign app access tokens.

## Authentication contract

The authentication service must issue HS256 JWTs with issuer motoconnect-auth and these claims:

- sub: stable MotoConnect user ID.
- approved: true only after admin approval.
- blocked: true for blocked accounts.
- voiceRooms: array of room names the user is currently permitted to join.
- name: optional display name.

The voice API checks these claims and verifies room membership before minting a token. Do not expose this endpoint to unauthenticated clients.

## Endpoint

POST /api/voice/token

Authorization: Bearer <MotoConnect app access token>

JSON body:

{
  "roomName": "proximity-main"
}

Success response contains serverUrl and participantToken. The participant token expires after five minutes and is scoped to that one room.

## Local run

1. Install Node.js 20 or newer.
2. Run npm install.
3. Set the environment variables listed above.
4. Run npm start.

The /health endpoint is intended for deployment health checks.

## Important

This API is not a substitute for the main MotoConnect authentication and membership database. Until that service exists and issues the documented JWT claims, token issuance must remain unavailable. Never use a hard-coded shared token or put LiveKit API secrets in the Flutter app.
