import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:lotto_checker/features/results/data/providers.dart';
import 'package:lotto_checker/features/results/presentation/draw_history_screen.dart';
import 'package:lotto_checker/shared/models/prize.dart';

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

  group('DrawHistoryScreen', () {
    testWidgets('shows loading spinner while stream is pending', (tester) async {
      await tester.pumpRouterApp(
        router: _router(),
        overrides: [
          allDrawsProvider.overrideWith((_) => const Stream.empty()),
        ],
      );
      await tester.pump();

      expect(find.byType(CircularProgressIndicator), findsOneWidget);
    });

    testWidgets('shows empty state when no draws are cached', (tester) async {
      await tester.pumpRouterApp(
        router: _router(),
        overrides: [
          allDrawsProvider.overrideWith((_) => Stream.value([])),
        ],
      );
      await tester.pumpAndSettle();

      expect(find.text('ยังไม่มีข้อมูลผลรางวัล'), findsOneWidget);
    });

    testWidgets('shows one card per draw', (tester) async {
      final draws = fixtureDraws(); // 3 draws

      await tester.pumpRouterApp(
        router: _router(),
        overrides: [
          allDrawsProvider.overrideWith((_) => Stream.value(draws)),
        ],
      );
      await tester.pumpAndSettle();

      // Each draw shows "รางวัลที่ 1" in its header.
      expect(find.text('รางวัลที่ 1'), findsNWidgets(draws.length));
    });

    testWidgets('card header shows first prize number of that draw',
        (tester) async {
      final draw = fixtureDraw(
        drawDate: DateTime(2026, 4, 16),
        winningNumbers: {PrizeTier.first: ['987654']},
        prizes: {'first': '987654'},
      );

      await tester.pumpRouterApp(
        router: _router(),
        overrides: [
          allDrawsProvider.overrideWith((_) => Stream.value([draw])),
        ],
      );
      await tester.pumpAndSettle();

      // Spaced first prize digits shown in the collapsed header.
      expect(find.textContaining('9 8 7 6 5 4'), findsOneWidget);
    });

    testWidgets('expanding a card reveals all available tiers', (tester) async {
      final draw = fixtureDraw();

      await tester.pumpRouterApp(
        router: _router(),
        overrides: [
          allDrawsProvider.overrideWith((_) => Stream.value([draw])),
        ],
      );
      await tester.pumpAndSettle();

      // Tap to expand the first (only) card.
      await tester.tap(find.text('รางวัลที่ 1').first);
      await tester.pumpAndSettle();

      // All 9 tier labels should be visible after expansion.
      // Note: PrizeTier.first.label appears twice (header + expanded row).
      for (final tier in PrizeTier.values) {
        expect(
          find.text(tier.label),
          isNot(findsNothing),
          reason: 'Expected label for ${tier.label}',
        );
      }
    });

    testWidgets('AppBar shows history title', (tester) async {
      await tester.pumpRouterApp(
        router: _router(),
        overrides: [
          allDrawsProvider.overrideWith((_) => Stream.value([])),
        ],
      );
      await tester.pumpAndSettle();

      expect(find.text('ประวัติผลรางวัล'), findsOneWidget);
    });
  });
}
