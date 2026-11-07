// ignore_for_file: experimental_member_use

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:livekit_client/livekit_client.dart';
import 'package:permission_handler/permission_handler.dart';

class VoiceParticipantInfo {
  const VoiceParticipantInfo({
    required this.identity,
    required this.displayName,
    required this.isLocal,
    required this.isSpeaking,
    required this.isMuted,
  });

  final String identity;
  final String displayName;
  final bool isLocal;
  final bool isSpeaking;
  final bool isMuted;
}

/// LiveKit adapter. The API secret stays on the MotoConnect backend.
class LiveKitVoiceService extends ChangeNotifier {
  Room? _room;
  EventsListener<RoomEvent>? _roomEvents;

  bool get hasRoom => _room != null;

  List<VoiceParticipantInfo> get participants {
    final room = _room;
    if (room == null) return const [];

    final result = <VoiceParticipantInfo>[];
    final local = room.localParticipant;
    if (local != null) {
      result.add(VoiceParticipantInfo(
        identity: local.identity,
        displayName: local.name.isNotEmpty ? local.name : local.identity,
        isLocal: true,
        isSpeaking: local.isSpeaking,
        isMuted: local.isMuted,
      ));
    }

    for (final participant in room.remoteParticipants.values) {
      result.add(VoiceParticipantInfo(
        identity: participant.identity,
        displayName: participant.name.isNotEmpty
            ? participant.name
            : participant.identity,
        isLocal: false,
        isSpeaking: participant.isSpeaking,
        isMuted: participant.isMuted,
      ));
    }
    return List.unmodifiable(result);
  }

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

    final client = HttpClient()
      ..connectionTimeout = const Duration(seconds: 10);
    try {
      final request = await client.postUrl(tokenEndpoint);
      request.headers
        ..set(HttpHeaders.authorizationHeader, 'Bearer $appAccessToken')
        ..contentType = ContentType.json;
      request.write(jsonEncode({'roomName': roomName}));

      final response = await request.close();
      final responseText = await response.transform(utf8.decoder).join();
      if (response.statusCode != HttpStatus.ok) {
        throw StateError(
          'MotoConnect voice authorization failed (${response.statusCode}).',
        );
      }

      final payload = jsonDecode(responseText) as Map<String, dynamic>;
      final serverUrl = payload['serverUrl'] as String?;
      final participantToken = payload['participantToken'] as String?;
      if (serverUrl == null || participantToken == null) {
        throw const FormatException(
          'Voice API response is missing connection details.',
        );
      }

      await connect(
        serverUrl: serverUrl,
        participantToken: participantToken,
      );
    } finally {
      client.close(force: true);
    }
  }

  Future<void> connect({
    required String serverUrl,
    required String participantToken,
  }) async {
    if (serverUrl.isEmpty || participantToken.isEmpty) {
      throw ArgumentError(
        'LiveKit server URL and participant token are required.',
      );
    }

    await requestVoicePermissions();
    await disconnect();

    // Keep audio focus under LiveKit's own manager so WebRTC routing and
    // focus ownership cannot conflict with a second audio-session plugin.
    await AudioManager.instance.setAudioSessionOptions(
      const AudioSessionOptions.communication(
        android: AndroidAudioSessionConfiguration(
          audioMode: AndroidAudioMode.inCommunication,
          manageAudioFocus: true,
          focusMode: AndroidAudioFocusMode.gainTransientMayDuck,
          streamType: AndroidAudioStreamType.voiceCall,
          usageType: AndroidAudioAttributesUsageType.voiceCommunication,
          contentType: AndroidAudioAttributesContentType.speech,
        ),
      ),
    );

    final room = Room(
      roomOptions: const RoomOptions(
        adaptiveStream: true,
        dynacast: true,
      ),
    );
    try {
      await room.connect(serverUrl, participantToken);
      await room.localParticipant?.setMicrophoneEnabled(true);

      // LiveKit now owns transient may-duck focus for the call lifecycle.
      room.addListener(_onRoomChanged);
      _room = room;
      _roomEvents = room.createListener()
        ..on<RoomDisconnectedEvent>((_) => _handleRoomDisconnected(room));
      notifyListeners();
    } catch (_) {
      await room.disconnect();
      await room.dispose();
      await AudioManager.instance.deactivateAudioSession();
      rethrow;
    }
  }

  void _onRoomChanged() {
    notifyListeners();
  }

  void _handleRoomDisconnected(Room room) {
    if (!identical(_room, room)) return;
    _room = null;
    room.removeListener(_onRoomChanged);
    _roomEvents?.dispose();
    _roomEvents = null;
    unawaited(AudioManager.instance.deactivateAudioSession());
    notifyListeners();
  }

  Future<void> setMicrophoneEnabled(bool enabled) async {
    final room = _room;
    if (room == null) {
      throw StateError('Not connected to a voice room.');
    }
    await room.localParticipant?.setMicrophoneEnabled(enabled);
    notifyListeners();
  }

  Future<void> disconnect() async {
    final room = _room;
    _room = null;
    if (room != null) {
      room.removeListener(_onRoomChanged);
      _roomEvents?.dispose();
      _roomEvents = null;
      await room.disconnect();
      await room.dispose();
      await AudioManager.instance.deactivateAudioSession();
    }
    notifyListeners();
  }
}
