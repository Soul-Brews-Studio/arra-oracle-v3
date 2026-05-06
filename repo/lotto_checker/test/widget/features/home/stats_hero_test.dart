import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:lotto_checker/features/home/presentation/widgets/stats_hero.dart';
import 'package:lotto_checker/features/results/application/providers.dart';
import 'package:lotto_checker/features/results/domain/match_result.dart';
import 'package:lotto_checker/features/tickets/data/providers.dart';
import 'package:lotto_checker/shared/models/prize.dart';
import 'package:lotto_checker/shared/models/ticket.dart';

import '../../../helpers/pump_app.dart';

final _t1 = Ticket(
  id: 't1',
  numbers: '111111',
  drawDate: DateTime(2026, 5, 1),
  createdAt: DateTime(2026, 4, 20),
);
final _t2 = Ticket(
  id: 't2',
  numbers: '222222',
  drawDate: DateTime(2026, 5, 1),
  createdAt: DateTime(2026, 4, 21),
);

void main() {
  setUpAll(() => initializeDateFormatting('th'));

  group('StatsHero', () {
    testWidgets('hides itself when there are no tickets', (tester) async {
      await tester.pumpApp(
        const Scaffold(body: StatsHero()),
        overrides: [
          allTicketsProvider.overrideWith((_) => Stream.value([])),
          allTicketMatchesProvider.overrideWith(
            (_) => Stream.value(const <String, MatchResult>{}),
          ),
        ],
      );
      await tester.pumpAndSettle();

      expect(find.text('ตั๋วทั้งหมด'), findsNothing);
    });

    testWidgets('renders three labels when tickets exist', (tester) async {
      await tester.pumpApp(
        const Scaffold(body: StatsHero()),
        overrides: [
          allTicketsProvider.overrideWith((_) => Stream.value([_t1, _t2])),
          allTicketMatchesProvider.overrideWith(
            (_) => Stream.value(const <String, MatchResult>{
              't1': MatchResult.noMatch(),
              't2': MatchResult.noMatch(),
            }),
          ),
        ],
      );
      await tester.pumpAndSettle();

      expect(find.text('ตั๋วทั้งหมด'), findsOneWidget);
      expect(find.text('ถูกรางวัล'), findsOneWidget);
      expect(find.text('ได้รวม'), findsOneWidget);
    });

    testWidgets('counts wins and prize from Match results', (tester) async {
      await tester.pumpApp(
        const Scaffold(body: StatsHero()),
        overrides: [
          allTicketsProvider.overrideWith((_) => Stream.value([_t1, _t2])),
          allTicketMatchesProvider.overrideWith(
            (_) => Stream.value(const <String, MatchResult>{
              't1': MatchResult.match(
                tier: PrizeTier.twoDigitBack,
                prizeAmount: 2000,
                matchedDigits: '11',
              ),
              't2': MatchResult.noMatch(),
            }),
          ),
        ],
      );
      // Pump past the count-up animation (800ms).
      await tester.pumpAndSettle(const Duration(seconds: 1));

      // 1 win, 2000 prize — text contains the trailing labels.
      expect(find.textContaining('1 ใบ'), findsWidgets);
      expect(find.textContaining('2,000 ฿'), findsOneWidget);
    });
  });
}
