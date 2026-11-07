import 'package:flutter/material.dart';
import 'features/map/google_moto_map.dart';
import 'features/voice/livekit_voice_service.dart';

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
        onChatPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const ChatsScreen())),
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

  void _openVoiceRoom(BuildContext context, String roomName, String title) {
    Navigator.of(context).push(MaterialPageRoute<void>(
      builder: (_) => VoiceRoomScreen(roomName: roomName, title: title),
    ));
  }

  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.fromLTRB(18, 18, 18, 28),
    children: [
      const _PageHeading(title: 'Звонки', subtitle: 'Голосовые каналы MotoConnect', icon: Icons.headset_mic),
      Card(
        child: ListTile(
          leading: const Icon(Icons.wifi_tethering, color: motoYellow),
          title: const Text('Общий канал рядом'),
          subtitle: const Text('Голосовая комната для курьеров поблизости'),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => _openVoiceRoom(context, 'nearby-channel', 'Общий канал рядом'),
        ),
      ),
      Card(
        child: ListTile(
          leading: const Icon(Icons.call, color: motoYellow),
          title: const Text('Личный звонок'),
          subtitle: const Text('Подготовка личных вызовов'),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => _openVoiceRoom(context, 'direct-call', 'Личный звонок'),
        ),
      ),
      const _FeatureTile(
        icon: Icons.security,
        title: 'Защищённое подключение',
        detail: 'Голосовой сервер выдаёт короткоживущий токен только после проверки аккаунта и членства в комнате.',
      ),
    ],
  );
}

class VoiceRoomScreen extends StatefulWidget {
  const VoiceRoomScreen({required this.roomName, required this.title, super.key});

  final String roomName;
  final String title;

  @override
  State<VoiceRoomScreen> createState() => _VoiceRoomScreenState();
}

class _VoiceRoomScreenState extends State<VoiceRoomScreen> {
  final LiveKitVoiceService _voiceService = LiveKitVoiceService();

  @override
  void dispose() {
    _voiceService.disconnect();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.title)),
      body: ListView(
        padding: const EdgeInsets.all(18),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                children: [
                  const CircleAvatar(
                    radius: 38,
                    backgroundColor: Color(0xFF554900),
                    child: Icon(Icons.headset_mic, color: motoYellow, size: 38),
                  ),
                  const SizedBox(height: 14),
                  const Text('Голосовая комната', style: TextStyle(fontSize: 21, fontWeight: FontWeight.w900)),
                  const SizedBox(height: 6),
                  Text(widget.roomName, style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant)),
                  const SizedBox(height: 14),
                  const Chip(
                    avatar: Icon(Icons.lock_outline, size: 17),
                    label: Text('Ожидает авторизацию'),
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    'Подключение станет доступно после входа в аккаунт и получения персонального временного токена. Это защищает голосовые комнаты от посторонних.',
                    textAlign: TextAlign.center,
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
          Card(
            child: ListTile(
              leading: const Icon(Icons.people_outline),
              title: const Text('Участники'),
              subtitle: const Text('Пока никто не подключён'),
            ),
          ),
          Card(
            child: ListTile(
              leading: const Icon(Icons.mic_off_outlined),
              title: const Text('Микрофон'),
              subtitle: const Text('Будет доступен после подключения'),
              trailing: const Icon(Icons.lock_outline),
              enabled: false,
            ),
          ),
          const SizedBox(height: 12),
          FilledButton.icon(
            onPressed: null,
            icon: const Icon(Icons.login),
            label: const Text('Войти в голосовую комнату'),
          ),
          const SizedBox(height: 8),
          Text(
            'Комната подготовлена. Реальный звук и список участников появятся после подключения авторизации к LiveKit API.',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 12, color: Theme.of(context).colorScheme.onSurfaceVariant),
          ),
        ],
      ),
    );
  }
}

class _CreateGroupDialog extends StatefulWidget {
  const _CreateGroupDialog();

  @override
  State<_CreateGroupDialog> createState() => _CreateGroupDialogState();
}

class _CreateGroupDialogState extends State<_CreateGroupDialog> {
  final TextEditingController _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _submit() {
    Navigator.of(context).pop(_controller.text.trim());
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Новая группа'),
    content: TextField(
      controller: _controller,
      autofocus: true,
      maxLength: 32,
      textCapitalization: TextCapitalization.sentences,
      decoration: const InputDecoration(labelText: 'Название группы'),
      onSubmitted: (_) => _submit(),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.of(context).pop(),
        child: const Text('Отмена'),
      ),
      FilledButton(
        onPressed: _submit,
        child: const Text('Создать'),
      ),
    ],
  );
}

