import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:lotto_checker/features/results/data/providers.dart';
import 'package:lotto_checker/features/results/presentation/draw_history_screen.dart';

import '../../../fixtures/draws.dart';
import '../../../helpers/pump_router_app.dart';

GoRouter _router() => GoRouter(
      initialLocation: '/draws',
      routes: [
        GoRoute(
          path: '/draws',
          builder: (context, state) => const DrawHistoryScreen(),
        ),
        GoRoute(
          path: '/',
          builder: (context, state) => const Scaffold(body: Text('HOME')),
        ),
      ],
    );

void main() {
  setUpAll(() => initializeDateFormatting('th'));

  group('DrawHistoryScreen filter', () {
    testWidgets('shows all draws when no filter is active', (tester) async {
      final draws = fixtureDraws();

      await tester.pumpRouterApp(
        router: _router(),
        overrides: [
          allDrawsProvider.overrideWith((_) => Stream.value(draws)),
        ],
      );
      await tester.pumpAndSettle();

      expect(find.text('รางวัลที่ 1'), findsNWidgets(draws.length));
      expect(find.byKey(const Key('drawFilter.resetButton')), findsNothing);
    });

    testWidgets('applies date-range filter to the draw list', (tester) async {
      // Fixtures: 2026-04-16, 2026-05-01, 2026-05-16. Range covers only May 1.
      await tester.pumpRouterApp(
        router: _router(),
        overrides: [
          allDrawsProvider.overrideWith((_) => Stream.value(fixtureDraws())),
          drawFilterProvider.overrideWith(
            (_) => DrawFilter(
              startDate: DateTime(2026, 4, 20),
              endDate: DateTime(2026, 5, 10),
            ),
          ),
        ],
      );
      await tester.pumpAndSettle();

      expect(find.text('รางวัลที่ 1'), findsOneWidget);
      // The reset button is visible while filter is active.
      expect(find.byKey(const Key('drawFilter.resetButton')), findsOneWidget);
    });

    testWidgets('shows filtered-empty message when range matches no draws',
        (tester) async {
      await tester.pumpRouterApp(
        router: _router(),
        overrides: [
          allDrawsProvider.overrideWith((_) => Stream.value(fixtureDraws())),
          drawFilterProvider.overrideWith(
            (_) => DrawFilter(
              startDate: DateTime(2030, 1, 1),
              endDate: DateTime(2030, 12, 31),
            ),
          ),
        ],
      );
      await tester.pumpAndSettle();

      expect(find.text('ไม่เจอผลในช่วงที่เลือก'), findsOneWidget);
      expect(find.text('รางวัลที่ 1'), findsNothing);
    });

    testWidgets('reset button clears the filter and re-shows all draws',
        (tester) async {
      final draws = fixtureDraws();

      await tester.pumpRouterApp(
        router: _router(),
        overrides: [
          allDrawsProvider.overrideWith((_) => Stream.value(draws)),
          drawFilterProvider.overrideWith(
            (_) => DrawFilter(
              startDate: DateTime(2030, 1, 1),
              endDate: DateTime(2030, 12, 31),
            ),
          ),
        ],
      );
      await tester.pumpAndSettle();

      // Filter is active and matches nothing — empty state visible.
      expect(find.text('ไม่เจอผลในช่วงที่เลือก'), findsOneWidget);

      // Tap the reset button.
      await tester.tap(find.byKey(const Key('drawFilter.resetButton')));
      await tester.pumpAndSettle();

      // All fixture draws should now be visible again.
      expect(find.text('รางวัลที่ 1'), findsNWidgets(draws.length));
      expect(find.byKey(const Key('drawFilter.resetButton')), findsNothing);
    });
  });
}
