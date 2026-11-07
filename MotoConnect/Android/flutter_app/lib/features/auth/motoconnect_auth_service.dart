import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:url_launcher/url_launcher.dart';

const String motoConnectApiBaseUrl =
    String.fromEnvironment('MOTOCONNECT_API_URL');

class MotoConnectUser {
  const MotoConnectUser({required this.id, required this.displayName});
  final String id;
  final String displayName;

  factory MotoConnectUser.fromJson(Map<String, dynamic> json) =>
      MotoConnectUser(
        id: json['id'] as String,
        displayName: json['displayName'] as String? ?? 'MotoConnect user',
      );
}

class MotoConnectAuthService {
  MotoConnectAuthService({FlutterSecureStorage? storage})
      : _storage = storage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _storage;
  String? _accessToken;
  String? _refreshToken;
  MotoConnectUser? currentUser;

  bool get isConfigured {
    final uri = Uri.tryParse(motoConnectApiBaseUrl);
    return uri != null && uri.scheme == 'https' && uri.host.isNotEmpty;
  }

  Uri _endpoint(String path) {
    if (!isConfigured) {
      throw StateError('Сервер MotoConnect ещё не настроен. Нужен HTTPS-адрес API.');
    }
    return Uri.parse(motoConnectApiBaseUrl).resolve(path);
  }

  Future<Map<String, dynamic>> _request(
    String method,
    String path, {
    Map<String, dynamic>? body,
    String? bearer,
  }) async {
    final client = HttpClient()
      ..connectionTimeout = const Duration(seconds: 12);
    try {
      final uri = _endpoint(path);
      final request = await (method == 'GET'
          ? client.getUrl(uri)
          : client.postUrl(uri));
      request.headers.set(HttpHeaders.acceptHeader, 'application/json');
      if (body != null) {
        request.headers.contentType = ContentType.json;
        request.write(jsonEncode(body));
      }
      if (bearer != null) {
        request.headers.set(HttpHeaders.authorizationHeader, 'Bearer $bearer');
      }
      final response = await request.close();
      final text = await response.transform(utf8.decoder).join();
      final decoded = text.isEmpty
          ? <String, dynamic>{}
          : jsonDecode(text) as Map<String, dynamic>;
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw HttpException(
          decoded['error'] as String? ??
              'Ошибка сервера (' + response.statusCode.toString() + ').',
          uri: uri,
        );
      }
      return decoded;
    } finally {
      client.close(force: true);
    }
  }

  Future<MotoConnectUser?> restoreSession() async {
    if (!isConfigured) return null;
    _accessToken = await _storage.read(key: 'mc_access_token');
    _refreshToken = await _storage.read(key: 'mc_refresh_token');
    if (_refreshToken == null) return null;
    try {
      final profile = await _request('GET', '/api/auth/me', bearer: _accessToken);
      currentUser = MotoConnectUser.fromJson(profile['user'] as Map<String, dynamic>);
      return currentUser;
    } on HttpException {
      try {
        await _refreshSession();
        final profile = await _request('GET', '/api/auth/me', bearer: _accessToken);
        currentUser = MotoConnectUser.fromJson(profile['user'] as Map<String, dynamic>);
        return currentUser;
      } catch (_) {
        await _clearLocalSession();
        return null;
      }
    } catch (_) {
      return null;
    }
  }

  Future<void> signInWithTelegram() async {
    final challenge = await _request('POST', '/api/auth/challenge');
    final challengeId = challenge['challengeId'] as String;
    final botUrl = Uri.parse(challenge['botUrl'] as String);
    final launched = await launchUrl(botUrl, mode: LaunchMode.externalApplication);
    if (!launched) {
      throw StateError('Не удалось открыть Telegram. Установи Telegram и повтори.');
    }
    final deadline = DateTime.now().add(const Duration(minutes: 5));
    while (DateTime.now().isBefore(deadline)) {
      await Future<void>.delayed(const Duration(seconds: 2));
      final result = await _request(
        'POST',
        '/api/auth/challenge/poll',
        body: {'challengeId': challengeId},
      );
      if (result['status'] == 'authenticated') {
        _accessToken = result['accessToken'] as String;
        _refreshToken = result['refreshToken'] as String;
        currentUser = MotoConnectUser.fromJson(result['user'] as Map<String, dynamic>);
        await _storage.write(key: 'mc_access_token', value: _accessToken);
        await _storage.write(key: 'mc_refresh_token', value: _refreshToken);
        return;
      }
    }
    throw TimeoutException('Время входа истекло. Нажми «Войти через Telegram» ещё раз.');
  }

  Future<void> _refreshSession() async {
    final refresh = _refreshToken;
    if (refresh == null) throw StateError('No refresh session.');
    final result = await _request(
      'POST', '/api/auth/refresh', body: {'refreshToken': refresh},
    );
    _accessToken = result['accessToken'] as String;
    _refreshToken = result['refreshToken'] as String;
    await _storage.write(key: 'mc_access_token', value: _accessToken);
    await _storage.write(key: 'mc_refresh_token', value: _refreshToken);
  }

  Future<Map<String, String>> requestVoiceToken(String roomName) async {
    if (_accessToken == null) throw StateError('Сначала войди в аккаунт.');
    final result = await _request(
      'POST', '/api/voice/token',
      bearer: _accessToken,
      body: {'roomName': roomName},
    );
    return {
      'serverUrl': result['serverUrl'] as String,
      'participantToken': result['participantToken'] as String,
    };
  }

  Future<void> logout() async {
    try {
      if (_accessToken != null) {
        await _request('POST', '/api/auth/logout', bearer: _accessToken);
      }
    } finally {
      await _clearLocalSession();
    }
  }

  Future<void> _clearLocalSession() async {
    _accessToken = null;
    _refreshToken = null;
    currentUser = null;
    await _storage.delete(key: 'mc_access_token');
    await _storage.delete(key: 'mc_refresh_token');
  }
}
