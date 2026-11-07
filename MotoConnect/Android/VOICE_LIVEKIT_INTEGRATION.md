# MotoConnect voice integration — LiveKit

## Current implementation step

- Added the official Flutter client SDK (livekit_client).
- Added LiveKitVoiceService, a small transport adapter for joining/leaving a room and muting/unmuting the microphone.
- The existing Moto Sport screens and navigation are intentionally unchanged.

## Security boundary

The mobile app must receive a short-lived participant token from the MotoConnect backend. The LiveKit API secret must never be included in Flutter code, app assets, build arguments, or a distributed APK.

The backend token endpoint must:
1. Authenticate the MotoConnect user.
2. Check that the account is approved and not blocked.
3. Check that the user is allowed to join the requested channel or private call.
4. Mint a short-lived LiveKit token with only the required room grants.
5. Return the LiveKit WebSocket URL and participant token over HTTPS.

## Not enabled yet

This is the client transport foundation, not a completed calling feature. A secure authenticated backend/token endpoint, room membership rules, participant UI, call state handling, Bluetooth hardware-button handling, background-call behaviour, and real-device tests are still required.

Music ducking (reduce the current music volume by 50% during a call and restore it afterwards) remains a required MotoConnect feature, but must be implemented and verified against Android audio-session behaviour and supported music apps. It is not silently treated as completed by this SDK addition.

## Configuration contract for the next step

The app will receive serverUrl and participantToken at runtime from the authenticated backend. Do not hardcode either value in source control. The token is short-lived and scoped to a single room.
