import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:geolocator/geolocator.dart';

const Color _motoYellow = Color(0xFFFFD400);

/// Google Maps base layer for MotoConnect. Uses Maps SDK only.
class GoogleMotoMap extends StatefulWidget {
  const GoogleMotoMap({super.key});
  @override
  State<GoogleMotoMap> createState() => _GoogleMotoMapState();
}

class _GoogleMotoMapState extends State<GoogleMotoMap> {
  GoogleMapController? _controller;
  bool _locationGranted = false;
  bool _mapReady = false;
  static const CameraPosition _odessa = CameraPosition(
    target: LatLng(46.4825, 30.7233), zoom: 13.2,
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
  void initState() { super.initState(); _requestLocationPermission(); }

  Future<void> _requestLocationPermission() async {
    final status = await Permission.locationWhenInUse.request();
    if (!mounted) return;
    setState(() => _locationGranted = status.isGranted);
  }

  void _onMapCreated(GoogleMapController controller) {
    _controller = controller;
    if (mounted) setState(() => _mapReady = true);
  }

  Future<void> _recenter() async {
    if (!_locationGranted) {
      final status = await Permission.locationWhenInUse.request();
      if (!mounted) return;
      setState(() => _locationGranted = status.isGranted);
      if (!status.isGranted && status.isPermanentlyDenied) await openAppSettings();
      return;
    }
    final serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) {
      await Geolocator.openLocationSettings();
      return;
    }
    try {
      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.medium),
      );
      await _controller?.animateCamera(CameraUpdate.newLatLngZoom(
        LatLng(position.latitude, position.longitude), 16,
      ));
    } catch (_) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Не удалось определить местоположение. Проверь GPS.')),
      );
    }
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
      ),
      if (!_mapReady) const IgnorePointer(child: Center(
        child: CircularProgressIndicator(color: _motoYellow),
      )),
      Positioned(right: 14, top: 64, child: Material(
        color: const Color(0xE6101010),
        borderRadius: BorderRadius.circular(12),
        child: IconButton(
          tooltip: 'Моё местоположение', onPressed: _recenter,
          icon: const Icon(Icons.my_location, color: _motoYellow),
        ),
      )),
    ],
  );

  @override
  void dispose() { _controller?.dispose(); super.dispose(); }
}
