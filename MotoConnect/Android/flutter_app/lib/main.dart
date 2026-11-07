import 'package:flutter/material.dart';
import 'features/map/google_moto_map.dart';

void main() {
  runApp(const MotoConnectApp());
}

const Color motoYellow = Color(0xFFFFD400);

class MotoConnectApp extends StatefulWidget {
  const MotoConnectApp({super.key});

  @override
  State<MotoConnectApp> createState() => _MotoConnectAppState();
}

class _MotoConnectAppState extends State<MotoConnectApp> {
  ThemeMode _themeMode = ThemeMode.dark;

  void _toggleTheme(bool isDark) {
    setState(() => _themeMode = isDark ? ThemeMode.dark : ThemeMode.light);
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'MotoConnect',
      debugShowCheckedModeBanner: false,
      themeMode: _themeMode,
      theme: ThemeData(
        brightness: Brightness.light,
        colorScheme: ColorScheme.fromSeed(
          seedColor: motoYellow,
          brightness: Brightness.light,
        ),
        scaffoldBackgroundColor: const Color(0xFFF4F4F1),
        appBarTheme: const AppBarTheme(
          backgroundColor: Color(0xFFF4F4F1),
          foregroundColor: Color(0xFF151515),
        ),
        navigationBarTheme: const NavigationBarThemeData(
          backgroundColor: Colors.white,
          indicatorColor: Color(0xFFFFE76A),
        ),
        useMaterial3: true,
      ),
      darkTheme: ThemeData(
        brightness: Brightness.dark,
        colorScheme: ColorScheme.fromSeed(
          seedColor: motoYellow,
          brightness: Brightness.dark,
          surface: const Color(0xFF171717),
        ),
        scaffoldBackgroundColor: const Color(0xFF090909),
        appBarTheme: const AppBarTheme(
          backgroundColor: Color(0xFF090909),
          foregroundColor: Colors.white,
        ),
        navigationBarTheme: const NavigationBarThemeData(
          backgroundColor: Color(0xFF111111),
          indicatorColor: Color(0xFF554900),
        ),
        useMaterial3: true,
      ),
      home: MotoShell(
        isDark: _themeMode == ThemeMode.dark,
        onThemeChanged: _toggleTheme,
      ),
    );
  }
}

class MotoShell extends StatefulWidget {
  const MotoShell({
    required this.isDark,
    required this.onThemeChanged,
    super.key,
  });

  final bool isDark;
  final ValueChanged<bool> onThemeChanged;

  @override
  State<MotoShell> createState() => _MotoShellState();
}

class _MotoShellState extends State<MotoShell> {
  int _index = 0;
  bool _micEnabled = true;

  @override
  Widget build(BuildContext context) {
    final pages = <Widget>[
      HomeMapScreen(
        micEnabled: _micEnabled,
        onMicPressed: () => setState(() => _micEnabled = !_micEnabled),
        onChannelPressed: () => setState(() => _index = 1),
        onChatPressed: () => setState(() => _index = 2),
      ),
      const CallsScreen(),
      const GroupsScreen(),
      ProfileScreen(
        isDark: widget.isDark,
        onThemeChanged: widget.onThemeChanged,
      ),
    ];

    return Scaffold(
      body: SafeArea(child: IndexedStack(index: _index, children: pages)),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (value) => setState(() => _index = value),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.map_outlined), selectedIcon: Icon(Icons.map), label: 'Карта'),
          NavigationDestination(icon: Icon(Icons.call_outlined), selectedIcon: Icon(Icons.call), label: 'Звонки'),
          NavigationDestination(icon: Icon(Icons.groups_outlined), selectedIcon: Icon(Icons.groups), label: 'Группы'),
          NavigationDestination(icon: Icon(Icons.person_outline), selectedIcon: Icon(Icons.person), label: 'Профиль'),
        ],
      ),
    );
  }
}

class HomeMapScreen extends StatelessWidget {
  const HomeMapScreen({
    required this.micEnabled,
    required this.onMicPressed,
    required this.onChannelPressed,
    required this.onChatPressed,
    super.key,
  });

