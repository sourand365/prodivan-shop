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
}