class GroupsScreen extends StatefulWidget {
  const GroupsScreen({super.key});

  @override
  State<GroupsScreen> createState() => _GroupsScreenState();
}

class _GroupsScreenState extends State<GroupsScreen> {
  final List<String> _groups = [];

  Future<void> _createGroup() async {
    // The dialog owns its controller so it stays alive until the route is
    // fully removed (showDialog may complete before the reverse animation ends).
    final name = await showDialog<String>(
      context: context,
      builder: (_) => const _CreateGroupDialog(),
    );
    if (name == null || name.isEmpty || !mounted) return;
    setState(() => _groups.add(name));
  }

  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.fromLTRB(18, 18, 18, 28),
    children: [
      const _PageHeading(title: 'Группы', subtitle: 'Твои команды и приглашения', icon: Icons.groups),
      Card(
        child: ListTile(
          leading: const Icon(Icons.group_add, color: motoYellow),
          title: const Text('Создать группу'),
          subtitle: const Text('Создай локальную заготовку группы'),
          trailing: const Icon(Icons.add),
          onTap: _createGroup,
        ),
      ),
      const SizedBox(height: 10),
      if (_groups.isEmpty)
        const _FeatureTile(icon: Icons.groups_outlined, title: 'Пока нет групп', detail: 'Созданные здесь группы пока хранятся только на этом устройстве. Синхронизация появится после подключения аккаунтов и сервера.')
      else
        ..._groups.map((name) => Card(
          child: ListTile(
            leading: const CircleAvatar(backgroundColor: Color(0xFF554900), child: Icon(Icons.groups, color: motoYellow)),
            title: Text(name),
            subtitle: const Text('Владелец: вы · локальный черновик'),
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => GroupDetailScreen(name: name),
              ),
            ),
            trailing: IconButton(
              tooltip: 'Удалить черновик',
              icon: const Icon(Icons.delete_outline),
              onPressed: () => setState(() => _groups.remove(name)),
            ),
          ),
        )),
      const SizedBox(height: 8),
      const _FeatureTile(icon: Icons.timer_outlined, title: 'Правила активности', detail: 'Неактивная группа удаляется через 7 полных суток. Владельцу отправляется предупреждение за 24 часа. Серверный таймер подключим вместе с авторизацией.'),
    ],
  );
}

class GroupDetailScreen extends StatelessWidget {
  const GroupDetailScreen({required this.name, super.key});

