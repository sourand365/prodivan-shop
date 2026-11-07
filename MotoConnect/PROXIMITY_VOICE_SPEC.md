# MotoConnect proximity voice — implementation specification

## Confirmed proximity rule

Use an undirected graph of eligible online users. Two users are directly connected when their latest valid GPS positions are at most 1,000 metres apart. A voice group is the full connected component, not a strict 1 km circle around every member. Therefore A hears C through B when A-B and B-C are each within 1 km, even if A-C is 1.6 km apart.

The map still draws a 1 km radius circle around the current user's own marker. Nearby eligible users are shown as approximate map markers and are in the same voice component if connected by the chain rule.

## Eligibility and privacy

- Only authenticated Telegram-verified accounts that opted into online/proximity availability participate.
- Location is stale after 90 seconds without an update and then removed from proximity.
- The app must ask permission and explain that enabling proximity shares an approximate live location with other eligible MotoConnect users.
- Never expose raw GPS coordinates. Return coordinates rounded to 4 decimal places for map markers, plus rounded distance. The user's own device keeps its precise location locally.
- Provide an explicit online/proximity toggle and an offline action. Turning it off immediately removes the user's location and voice membership.
- Do not retain a location history; persist only the latest location and expiry timestamp.

## Account and Telegram authentication

- A Telegram bot verifies the Telegram account using a one-time deep-link challenge initiated by the app.
- The first verified Telegram account receives a permanent generated MotoConnect ID. The ID is stable across logout/login and is not the Telegram numeric ID.
- Subsequent logins link to the existing account by Telegram user ID.
- Access tokens are short-lived; refresh tokens are random, stored hashed, rotated on refresh, and revoked on logout.
- Never ask users to send passwords or Telegram login codes to the bot. Never place bot tokens or LiveKit secrets in the app.

## Voice lifecycle

1. Sign-in and online presence do not automatically enable the microphone. The user must enable proximity availability and grant microphone permission.
2. While online and proximity availability is enabled, the app sends authenticated location/presence updates.
3. If the server reports a component with at least two members, the app requests a short-lived token for that component's room and joins it.
4. If the component falls to one member, leave after a 30-second grace period to avoid GPS jitter and brief signal loss.
5. If location permission is denied, GPS is disabled, or location becomes stale, do not create or keep a proximity voice session.
6. When the user goes offline, stop presence updates and disconnect proximity voice.
7. Proximity calls remain separate from manually selected private/group calls. A proximity transition must not silently disconnect a manual call.

## Room authorization

- Server calculates connected components and room IDs. The client cannot choose arbitrary room names.
- Every token request checks current server-side component membership, not a room list in a stale JWT.
- Reconcile membership after app resume, network reconnect, and token renewal.
- Room name is opaque and derived from the sorted stable user IDs in the current component.

## Battery and reliability

- Use balanced location accuracy; target 15–30 second updates while moving and slower updates while stationary, respecting Android background limits.
- Use a 30-second leave grace period and distance hysteresis for GPS jitter.
- Fail closed for proximity voice if the presence service is unavailable.
- A muted LiveKit participant still consumes participant minutes. Disconnect when alone/offline rather than merely muting.

## Implementation status

This branch is implementing the server foundation: Telegram deep-link authentication, stable user IDs, refresh/logout sessions, ephemeral presence, connected-component calculation, and room-scoped LiveKit tokens. The Flutter login UI, live map markers/circle, automatic room transitions, production deployment, and real-device voice testing are separate integration steps and must not be represented as complete until tested.
