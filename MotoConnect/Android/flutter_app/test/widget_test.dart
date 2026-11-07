import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:moto_connect/main.dart';

void main() {
  testWidgets('MotoConnect opens the main map screen', (tester) async {
    await tester.pumpWidget(const MotoConnectApp());

    expect(find.text('MOTO'), findsOneWidget);
    expect(find.text('CONNECT'), findsOneWidget);
    expect(find.text('Карта'), findsOneWidget);
    expect(find.text('Звонки'), findsOneWidget);
    expect(find.text('Группы'), findsOneWidget);
    expect(find.text('Профиль'), findsOneWidget);
  });

  testWidgets('Groups screen can create a local draft group', (tester) async {
    await tester.pumpWidget(const MotoConnectApp());

    // The map screen contains a repeating animation, so pumpAndSettle()
    // cannot finish while the IndexedStack keeps that screen mounted.
    await tester.tap(find.text('Группы'));
    await tester.pump(const Duration(milliseconds: 350));

    await tester.tap(find.text('Создать группу'));
    await tester.pump(const Duration(milliseconds: 350));
    await tester.enterText(find.byType(TextField), 'Тестовая команда');
    await tester.tap(find.text('Создать').last);
    await tester.pump(const Duration(milliseconds: 350));

    expect(find.text('Тестовая команда'), findsOneWidget);
    expect(find.textContaining('локальный черновик'), findsOneWidget);

    await tester.tap(find.text('Тестовая команда'));
    await tester.pump(const Duration(milliseconds: 350));
    expect(find.text('Участники'), findsOneWidget);
    expect(find.text('Голосовая связь'), findsOneWidget);
    expect(find.text('Локальная группа · владелец: вы'), findsOneWidget);

    await tester.tap(find.text('Голосовая связь'));
    await tester.pump(const Duration(milliseconds: 350));
    expect(find.text('Голосовая комната'), findsOneWidget);
    expect(find.text('Ожидает авторизацию'), findsOneWidget);
    expect(find.text('Войти в голосовую комнату'), findsOneWidget);

    await tester.pageBack();
    await tester.pump(const Duration(milliseconds: 350));
    expect(find.text('Участники'), findsOneWidget);

    await tester.tap(find.byTooltip('Назад к группам'));
    await tester.pump(const Duration(milliseconds: 350));
    expect(find.text('Тестовая команда'), findsOneWidget);
  });

  testWidgets('Map chat opens and accepts a local draft message', (tester) async {
    await tester.pumpWidget(const MotoConnectApp());
    await tester.tap(find.text('ЧАТ'));
    await tester.pump(const Duration(milliseconds: 350));

    expect(find.textContaining('Локальный просмотр чата.'), findsOneWidget);
    await tester.enterText(find.byType(TextField), 'Проверка связи');
    await tester.tap(find.byIcon(Icons.send));
    await tester.pump();

    expect(find.text('Проверка связи'), findsOneWidget);
  });
}
