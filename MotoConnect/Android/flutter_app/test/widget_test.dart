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
    await tester.tap(find.text('Группы'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Создать группу'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'Тестовая команда');
    await tester.tap(find.text('Создать').last);
    await tester.pumpAndSettle();

    expect(find.text('Тестовая команда'), findsOneWidget);
    expect(find.textContaining('локальный черновик'), findsOneWidget);
  });

  testWidgets('Map chat opens and accepts a local draft message', (tester) async {
    await tester.pumpWidget(const MotoConnectApp());
    await tester.tap(find.text('ЧАТ'));
    await tester.pumpAndSettle();

    expect(find.text('Локальный просмотр чата.'), findsOneWidget);
    await tester.enterText(find.byType(TextField), 'Проверка связи');
    await tester.tap(find.byIcon(Icons.send));
    await tester.pumpAndSettle();

    expect(find.text('Проверка связи'), findsOneWidget);
  });
}
