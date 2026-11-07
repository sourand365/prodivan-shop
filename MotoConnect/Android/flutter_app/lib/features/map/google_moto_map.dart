import 'dart:async';

import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:geolocator/geolocator.dart';

import '../auth/motoconnect_auth_service.dart';

const Color _motoYellow = Color(0xFFFFD400);

/// Google Maps layer with opt-in proximity presence and a 1 km range circle.
class GoogleMotoMap extends StatefulWidget {
  const GoogleMotoMap({
    required this.authService,
    required this.onVoiceRoomChanged,
    super.key,
  });

  final MotoConnectAuthService authService;
  final void Function(String? roomName, {bool immediate}) onVoiceRoomChanged;

  @override
  State<GoogleMotoMap> createState() => _GoogleMotoMapState();
}

class _GoogleMotoMapState extends State<GoogleMotoMap>
    with WidgetsBindingObserver {
  GoogleMapController? _controller;
  bool _locationGranted = false;
  bool _mapReady = false;
  bool _proximityEnabled = false;
  bool _updatingPresence = false;
  Position? _myPosition;
  List<Map<String, dynamic>> _participants = const [];
  String? _presenceError;
  Timer? _presenceTimer;

  static const CameraPosition _odessa = CameraPosition(
    target: LatLng(46.4825, 30.7233),
    zoom: 13.2,
  );

  static const String _motoSportStyle = '''
[
 {"elementType":"geometry","stylers":[{"color":"#171A1D"}]},
 {"elementType":"labels.text.fill","stylers":[{"color":"#AEB5BA"}]},
 {"elementType":"labels.text.stroke","stylers":[{"color":"#171A1D"}]},
 {"featureType":"administrative","elementType":"geometry.stroke","stylers":[{"color":"#343A40"}]},
 {"featureType":"landscape","elementType":"geometry","stylers":[{"color":"#1B2024"}]},
 {"featureType":"poi","elementType":"geometry","stylers":[{"color":"#20272A"}]},
 {"featureType":"poi","elementType":"labels.text.fill","stylers":[{"color":"#7D898F"}]},
 {"featureType":"road","elementType":"geometry","stylers":[{"color":"#343B40"}]},
 {"featureType":"road","elementType":"geometry.stroke","stylers":[{"color":"#242A2E"}]},
 {"featureType":"road.highway","elementType":"geometry","stylers":[{"color":"#806B16"}]},
 {"featureType":"road.highway","elementType":"geometry.stroke","stylers":[{"color":"#4B4014"}]},
 {"featureType":"road.arterial","elementType":"geometry","stylers":[{"color":"#454B4E"}]},
 {"featureType":"transit","elementType":"geometry","stylers":[{"color":"#30373B"}]},
 {"featureType":"water","elementType":"geometry","stylers":[{"color":"#101D27"}]},
 {"featureType":"water","elementType":"labels.text.fill","stylers":[{"color":"#718A98"}]}
]
''';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _requestLocationPermission();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && _proximityEnabled) {
      _sendPresenceUpdate();
    }
  }

  Future<void> _requestLocationPermission() async {
    final status = await Permission.locationWhenInUse.request();
    if (!mounted) return;
    setState(() => _locationGranted = status.isGranted);
  }

  void _onMapCreated(GoogleMapController controller) {
    _controller = controller;
    if (mounted) setState(() => _mapReady = true);
  }

  Future<Position> _currentPosition() async {
    final enabled = await Geolocator.isLocationServiceEnabled();
    if (!enabled) {
      await Geolocator.openLocationSettings();
      throw StateError('Включи GPS, чтобы видеть курьеров поблизости.');
    }
    return Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.medium,
        timeLimit: Duration(seconds: 12),
      ),
    );
  }

  Future<void> _toggleProximity(bool enabled) async {
    if (_updatingPresence) return;
    if (!enabled) {
      _presenceTimer?.cancel();
      _presenceTimer = null;
      try {
        await widget.authService.updatePresence(enabled: false);
      } catch (_) {
        // The server also expires presence automatically after 90 seconds.
      }
      widget.onVoiceRoomChanged(null, immediate: true);
      if (mounted) {
        setState(() {
          _proximityEnabled = false;
          _participants = const [];
          _presenceError = null;
        });
      }
      return;
    }

    setState(() {
      _updatingPresence = true;
      _presenceError = null;
    });
    try {
      final permission = await Permission.locationWhenInUse.request();
      if (!permission.isGranted) {
        throw StateError('Разреши доступ к геолокации, чтобы включить круг 1 км.');
      }
      final position = await _currentPosition();
      final response = await widget.authService.updatePresence(
        enabled: true,
        latitude: position.latitude,
        longitude: position.longitude,
      );
      if (!mounted) return;
      setState(() {
        _locationGranted = true;
        _myPosition = position;
        _proximityEnabled = true;
        _participants = _readParticipants(response);
      });
      widget.onVoiceRoomChanged(response['roomName'] as String?);
      _presenceTimer?.cancel();
      _presenceTimer = Timer.periodic(
        const Duration(seconds: 20),
        (_) => _sendPresenceUpdate(),
      );
    } catch (error) {
      if (mounted) setState(() => _presenceError = error.toString());
    } finally {
      if (mounted) setState(() => _updatingPresence = false);
    }
  }

  List<Map<String, dynamic>> _readParticipants(Map<String, dynamic> response) {
    final raw = response['participants'];
    if (raw is! List) return const [];
    return raw.whereType<Map>().map((item) =>
      Map<String, dynamic>.from(item),
    ).toList(growable: false);
  }

  Future<void> _sendPresenceUpdate() async {
    if (!_proximityEnabled || _updatingPresence) return;
    _updatingPresence = true;
    try {
      final position = await _currentPosition();
      final response = await widget.authService.updatePresence(
        enabled: true,
        latitude: position.latitude,
        longitude: position.longitude,
      );
      if (!mounted) return;
      setState(() {
        _myPosition = position;
        _participants = _readParticipants(response);
        _presenceError = null;
      });
      widget.onVoiceRoomChanged(response['roomName'] as String?);
    } catch (error) {
      widget.onVoiceRoomChanged(null);
      if (mounted) setState(() => _presenceError = error.toString());
    } finally {
      _updatingPresence = false;
    }
  }

  Future<void> _recenter() async {
    if (!_locationGranted) {
      final status = await Permission.locationWhenInUse.request();
      if (!mounted) return;
      setState(() => _locationGranted = status.isGranted);
      if (!status.isGranted && status.isPermanentlyDenied) {
        await openAppSettings();
      }
      return;
    }
    try {
      final position = await _currentPosition();
      if (!mounted) return;
      setState(() => _myPosition = position);
      await _controller?.animateCamera(CameraUpdate.newLatLngZoom(
        LatLng(position.latitude, position.longitude),
        16,
      ));
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(error.toString())),
        );
      }
    }
  }

  Set<Circle> get _rangeCircles {
    final position = _myPosition;
    if (!_proximityEnabled || position == null) return const {};
    return {
      Circle(
        circleId: const CircleId('hearing-range-1km'),
        center: LatLng(position.latitude, position.longitude),
        radius: 1000,
        strokeColor: _motoYellow,
        strokeWidth: 2,
        fillColor: _motoYellow.withValues(alpha: 0.09),
      ),
    };
  }

  Set<Marker> get _nearbyMarkers {
    final ownId = widget.authService.currentUser?.id;
    return _participants.where((item) => item['id'] != ownId).map((item) {
      final latitude = (item['latitude'] as num?)?.toDouble();
      final longitude = (item['longitude'] as num?)?.toDouble();
      if (latitude == null || longitude == null) return null;
      final name = item['name'] as String? ?? 'MotoConnect';
      final distance = (item['distanceMetres'] as num?)?.round();
      return Marker(
        markerId: MarkerId(item['id'] as String? ?? '$latitude,$longitude'),
        position: LatLng(latitude, longitude),
        icon: BitmapDescriptor.defaultMarkerWithHue(
          BitmapDescriptor.hueYellow,
        ),
        infoWindow: InfoWindow(
          title: name,
          snippet: distance == null ? 'В твоей голосовой группе' : '$distance м от тебя',
        ),
      );
    }).whereType<Marker>().toSet();
  }

  @override
  Widget build(BuildContext context) => Stack(
    fit: StackFit.expand,
    children: [
      GoogleMap(
        initialCameraPosition: _odessa,
        style: _motoSportStyle,
        onMapCreated: _onMapCreated,
        myLocationEnabled: _locationGranted,
        myLocationButtonEnabled: false,
        compassEnabled: false,
        zoomControlsEnabled: false,
        mapToolbarEnabled: false,
        buildingsEnabled: true,
        trafficEnabled: false,
        indoorViewEnabled: false,
        mapType: MapType.normal,
        minMaxZoomPreference: const MinMaxZoomPreference(10, 20),
        circles: _rangeCircles,
        markers: _nearbyMarkers,
      ),
      if (!_mapReady)
        const IgnorePointer(
          child: Center(
            child: CircularProgressIndicator(color: _motoYellow),
          ),
        ),
      Positioned(
        right: 14,
        top: 64,
        child: Material(
          color: const Color(0xE6101010),
          borderRadius: BorderRadius.circular(12),
          child: IconButton(
            tooltip: 'Моё местоположение',
            onPressed: _recenter,
            icon: const Icon(Icons.my_location, color: _motoYellow),
          ),
        ),
      ),
      Positioned(
        left: 12,
        right: 64,
        top: 64,
        child: Material(
          color: const Color(0xE6101010),
          borderRadius: BorderRadius.circular(14),
          child: SwitchListTile(
            dense: true,
            activeColor: _motoYellow,
            title: const Text(
              'Слышать рядом · 1 км',
              style: TextStyle(
                color: Colors.white,
                fontSize: 13,
                fontWeight: FontWeight.w800,
              ),
            ),
            subtitle: Text(
              _presenceError ??
                  (_proximityEnabled
                      ? 'В группе: ${_participants.length}'
                      : 'Показывать моё примерное местоположение'),
              style: const TextStyle(color: Colors.white70, fontSize: 10),
              maxLines: 2,
            ),
            value: _proximityEnabled,
            onChanged: _updatingPresence ? null : _toggleProximity,
          ),
        ),
      ),
    ],
  );

  @override
  void dispose() {
    _presenceTimer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    _controller?.dispose();
    super.dispose();
  }
}
