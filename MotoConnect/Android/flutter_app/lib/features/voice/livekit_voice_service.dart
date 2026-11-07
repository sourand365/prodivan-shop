import 'dart:convert';
import 'dart:io';

import 'package:livekit_client/livekit_client.dart';
import 'package:permission_handler/permission_handler.dart';

/// Thin LiveKit adapter for MotoConnect.
///
/// The LiveKit API secret must never be stored in this app. The backend must
/// authenticate the user and issue a short-lived room token before connect().
class LiveKitVoiceService {
  Room? _room;

  bool get hasRoom => _room != null;

  /// Requests only the permissions needed for voice and Android headset routing.
  Future<void> requestVoicePermissions() async {
    final microphone = await Permission.microphone.request();
    if (!microphone.isGranted) {
      throw StateError('Microphone permission is required for voice calls.');
    }

    if (Platform.isAndroid) {
      final bluetooth = await Permission.bluetoothConnect.request();
      if (!bluetooth.isGranted && !bluetooth.isLimited) {
        throw StateError('Bluetooth permission is required for headset routing.');
      }
    }
  }

  /// Authenticates with MotoConnect and obtains a room-scoped, short-lived token.
  Future<void> connectFromBackend({
    required Uri tokenEndpoint,
    required String appAccessToken,
    required String roomName,
  }) async {
    if (tokenEndpoint.scheme != 'https') {
      throw ArgumentError('The voice token endpoint must use HTTPS.');
    }
    if (appAccessToken.isEmpty || roomName.isEmpty) {
      throw ArgumentError('An app access token and room name are required.');
    }

    final client = HttpClient()..connectionTimeout = const Duration(seconds: 10);
    try {
      final request = await client.postUrl(tokenEndpoint);
      request.headers
        ..set(HttpHeaders.authorizationHeader, 'Bearer $appAccessToken')
        ..contentType = ContentType.json;
      request.write(jsonEncode({'roomName': roomName}));

      final response = await request.close();
      final responseText = await response.transform(utf8.decoder).join();
      if (response.statusCode != HttpStatus.ok) {
        throw StateError('MotoConnect voice authorization failed (${response.statusCode}).');
      }

      final payload = jsonDecode(responseText) as Map<String, dynamic>;
      final serverUrl = payload['serverUrl'] as String?;
      final participantToken = payload['participantToken'] as String?;
      if (serverUrl == null || participantToken == null) {
        throw const FormatException('Voice API response is missing connection details.');
      }

      await connect(serverUrl: serverUrl, participantToken: participantToken);
    } finally {
      client.close(force: true);
    }
  }

  Future<void> connect({
    required String serverUrl,
    required String participantToken,
  }) async {
    if (serverUrl.isEmpty || participantToken.isEmpty) {
      throw ArgumentError('LiveKit server URL and participant token are required.');
    }

    await requestVoicePermissions();
    await disconnect();

    final room = Room(
      roomOptions: const RoomOptions(
        adaptiveStream: true,
        dynacast: true,
      ),
    );
    try {
      await room.connect(serverUrl, participantToken);
      await room.localParticipant?.setMicrophoneEnabled(true);
      _room = room;
    } catch (_) {
      await room.disconnect();
      rethrow;
    }
  }

  Future<void> setMicrophoneEnabled(bool enabled) async {
    final room = _room;
    if (room == null) {
      throw StateError('Not connected to a voice room.');
    }
    await room.localParticipant?.setMicrophoneEnabled(enabled);
  }

  Future<void> disconnect() async {
    final room = _room;
    _room = null;
    if (room != null) {
      await room.disconnect();
    }
  }
}
