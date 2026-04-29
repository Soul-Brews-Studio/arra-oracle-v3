@Tags(['golden'])
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:golden_toolkit/golden_toolkit.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:lotto_checker/features/results/application/providers.dart';
import 'package:lotto_checker/features/results/domain/match_result.dart';
import 'package:lotto_checker/features/results/presentation/results_screen.dart';
import 'package:lotto_checker/features/tickets/data/providers.dart';
import 'package:lotto_checker/shared/models/prize.dart';
import 'package:lotto_checker/shared/models/ticket.dart';

import '../fixtures/tickets.dart';
import '../helpers/golden_config.dart';

void main() {
  setUpAll(() async {
    await initializeDateFormatting('th');
  });

  group('ResultsScreen golden', () {
    testGoldens('three pinned tickets — big win, small win, no match', (
      tester,
    ) async {
      final tickets = <Ticket>[
        fixtureTicket(
          id: 'big-win',
          numbers: '123456',
          drawDate: DateTime.utc(2026, 5, 1),
          createdAt: DateTime.utc(2026, 4, 27, 9),
        ),
        fixtureTicket(
          id: 'small-win',
          numbers: '654456',
          drawDate: DateTime.utc(2026, 5, 1),
          createdAt: DateTime.utc(2026, 4, 27, 10),
        ),
        fixtureTicket(
          id: 'no-match',
          numbers: '999999',
          drawDate: DateTime.utc(2026, 5, 1),
          createdAt: DateTime.utc(2026, 4, 27, 11),
          note: 'lucky pick',
        ),
      ];

      const matches = <String, MatchResult>{
        'big-win': MatchResult.match(
          tier: PrizeTier.first,
          prizeAmount: 6000000,
          matchedDigits: '123456',
        ),
        'small-win': MatchResult.match(
          tier: PrizeTier.threeDigitBack,
          prizeAmount: 4000,
          matchedDigits: '456',
        ),
        'no-match': MatchResult.noMatch(),
      };

      final builder = buildStandardDevices(
        const ResultsScreen(),
        name: 'results_screen',
      );

      await tester.pumpDeviceBuilder(
        builder,
        wrapper: (child) => ProviderScope(
          overrides: [
            allTicketsProvider.overrideWith((_) => Stream.value(tickets)),
            allTicketMatchesProvider
                .overrideWith((_) => Stream.value(matches)),
          ],
          child: MaterialApp(home: child),
        ),
      );
      await tester.pumpAndSettle();

      await screenMatchesGolden(tester, 'results_screen');
    });
  });
}
