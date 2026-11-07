import 'package:livekit_client/livekit_client.dart';

/// Thin LiveKit adapter for MotoConnect.
///
/// The LiveKit API secret must never be stored in this app. The backend must
/// authenticate the user and issue a short-lived room token before connect().
class LiveKitVoiceService {
  Room? _room;

  bool get hasRoom => _room != null;

  Future<void> connect({
    required String serverUrl,
    required String participantToken,
  }) async {
    if (serverUrl.isEmpty || participantToken.isEmpty) {
      throw ArgumentError('LiveKit server URL and participant token are required.');
    }

    await disconnect();

    final room = Room();
    try {
      await room.connect(
        serverUrl,
        participantToken,
        roomOptions: const RoomOptions(
          adaptiveStream: true,
          dynacast: true,
        ),
      );
      _room = room;
      await room.localParticipant?.setMicrophoneEnabled(true);
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
