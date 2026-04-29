import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:lotto_checker/features/results/domain/match_result.dart';
import 'package:lotto_checker/features/results/presentation/widgets/match_badge.dart';
import 'package:lotto_checker/features/results/presentation/widgets/ticket_match_card.dart';
import 'package:lotto_checker/shared/models/prize.dart';

import '../../../../fixtures/tickets.dart';
import '../../../../helpers/pump_app.dart';

void main() {
  setUpAll(() async {
    await initializeDateFormatting('th');
  });

  group('TicketMatchCard — won variants', () {
    testWidgets('first prize: shows Thai tier label + amount + บาท',
        (tester) async {
      await tester.pumpApp(
        TicketMatchCard(
          ticket: fixtureTicket(numbers: '123456'),
          match: const MatchResult.match(
            tier: PrizeTier.first,
            prizeAmount: 6000000,
            matchedDigits: '123456',
          ),
        ),
      );

      expect(
        find.textContaining('รางวัลที่ 1'),
        findsOneWidget,
      );
      expect(find.textContaining('บาท'), findsOneWidget);
      expect(find.byType(MatchBadge), findsOneWidget);
    });

    testWidgets('two-digit back: shows correct minor-tier label', (tester) async {
      await tester.pumpApp(
        TicketMatchCard(
          ticket: fixtureTicket(numbers: '123456'),
          match: const MatchResult.match(
            tier: PrizeTier.twoDigitBack,
            prizeAmount: 2000,
            matchedDigits: '56',
          ),
        ),
      );

      expect(find.textContaining('เลขท้าย 2 ตัว'), findsOneWidget);
    });

    testWidgets('renders the ticket number digits', (tester) async {
      await tester.pumpApp(
        TicketMatchCard(
          ticket: fixtureTicket(numbers: '123456'),
          match: const MatchResult.match(
            tier: PrizeTier.first,
            prizeAmount: 6000000,
            matchedDigits: '123456',
          ),
        ),
      );

      expect(find.byType(RichText), findsWidgets);
    });
  });

  group('TicketMatchCard — no match', () {
    testWidgets('shows ไม่ถูก label', (tester) async {
      await tester.pumpApp(
        TicketMatchCard(
          ticket: fixtureTicket(numbers: '999999'),
          match: const MatchResult.noMatch(),
        ),
      );

      expect(find.text('ไม่ถูก'), findsOneWidget);
    });
  });

  group('TicketMatchCard — loading variant', () {
    testWidgets('shows กำลังตรวจ... and a spinner', (tester) async {
      await tester.pumpApp(
        TicketMatchCard(
          ticket: fixtureTicket(),
          match: null,
          isLoading: true,
        ),
      );

      expect(find.text('กำลังตรวจ...'), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
    });
  });

  group('TicketMatchCard — error variant', () {
    testWidgets('shows ตรวจไม่ได้ when hasError + match is null',
        (tester) async {
      await tester.pumpApp(
        TicketMatchCard(
          ticket: fixtureTicket(),
          match: null,
          hasError: true,
        ),
      );

      expect(find.text('ตรวจไม่ได้'), findsOneWidget);
    });

    testWidgets('shows ตรวจไม่ได้ when match is null and not loading',
        (tester) async {
      await tester.pumpApp(
        TicketMatchCard(
          ticket: fixtureTicket(),
          match: null,
        ),
      );

      expect(find.text('ตรวจไม่ได้'), findsOneWidget);
    });
  });

  group('TicketMatchCard — note', () {
    testWidgets('renders the note text when present', (tester) async {
      await tester.pumpApp(
        TicketMatchCard(
          ticket: fixtureTicket(note: 'birthday numbers'),
          match: const MatchResult.noMatch(),
        ),
      );

      expect(find.text('birthday numbers'), findsOneWidget);
    });

    testWidgets('does not render an empty note', (tester) async {
      await tester.pumpApp(
        TicketMatchCard(
          ticket: fixtureTicket(note: ''),
          match: const MatchResult.noMatch(),
        ),
      );

      expect(find.text(''), findsNothing);
    });
  });
}
