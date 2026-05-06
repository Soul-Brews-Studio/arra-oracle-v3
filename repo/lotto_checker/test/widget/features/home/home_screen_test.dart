import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:lotto_checker/features/home/presentation/home_screen.dart';
import 'package:lotto_checker/features/tickets/data/providers.dart';
import 'package:lotto_checker/shared/models/ticket.dart';

import '../../../helpers/pump_app.dart';

void main() {
  setUpAll(() => initializeDateFormatting('th'));

  group('HomeScreen', () {
    testWidgets('renders AppBar title "ตรวจหวย"', (tester) async {
      await tester.pumpApp(
        const HomeScreen(),
        overrides: [
          allTicketsProvider.overrideWith((_) => Stream.value([])),
        ],
      );
      await tester.pumpAndSettle();

      expect(find.byType(AppBar), findsOneWidget);
      expect(find.text('ตรวจหวย'), findsOneWidget);
    });

    testWidgets('shows loading spinner while stream is pending', (tester) async {
      const stream = Stream<List<Ticket>>.empty(); // never emits
      await tester.pumpApp(
        const HomeScreen(),
        overrides: [
          allTicketsProvider.overrideWith((_) => stream),
        ],
      );
      // Only pump — don't settle so the loading state is visible.
      await tester.pump();

      expect(find.byType(CircularProgressIndicator), findsOneWidget);
    });

    testWidgets('shows empty state when ticket list is empty', (tester) async {
      await tester.pumpApp(
        const HomeScreen(),
        overrides: [
          allTicketsProvider.overrideWith((_) => Stream.value([])),
        ],
      );
      await tester.pumpAndSettle();

      expect(find.text('ยังไม่มีตั๋ว'), findsOneWidget);
    });
  });
}
