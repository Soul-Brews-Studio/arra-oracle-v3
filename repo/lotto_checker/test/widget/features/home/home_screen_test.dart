import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lotto_checker/features/home/presentation/home_screen.dart';

import '../../../helpers/pump_app.dart';

void main() {
  group('HomeScreen', () {
    testWidgets('renders AppBar title "Lotto Checker"', (tester) async {
      await tester.pumpApp(const HomeScreen());

      expect(find.byType(AppBar), findsOneWidget);
      expect(find.text('Lotto Checker'), findsOneWidget);
    });

    testWidgets('renders Phase 1 body text', (tester) async {
      await tester.pumpApp(const HomeScreen());

      // Body should contain the Phase 1 placeholder copy. Match by substring
      // so the emoji prefix doesn't make the test brittle.
      final bodyText = find.byWidgetPredicate(
        (widget) =>
            widget is Text &&
            widget.data != null &&
            widget.data!.contains('Phase 1'),
      );
      expect(bodyText, findsOneWidget);
    });
  });
}