  final String name;

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: Text(name),
      leading: IconButton(
        tooltip: 'Назад к группам',
        icon: const Icon(Icons.arrow_back),
        onPressed: () => Navigator.of(context).pop(),
      ),
    ),
    body: ListView(
      padding: const EdgeInsets.all(18),
      children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const CircleAvatar(
                  radius: 30,
                  backgroundColor: Color(0xFF554900),
                  child: Icon(Icons.groups, color: motoYellow, size: 32),
                ),
                const SizedBox(height: 14),
                Text(name, style: const TextStyle(fontSize: 23, fontWeight: FontWeight.w900)),
                const SizedBox(height: 6),
                Text(
                  'Локальная группа · владелец: вы',
                  style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 10),
        const _FeatureTile(
          icon: Icons.people_outline,
          title: 'Участники',
          detail: 'Пока только вы. Приглашение участников станет доступно после подключения авторизации.',
        ),
        Card(
          child: ListTile(
            leading: const Icon(Icons.headset_mic_outlined, color: motoYellow),
            title: const Text('Голосовая связь'),
            subtitle: const Text('Открыть голосовую комнату группы'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(
              builder: (_) => VoiceRoomScreen(
                roomName: 'group-${widget.name.toLowerCase().replaceAll(RegExp(r'[^a-z0-9_-]+'), '-') }',
                title: 'Голосовая связь',
              ),
            )),
          ),
        ),
      ],
    ),
  );
}

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({required this.isDark, required this.onThemeChanged, super.key});

  final bool isDark;
  final ValueChanged<bool> onThemeChanged;

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  final _name = TextEditingController();
  final _vehicle = TextEditingController();
  String _status = 'На линии';
  String _notificationMode = 'Обычный';

  @override
  void dispose() {
    _name.dispose();
    _vehicle.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.fromLTRB(18, 18, 18, 28),
    children: [
      const _PageHeading(title: 'Профиль', subtitle: 'Настройки MotoConnect', icon: Icons.person),
      Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(children: [
            TextField(controller: _name, decoration: const InputDecoration(labelText: 'Имя или ник', prefixIcon: Icon(Icons.person_outline))),
            const SizedBox(height: 10),
            TextField(controller: _vehicle, decoration: const InputDecoration(labelText: 'Мой транспорт', hintText: 'Например, Crosser CR 15', prefixIcon: Icon(Icons.two_wheeler))),
            const SizedBox(height: 14),
            DropdownButtonFormField<String>(
              initialValue: _status,
              decoration: const InputDecoration(labelText: 'Статус'),
              items: const ['На линии', 'Не в сети', 'Занят'].map((v) => DropdownMenuItem(value: v, child: Text(v))).toList(),
              onChanged: (v) { if (v != null) setState(() => _status = v); },
            ),
            const SizedBox(height: 14),
            Align(alignment: Alignment.centerRight, child: TextButton.icon(
              onPressed: () => ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Черновик профиля действует на этом устройстве. Сохранение на сервер добавим после авторизации.'))),
              icon: const Icon(Icons.save_outlined), label: const Text('Сохранить черновик'),
            )),
          ]),
        ),
      ),
      Card(
        child: Column(children: [
          SwitchListTile(
            secondary: const Icon(Icons.dark_mode_outlined, color: motoYellow),
            title: const Text('Тёмная тема'),
            value: widget.isDark,
            onChanged: widget.onThemeChanged,
          ),
          const Divider(height: 1),
          ListTile(
            leading: const Icon(Icons.notifications_outlined, color: motoYellow),
            title: const Text('Режим уведомлений'),
            subtitle: Text(_notificationMode),
            trailing: const Icon(Icons.chevron_right),
            onTap: () async {
              final value = await showModalBottomSheet<String>(
                context: context,
                builder: (context) => SafeArea(child: Column(mainAxisSize: MainAxisSize.min, children: [
                  for (final mode in ['Обычный', 'В поездке', 'Не беспокоить'])
                    ListTile(title: Text(mode), onTap: () => Navigator.pop(context, mode)),
                ])),
              );
              if (value != null) setState(() => _notificationMode = value);
            },
          ),
        ]),
      ),
      const _FeatureTile(icon: Icons.privacy_tip_outlined, title: 'Приватность', detail: 'Телефон будет виден только владельцу и главному администратору. Не вводи личный номер в этот черновик.'),
      const _FeatureTile(icon: Icons.info_outline, title: 'Статус синхронизации', detail: 'Профиль и настройки пока локальные. Облачная синхронизация требует входа и серверного хранилища.'),
    ],
  );
}

class _PageHeading extends StatelessWidget {
  const _PageHeading({required this.title, required this.subtitle, required this.icon});
  final String title;
  final String subtitle;
  final IconData icon;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 20),
    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(children: [Icon(icon, color: motoYellow, size: 30), const SizedBox(width: 10), Text(title, style: const TextStyle(fontSize: 27, fontWeight: FontWeight.w900))]),
      const SizedBox(height: 5),
      Text(subtitle, style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant)),
    ]),
  );
}

class ChatsScreen extends StatefulWidget {
  const ChatsScreen({super.key});
  @override
  State<ChatsScreen> createState() => _ChatsScreenState();
}

class _ChatsScreenState extends State<ChatsScreen> {
  final _controller = TextEditingController();
  final List<String> _messages = [];

  @override
  void dispose() { _controller.dispose(); super.dispose(); }

  void _send() {
    final text = _controller.text.trim();
    if (text.isEmpty) return;
    setState(() { _messages.add(text); _controller.clear(); });
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Чат'), backgroundColor: const Color(0xFF090909)),
    body: Column(children: [
      const Padding(
        padding: EdgeInsets.all(12),
        child: Text('Локальный просмотр чата. Отправка другим пользователям станет доступна после подключения авторизации и сервера.', style: TextStyle(color: Colors.orangeAccent)),
      ),
      Expanded(child: _messages.isEmpty
        ? const Center(child: Text('Сообщений пока нет'))
        : ListView.builder(
            padding: const EdgeInsets.all(12),
            itemCount: _messages.length,
            itemBuilder: (context, index) => Align(
              alignment: Alignment.centerRight,
              child: Container(
                margin: const EdgeInsets.only(bottom: 8),
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(color: const Color(0xFF554900), borderRadius: BorderRadius.circular(14)),
                child: Text(_messages[index]),
              ),
            ),
          )),
      SafeArea(child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 6, 12, 10),
        child: Row(children: [
          Expanded(child: TextField(controller: _controller, decoration: const InputDecoration(hintText: 'Сообщение', border: OutlineInputBorder()), onSubmitted: (_) => _send())),
          IconButton(onPressed: _send, icon: const Icon(Icons.send, color: motoYellow)),
        ]),
      )),
    ]),
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
