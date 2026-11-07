# MotoConnect Flutter app (Android-first)

## Build

From this folder with Flutter SDK and Android SDK installed:

```bash
flutter create --platforms=android --project-name moto_connect .
flutter pub get
flutter analyze
flutter test
flutter build apk --debug --dart-define=MOTOCONNECT_API_URL=https://YOUR_API_HOST
```

APK output: `build/app/outputs/flutter-apk/app-debug.apk`.

GitHub Actions builds the APK and reads the API base URL from the repository secret `MOTOCONNECT_API_URL`. The Maps key comes from `MAPS_API_KEY`.

## Implemented client foundations

- Moto Sport dark black/yellow interface and Odesa Google Map.
- Telegram deep-link sign-in screen and persistent account ID display.
- Access/refresh token storage using Android secure storage.
- Session restoration and logout.
- Opt-in proximity presence with a 1 km circle around the user's current map marker.
- Approximate markers for users in the same connected proximity component.
- Foreground location updates every 20 seconds; server presence expires after 90 seconds.
- Automatic listen-only LiveKit join when at least one other eligible user is in the proximity component.
- Microphone stays off by default and is enabled by the large microphone button.
- A 30-second grace period avoids disconnecting on brief GPS changes.
- Existing groups, chat and call screens remain in the app.

## Important setup

The client requires a deployed HTTPS MotoConnect API. See `MotoConnect/Server/voice-api/README.md` for Render deployment, Telegram bot setup, server secrets, and the `MOTOCONNECT_API_URL` GitHub secret.

The user must opt in to location sharing before the app sends location. Other users receive only approximate coordinates rounded to four decimal places. The server stores the latest position only, not a location history.

## Remaining work before production

- Create the actual Telegram bot with @BotFather and configure its token on the server.
- Deploy the API with persistent storage and configure LiveKit server credentials.
- Set the API URL secret and build the production-configured APK.
- Verify login/logout, map presence, connected-component movement, and two-way audio on real Android devices.
- Add background location behavior only with a clear foreground notification and separate permission flow.
- Personal calls and persistent server-backed groups/chat remain separate follow-up features.