  final bool micEnabled;
  final VoidCallback onMicPressed;
  final VoidCallback onChannelPressed;
  final VoidCallback onChatPressed;

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Padding(
      padding: const EdgeInsets.fromLTRB(18, 12, 18, 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.two_wheeler, color: motoYellow, size: 30),
              const SizedBox(width: 9),
              const Text('MOTO', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w900, letterSpacing: 2)),
              Text('CONNECT', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w300, color: isDark ? Colors.white70 : Colors.black54, letterSpacing: 1)),
              const Spacer(),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
                decoration: BoxDecoration(color: motoYellow.withValues(alpha: 0.14), borderRadius: BorderRadius.circular(20)),
                child: const Row(children: [
                  Icon(Icons.circle, color: Color(0xFF62D18A), size: 9),
                  SizedBox(width: 6),
                  Text('На линии', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
                ]),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Expanded(
            child: ClipRRect(
              borderRadius: BorderRadius.circular(24),
              child: Stack(
                fit: StackFit.expand,
                children: [
                  const GoogleMotoMap(),
                  Positioned(left: 14, top: 14, child: _mapLabel(context, 'ОДЕССА', Icons.location_on)),
                ],
              ),
            ),
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(child: _sideButton(context, icon: Icons.headset_mic, label: 'КАНАЛ', onTap: onChannelPressed)),
              const SizedBox(width: 18),
              GestureDetector(
                onTap: onMicPressed,
                child: Container(
                  width: 82,
                  height: 82,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: micEnabled ? motoYellow : const Color(0xFF555555),
                    boxShadow: [BoxShadow(color: motoYellow.withValues(alpha: micEnabled ? 0.28 : 0.05), blurRadius: 22, spreadRadius: 2)],
                    border: Border.all(color: isDark ? Colors.white24 : Colors.black12, width: 3),
                  ),
                  child: Icon(micEnabled ? Icons.mic : Icons.mic_off, color: Colors.black, size: 36),
                ),
              ),
              const SizedBox(width: 18),
              Expanded(child: _sideButton(context, icon: Icons.chat_bubble_outline, label: 'ЧАТ', onTap: onChatPressed)),
            ],
          ),
          const SizedBox(height: 7),
          Center(child: Text(micEnabled ? 'МИКРОФОН ВКЛЮЧЁН' : 'МИКРОФОН ВЫКЛЮЧЕН', style: TextStyle(fontSize: 10, letterSpacing: 1.3, fontWeight: FontWeight.w800, color: micEnabled ? motoYellow : Colors.grey))),
        ],
      ),
    );
  }

  Widget _mapLabel(BuildContext context, String text, IconData icon) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
    decoration: BoxDecoration(color: const Color(0xE6101010), borderRadius: BorderRadius.circular(12)),
    child: Row(children: [Icon(icon, color: motoYellow, size: 16), const SizedBox(width: 6), Text(text, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w900, letterSpacing: 1.2))]),
  );

  Widget _mapAction(BuildContext context, IconData icon) => Container(
    decoration: BoxDecoration(color: const Color(0xE6101010), borderRadius: BorderRadius.circular(12)),
    child: IconButton(onPressed: () {}, icon: Icon(icon, color: motoYellow)),
  );

  Widget _mapPin(bool isDark, String initials) => Container(
    width: 38, height: 38,
    decoration: BoxDecoration(color: motoYellow, shape: BoxShape.circle, border: Border.all(color: Colors.black, width: 2), boxShadow: const [BoxShadow(color: Colors.black38, blurRadius: 8)]),
    alignment: Alignment.center,
    child: Text(initials, style: const TextStyle(color: Colors.black, fontWeight: FontWeight.w900, fontSize: 11)),
  );

  Widget _sideButton(BuildContext context, {required IconData icon, required String label, required VoidCallback onTap}) => OutlinedButton(
    onPressed: onTap,
    style: OutlinedButton.styleFrom(
      foregroundColor: Theme.of(context).colorScheme.onSurface,
      side: const BorderSide(color: motoYellow, width: 1.4),
      padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 8),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
    ),
    child: Column(children: [Icon(icon, color: motoYellow), const SizedBox(height: 5), Text(label, style: const TextStyle(fontWeight: FontWeight.w900, letterSpacing: 1))]),
  );
}

class CallsScreen extends StatelessWidget {
  const CallsScreen({super.key});

  @override
  Widget build(BuildContext context) => const _SectionPage(
    title: 'Звонки',
    subtitle: 'Личные вызовы и голосовые каналы',
    icon: Icons.headset_mic,
    children: [
      _FeatureTile(icon: Icons.wifi_tethering, title: 'Общий канал рядом', detail: 'Связь с доступными курьерами в пределах цепочки 1 км'),
      _FeatureTile(icon: Icons.call, title: 'Личные звонки', detail: 'Звонок конкретному участнику'),
      _FeatureTile(icon: Icons.people_alt_outlined, title: 'Участники канала', detail: 'Список подключённых появится после подключения сервера'),
    ],
  );
}

class GroupsScreen extends StatelessWidget {
  const GroupsScreen({super.key});

