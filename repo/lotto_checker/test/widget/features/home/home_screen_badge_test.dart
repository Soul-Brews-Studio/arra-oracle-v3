import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:lotto_checker/features/home/presentation/home_screen.dart';
import 'package:lotto_checker/features/results/application/providers.dart';
import 'package:lotto_checker/features/results/domain/match_result.dart';
import 'package:lotto_checker/features/results/presentation/widgets/match_badge.dart';
import 'package:lotto_checker/features/tickets/data/providers.dart';
import 'package:lotto_checker/shared/models/prize.dart';
import 'package:lotto_checker/shared/models/ticket.dart';

import '../../../helpers/pump_router_app.dart';

// ── shared fixtures ───────────────────────────────────────────────────────────

final _ticket1 = Ticket(
  id: 'tid-1',
  numbers: '123456',
  drawDate: DateTime(2026, 4, 16),
  createdAt: DateTime(2026, 4, 1),
);

final _ticket2 = Ticket(
  id: 'tid-2',
  numbers: '654321',
  drawDate: DateTime(2026, 4, 16),
  createdAt: DateTime(2026, 4, 2),
);

GoRouter _router() => GoRouter(
      initialLocation: '/',
      routes: [
        GoRoute(
          path: '/',
          builder: (context, state) => const HomeScreen(),
        ),
      ],
    );

// ── tests ─────────────────────────────────────────────────────────────────────

void main() {
  setUpAll(() => initializeDateFormatting('th'));

  group('HomeScreen — match badges on TicketListTile', () {
    testWidgets('loading: shows spinner badge while matches stream is empty',
        (tester) async {
      await tester.pumpRouterApp(
        router: _router(),
        overrides: [
          allTicketsProvider.overrideWith((_) => Stream.value([_ticket1])),
          allTicketMatchesProvider.overrideWith(
            (_) => const Stream.empty(), // never emits → stays loading
          ),
        ],
      );
      // One pump to resolve allTicketsProvider (Stream.value) but keep
      // allTicketMatchesProvider in loading state (Stream.empty).
      await tester.pump();

      expect(find.byType(MatchBadge), findsNothing);
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
    });

    testWidgets('NoMatch: shows faint "ไม่ถูก" text, no MatchBadge pill',
        (tester) async {
      await tester.pumpRouterApp(
        router: _router(),
        overrides: [
          allTicketsProvider.overrideWith((_) => Stream.value([_ticket1])),
          allTicketMatchesProvider.overrideWith(
            (_) => Stream.value({'tid-1': const MatchResult.noMatch()}),
          ),
        ],
      );
      await tester.pumpAndSettle();

      expect(find.text('ไม่ถูก'), findsOneWidget);
      expect(find.byType(MatchBadge), findsNothing);
    });

    testWidgets('Match first prize: shows green MatchBadge with tier label',
        (tester) async {
      await tester.pumpRouterApp(
        router: _router(),
        overrides: [
          allTicketsProvider.overrideWith((_) => Stream.value([_ticket1])),
          allTicketMatchesProvider.overrideWith(
            (_) => Stream.value({
              'tid-1': const MatchResult.match(
                tier: PrizeTier.first,
                prizeAmount: 6000000,
                matchedDigits: '123456',
              ),
            }),
          ),
        ],
      );
      await tester.pumpAndSettle();

      expect(find.byType(MatchBadge), findsOneWidget);
      expect(find.textContaining('รางวัลที่ 1'), findsOneWidget);
      expect(find.textContaining('บาท'), findsOneWidget);
    });

    testWidgets('Match minor prize: shows amber MatchBadge with tier label',
        (tester) async {
      await tester.pumpRouterApp(
        router: _router(),
        overrides: [
          allTicketsProvider.overrideWith((_) => Stream.value([_ticket1])),
          allTicketMatchesProvider.overrideWith(
            (_) => Stream.value({
              'tid-1': const MatchResult.match(
                tier: PrizeTier.twoDigitBack,
                prizeAmount: 2000,
                matchedDigits: '56',
              ),
            }),
          ),
        ],
      );
      await tester.pumpAndSettle();

      expect(find.byType(MatchBadge), findsOneWidget);
      expect(find.textContaining('เลขท้าย 2 ตัว'), findsOneWidget);
    });

    testWidgets('multiple tickets: each shows its independent badge',
        (tester) async {
      await tester.pumpRouterApp(
        router: _router(),
        overrides: [
          allTicketsProvider.overrideWith(
            (_) => Stream.value([_ticket1, _ticket2]),
          ),
          allTicketMatchesProvider.overrideWith(
            (_) => Stream.value({
              'tid-1': const MatchResult.match(
                tier: PrizeTier.first,
                prizeAmount: 6000000,
                matchedDigits: '123456',
              ),
              'tid-2': const MatchResult.noMatch(),
            }),
          ),
        ],
      );
      await tester.pumpAndSettle();

      // tid-1 wins → one MatchBadge pill
      expect(find.byType(MatchBadge), findsOneWidget);
      expect(find.textContaining('รางวัลที่ 1'), findsOneWidget);
      // tid-2 loses → plain text, no extra pill
      expect(find.text('ไม่ถูก'), findsOneWidget);
    });
  });
}
