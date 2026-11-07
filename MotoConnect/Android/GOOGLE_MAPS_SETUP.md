# Google Maps setup for MotoConnect

The Android app uses the Google Maps SDK for Android through `google_maps_flutter`.

## Required GitHub Actions secret

Add repository Actions secret:

- Name: `MAPS_API_KEY`
- Value: the Google Maps API key created in Google Cloud Console.

The Android build workflow injects this value into the manifest at build time. Do not commit the key to the repository.

## Google Cloud configuration

1. Enable **Maps SDK for Android** in the selected Google Cloud project.
2. Restrict the API key to the Android application and Maps SDK for Android.
3. Keep Directions, Places, Geocoding and other paid APIs disabled unless separately approved.

## Current implementation scope

- Google Maps base map only; no route planning.
- Moto Sport dark map styling is applied locally in the app.
- Initial camera position is Odesa.
- Location permission is requested at runtime; the location button recenters to the device GPS position.
- Live courier markers and server-synchronized positions are not implemented by this map-only change.
- Google Cloud billing account may be required by Google even when only the mobile Maps SDK is used.
