import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:moto_connect/main.dart';
import 'package:moto_connect/features/voice/livekit_voice_service.dart';

Future<void> pumpNavigation(WidgetTester tester) async {
  // Give Navigator a frame to install the route transition, then advance it.
  // Avoid pumpAndSettle(): the map has a repeating animation in IndexedStack.
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 500));
}

void main() {
  test('voice service starts disconnected with no participants', () {
    final service = LiveKitVoiceService();

    expect(service.hasRoom, isFalse);
    expect(service.participants, isEmpty);

    service.dispose();
  });

  testWidgets('MotoConnect opens the main map screen', (tester) async {
    await tester.pumpWidget(const MotoConnectApp());

    expect(find.text('MOTO'), findsOneWidget);
    expect(find.text('CONNECT'), findsOneWidget);
    expect(find.text('Карта'), findsOneWidget);
    expect(find.text('Звонки'), findsOneWidget);
    expect(find.text('Группы'), findsOneWidget);
    expect(find.text('Профиль'), findsOneWidget);
  });

  testWidgets('Groups can be created, opened and enter a voice room', (tester) async {
    await tester.pumpWidget(const MotoConnectApp());

    await tester.tap(find.text('Группы'));
    await pumpNavigation(tester);

    await tester.tap(find.text('Создать группу'));
    await pumpNavigation(tester);
    await tester.enterText(find.byType(TextField), 'Тестовая команда');
    await tester.tap(find.text('Создать').last);
    await pumpNavigation(tester);

    expect(find.text('Тестовая команда'), findsOneWidget);
    expect(find.textContaining('локальный черновик'), findsOneWidget);

    await tester.tap(find.text('Тестовая команда'));
    await pumpNavigation(tester);

    // Assert the destination screen first; this is more stable than relying
    // only on a particular copy string inside the screen.
    expect(find.byType(GroupDetailScreen), findsOneWidget);
    expect(find.text('Локальная группа · владелец: вы'), findsOneWidget);
    expect(find.text('Участники'), findsOneWidget);

    await tester.tap(find.text('Голосовая связь'));
    await pumpNavigation(tester);
    expect(find.byType(VoiceRoomScreen), findsOneWidget);
    expect(find.text('Голосовая комната'), findsOneWidget);
    expect(find.text('Ожидает авторизацию'), findsOneWidget);
    expect(find.text('Войти в голосовую комнату'), findsOneWidget);

    await tester.pageBack();
    await pumpNavigation(tester);
    expect(find.byType(GroupDetailScreen), findsOneWidget);

    await tester.tap(find.byTooltip('Назад к группам'));
    await pumpNavigation(tester);
    expect(find.byType(GroupsScreen), findsOneWidget);
    expect(find.text('Тестовая команда'), findsOneWidget);
  });

  testWidgets('Map chat opens and accepts a local draft message', (tester) async {
    await tester.pumpWidget(const MotoConnectApp());

    await tester.tap(find.text('ЧАТ'));
    await pumpNavigation(tester);

    expect(find.byType(ChatsScreen), findsOneWidget);
    expect(find.text('Сообщений пока нет'), findsOneWidget);

    await tester.enterText(find.byType(TextField), 'Проверка связи');
    await tester.tap(find.byIcon(Icons.send));
    await tester.pump();

    expect(find.text('Проверка связи'), findsOneWidget);
  });

  testWidgets('Calls screen opens the nearby voice room', (tester) async {
    await tester.pumpWidget(const MotoConnectApp());

    await tester.tap(find.text('Звонки'));
    await pumpNavigation(tester);
    await tester.tap(find.text('Общий канал рядом'));
    await pumpNavigation(tester);

    expect(find.byType(VoiceRoomScreen), findsOneWidget);
    expect(find.text('Общий канал рядом'), findsWidgets);
    expect(find.text('Голосовая комната'), findsOneWidget);
  });
}
