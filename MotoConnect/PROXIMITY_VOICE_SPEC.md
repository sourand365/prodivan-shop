# MotoConnect proximity voice — implementation specification

## Goal

Keep MotoConnect presence independent from LiveKit voice participation. A user may be online and visible on the map without joining any LiveKit room. Proximity voice should connect only when the server confirms that the user belongs to a nearby group.

## Proximity grouping

- Use the existing MotoConnect proximity rule: an undirected graph where two online users are adjacent when their latest valid GPS positions are no more than 1,000 metres apart.
- A proximity group is a connected component of that graph. This preserves chain connectivity: A can hear C through B even if A and C are more than 1 km apart, provided A-B and B-C are each within 1 km.
- Only approved, unblocked users who have enabled online/proximity availability and have fresh location data may be included.
- Location is considered stale after 90 seconds without a successful update; stale users are removed from the graph.
- Do not expose exact coordinates to other clients. The presence service uses coordinates server-side and returns only group membership, participant count, and an opaque room identifier.

## Voice lifecycle

1. App sign-in and online presence do not connect LiveKit.
2. While the user is online and proximity availability is enabled, the app sends authenticated location/presence updates.
3. If the server reports a proximity component with at least two members, the app requests a short-lived token for that component's room and joins it.
4. If the component falls to one member, the app leaves the proximity room. Use a short 30-second grace period before leaving to avoid churn from GPS jitter or brief signal loss.
5. If location permission is denied, GPS is disabled, or location becomes stale, do not create or keep a proximity voice session. Keep the account's normal online status separate where possible.
6. When the user goes offline, stop presence updates and disconnect proximity voice.

## Room identity and reconnection

- The server, not the client, computes the component and assigns its opaque room ID.
- When the component changes because users move, the server returns the new room ID. The client joins the new room and leaves the old one in a controlled transition.
- Room authorization must be checked against current server-side membership. Do not trust a room name supplied by the client or a stale room list embedded in a long-lived JWT.
- Reconcile room membership after app resume, network reconnection, and token renewal.

## Manual calls and groups

- Manually initiated private calls and user-selected group rooms are independent of proximity.
- Proximity leaving must never disconnect a manual call or selected group call.
- If a user is already in a manual room, proximity voice should not silently move that user to another room. The UI must show which mode is active; any future simultaneous-room behaviour needs explicit product design.

## Battery, privacy, and reliability

- Use a balanced location mode, not continuous high-accuracy GPS by default. Adjust update frequency based on movement and platform background limits.
- Do not send location more often than needed; target 15–30 second updates while moving and slower updates while stationary, subject to Android background restrictions.
- Do not store a long-term location trail for this feature. Retain only the latest presence position and short expiry metadata.
- Handle GPS jitter with a small distance hysteresis and the 30-second leave grace period.
- If presence service is unavailable, fail closed for proximity voice: remain online if possible, but do not join a guessed room.
- Never put LiveKit API credentials in the Flutter app. The backend issues short-lived, room-scoped participant tokens only after checking current membership.

## Important billing behaviour

A participant consumes LiveKit participant minutes for as long as they are connected to a LiveKit room, including when muted or when no one is speaking. Therefore the client must disconnect from the proximity room when the group has no other eligible member; merely muting the microphone is not sufficient.

## Implementation dependencies / not yet complete

This specification does not claim the feature is implemented. The current branch has the LiveKit transport adapter and token API foundation, but still needs:
- MotoConnect account authentication and persistent approved-user records.
- An authenticated presence/location API with shared persistent state (not per-process memory).
- Server-side connected-component calculation and room authorization.
- Android location permissions, location updates, lifecycle/background handling, and privacy controls.
- Flutter proximity state coordinator and LiveKit auto-join/leave integration.
- Tests for movement, chain groups, stale GPS, network loss, manual calls, and actual Android devices.