  @override
  Widget build(BuildContext context) => const _SectionPage(
    title: 'Группы',
    subtitle: 'Твои команды и приглашения',
    icon: Icons.groups,
    children: [
      _FeatureTile(icon: Icons.group_add, title: 'Создать группу', detail: 'Создание будет доступно после входа в аккаунт'),
      _FeatureTile(icon: Icons.forum_outlined, title: 'Чат группы', detail: 'Общение, фото, видео и голосовые сообщения'),
      _FeatureTile(icon: Icons.timer_outlined, title: 'Активность группы', detail: 'Предупреждение владельцу за 24 часа до удаления'),
    ],
  );
}

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({required this.isDark, required this.onThemeChanged, super.key});

  final bool isDark;
  final ValueChanged<bool> onThemeChanged;

  @override
  Widget build(BuildContext context) => _SectionPage(
    title: 'Профиль',
    subtitle: 'Настройки аккаунта MotoConnect',
    icon: Icons.person,
    children: [
      const _FeatureTile(icon: Icons.account_circle_outlined, title: 'Пользователь', detail: 'Профиль появится после регистрации и одобрения'),
      const _FeatureTile(icon: Icons.two_wheeler, title: 'Мой транспорт', detail: 'Марка и модель мотоцикла или скутера'),
      SwitchListTile(
        secondary: const Icon(Icons.dark_mode_outlined, color: motoYellow),
        title: const Text('Тёмная тема'),
        subtitle: const Text('Светлая и тёмная темы приложения'),
        value: isDark,
        onChanged: onThemeChanged,
      ),
      const _FeatureTile(icon: Icons.notifications_outlined, title: 'Уведомления', detail: 'Режимы: обычный, в поездке, не беспокоить'),
      const _FeatureTile(icon: Icons.privacy_tip_outlined, title: 'Приватность', detail: 'Номер телефона виден только тебе и главному администратору'),
    ],
  );
}

class _SectionPage extends StatelessWidget {
  const _SectionPage({required this.title, required this.subtitle, required this.icon, required this.children});

  final String title;
  final String subtitle;
  final IconData icon;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.fromLTRB(18, 18, 18, 28),
    children: [
      Row(children: [
        Icon(icon, color: motoYellow, size: 30),
        const SizedBox(width: 10),
        Text(title, style: const TextStyle(fontSize: 27, fontWeight: FontWeight.w900)),
      ]),
      const SizedBox(height: 5),
      Text(subtitle, style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant)),
      const SizedBox(height: 22),
      ...children,
    ],
  );
}

class _FeatureTile extends StatelessWidget {
  const _FeatureTile({required this.icon, required this.title, required this.detail});

  final IconData icon;
  final String title;
  final String detail;

  @override
  Widget build(BuildContext context) => Card(
    margin: const EdgeInsets.only(bottom: 12),
    child: ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      leading: Container(
        width: 44, height: 44,
        decoration: BoxDecoration(color: motoYellow.withValues(alpha: 0.14), borderRadius: BorderRadius.circular(13)),
        child: Icon(icon, color: motoYellow),
      ),
      title: Text(title, style: const TextStyle(fontWeight: FontWeight.w800)),
      subtitle: Padding(padding: const EdgeInsets.only(top: 4), child: Text(detail)),
      trailing: const Icon(Icons.chevron_right),
    ),
  );
}

class _MapPlaceholderPainter extends CustomPainter {
  _MapPlaceholderPainter({required this.isDark});
  final bool isDark;

  @override
  void paint(Canvas canvas, Size size) {
    final background = Paint()..color = isDark ? const Color(0xFF202521) : const Color(0xFFDDE5DC);
    canvas.drawRect(Offset.zero & size, background);

    final blockPaint = Paint()..color = isDark ? const Color(0xFF2B332D) : const Color(0xFFCFD9CE);
    for (var row = 0; row < 7; row++) {
      for (var col = 0; col < 5; col++) {
        final rect = Rect.fromLTWH(col * 92.0 - 20, row * 88.0 - 12, 68, 54);
        canvas.drawRRect(RRect.fromRectAndRadius(rect, const Radius.circular(7)), blockPaint);
      }
    }

    final roadPaint = Paint()
      ..color = isDark ? const Color(0xFF414A43) : const Color(0xFFF2F0E7)
      ..strokeWidth = 13
      ..style = PaintingStyle.stroke;
    final road = Path()
      ..moveTo(-20, size.height * 0.25)
      ..cubicTo(size.width * 0.25, size.height * 0.18, size.width * 0.55, size.height * 0.43, size.width + 20, size.height * 0.31)
      ..moveTo(size.width * 0.1, size.height + 10)
      ..cubicTo(size.width * 0.25, size.height * 0.7, size.width * 0.62, size.height * 0.58, size.width * 0.85, -10);
    canvas.drawPath(road, roadPaint);

    final yellowRoad = Paint()
      ..color = motoYellow.withValues(alpha: 0.7)
      ..strokeWidth = 3
      ..style = PaintingStyle.stroke;
    final route = Path()
      ..moveTo(size.width * 0.12, size.height * 0.72)
      ..cubicTo(size.width * 0.34, size.height * 0.58, size.width * 0.42, size.height * 0.48, size.width * 0.62, size.height * 0.52)
      ..cubicTo(size.width * 0.76, size.height * 0.55, size.width * 0.78, size.height * 0.34, size.width * 0.94, size.height * 0.28);
    canvas.drawPath(route, yellowRoad);
  }

  @override
  bool shouldRepaint(covariant _MapPlaceholderPainter oldDelegate) => oldDelegate.isDark != isDark;
}
