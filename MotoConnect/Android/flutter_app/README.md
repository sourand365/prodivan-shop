# MotoConnect Flutter app (Android-first)

This folder contains the first Flutter application source scaffold.

## Generate Android platform files
Install Flutter SDK and Android Studio, then from this folder run:

```bash
flutter create --platforms=android --project-name moto_connect .
flutter pub get
flutter analyze
flutter run
```

The initial screen is an illustrative Odesa map placeholder, not a live map. Microphone control is UI-only at this stage; no audio is transmitted yet. Calls, groups and profile are first-pass UI shells.

## Build a test APK
After Flutter and Android SDK are installed and the app passes tests:

```bash
flutter build apk --debug
```

APK output: `build/app/outputs/flutter-apk/app-debug.apk`.

## Current scope
- Moto Sport visual style (black/yellow).
- Manual dark/light theme switch.
- Main screen with map placeholder, Channel, Chat and microphone controls.
- Bottom navigation: Map, Calls, Groups, Profile.

## Not implemented yet
- Backend, accounts and admin approval.
- Live map/GPS and courier location sharing.
- WebRTC voice, proximity graph, personal calls.
- Real chat, push notifications and Bluetooth headset integration.
- Persistent theme preference.

Do not distribute this prototype as a production app. Permissions, privacy controls, security, background behavior and device testing are still required.


Google Maps SDK is configured for the Moto Sport map. The build reads the API key from the GitHub Actions secret `MAPS_API_KEY`.
