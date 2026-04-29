import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:lotto_checker/features/results/application/providers.dart';
import 'package:lotto_checker/features/results/domain/match_result.dart';
import 'package:lotto_checker/features/results/presentation/results_screen.dart';
import 'package:lotto_checker/features/results/presentation/widgets/ticket_match_card.dart';
import 'package:lotto_checker/features/tickets/data/providers.dart';
import 'package:lotto_checker/shared/models/prize.dart';
import 'package:lotto_checker/shared/models/ticket.dart';

import '../../../fixtures/tickets.dart';
import '../../../helpers/pump_router_app.dart';

GoRouter _router() => GoRouter(
      initialLocation: '/results',
      routes: [
        GoRoute(
          path: '/',
          builder: (context, state) => const Scaffold(
            body: Center(child: Text('HOME')),
          ),
        ),
        GoRoute(
          path: '/results',
          builder: (context, state) => const ResultsScreen(),
        ),
      ],
    );

Future<void> _pump(
  WidgetTester tester, {
  required List<Override> overrides,
}) async {
  tester.view.physicalSize = const Size(800, 1600);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpRouterApp(router: _router(), overrides: overrides);
  await tester.pump();
}

void main() {
  setUpAll(() async {
    await initializeDateFormatting('th');
  });

  group('ResultsScreen — chrome', () {
    testWidgets('renders AppBar with Thai title', (tester) async {
      await _pump(tester, overrides: [
        allTicketsProvider.overrideWith((_) => Stream.value(const <Ticket>[])),
        allTicketMatchesProvider
            .overrideWith((_) => Stream.value(const <String, MatchResult>{})),
      ],);
      await tester.pumpAndSettle();

      expect(find.text('ผลการตรวจ'), findsOneWidget);
      expect(find.byIcon(Icons.refresh), findsOneWidget);
      expect(find.byIcon(Icons.arrow_back), findsOneWidget);
    });
  });

  group('ResultsScreen — empty state', () {
    testWidgets('shows ยังไม่มีตั๋ว when there are no tickets', (tester) async {
      await _pump(tester, overrides: [
        allTicketsProvider.overrideWith((_) => Stream.value(const <Ticket>[])),
        allTicketMatchesProvider
            .overrideWith((_) => Stream.value(const <String, MatchResult>{})),
      ],);
      await tester.pumpAndSettle();

      expect(find.text('ยังไม่มีตั๋ว'), findsOneWidget);
      expect(find.text('เพิ่มตั๋วแรกของคุณเพื่อตรวจผล'), findsOneWidget);
      expect(find.byType(TicketMatchCard), findsNothing);
    });
  });

  group('ResultsScreen — loaded state', () {
    testWidgets('renders one TicketMatchCard per ticket', (tester) async {
      final tickets = [
        fixtureTicket(id: 'a', numbers: '123456'),
        fixtureTicket(id: 'b', numbers: '999999'),
      ];
      await _pump(tester, overrides: [
        allTicketsProvider.overrideWith((_) => Stream.value(tickets)),
        allTicketMatchesProvider.overrideWith(
          (_) => Stream.value(const <String, MatchResult>{
            'a': MatchResult.match(
              tier: PrizeTier.first,
              prizeAmount: 6000000,
              matchedDigits: '123456',
            ),
            'b': MatchResult.noMatch(),
          }),
        ),
      ],);
      await tester.pumpAndSettle();

      expect(find.byType(TicketMatchCard), findsNWidgets(2));
      expect(find.textContaining('รางวัลที่ 1'), findsOneWidget);
      expect(find.text('ไม่ถูก'), findsOneWidget);
    });
  });

  group('ResultsScreen — loading state', () {
    testWidgets('shows spinner while tickets load', (tester) async {
      final controller = StreamController<List<Ticket>>();
      addTearDown(controller.close);
      await _pump(tester, overrides: [
        allTicketsProvider.overrideWith((_) => controller.stream),
        allTicketMatchesProvider
            .overrideWith((_) => const Stream<Map<String, MatchResult>>.empty()),
      ],);
      await tester.pump();

      expect(find.byType(CircularProgressIndicator), findsOneWidget);
    });

    testWidgets(
      'card shows badge loading when matches still pending but tickets loaded',
      (tester) async {
        final ticket = fixtureTicket(numbers: '123456');
        final matchesController = StreamController<Map<String, MatchResult>>();
        addTearDown(matchesController.close);
        await _pump(tester, overrides: [
          allTicketsProvider.overrideWith((_) => Stream.value([ticket])),
          allTicketMatchesProvider
              .overrideWith((_) => matchesController.stream),
        ],);
        await tester.pump();

        expect(find.text('กำลังตรวจ...'), findsOneWidget);
      },
    );
  });

  group('ResultsScreen — error state', () {
    testWidgets('shows error view + retry button on tickets error',
        (tester) async {
      await _pump(tester, overrides: [
        allTicketsProvider
            .overrideWith((_) => Stream<List<Ticket>>.error(Exception('boom'))),
        allTicketMatchesProvider
            .overrideWith((_) => const Stream<Map<String, MatchResult>>.empty()),
      ],);
      await tester.pumpAndSettle();

      expect(find.textContaining('โหลดตั๋วไม่สำเร็จ'), findsOneWidget);
      expect(find.text('ลองใหม่'), findsOneWidget);
    });

    testWidgets('card shows ตรวจไม่ได้ when matches error after tickets load',
        (tester) async {
      final ticket = fixtureTicket(numbers: '123456');
      await _pump(tester, overrides: [
        allTicketsProvider.overrideWith((_) => Stream.value([ticket])),
        allTicketMatchesProvider.overrideWith(
          (_) => Stream<Map<String, MatchResult>>.error(Exception('net')),
        ),
      ],);
      await tester.pumpAndSettle();

      expect(find.text('ตรวจไม่ได้'), findsOneWidget);
    });
  });

  group('ResultsScreen — interactions', () {
    testWidgets('refresh AppBar action does not throw', (tester) async {
      await _pump(tester, overrides: [
        allTicketsProvider.overrideWith(
          (_) => Stream.value([fixtureTicket(numbers: '123456')]),
        ),
        allTicketMatchesProvider
            .overrideWith((_) => Stream.value(const <String, MatchResult>{})),
      ],);
      await tester.pumpAndSettle();

      await tester.tap(find.byIcon(Icons.refresh));
      await tester.pump();
      // Reaching this point with no exception is the assertion.
      expect(find.byIcon(Icons.refresh), findsOneWidget);
    });

    testWidgets('back button navigates to home', (tester) async {
      await _pump(tester, overrides: [
        allTicketsProvider.overrideWith((_) => Stream.value(const <Ticket>[])),
        allTicketMatchesProvider
            .overrideWith((_) => Stream.value(const <String, MatchResult>{})),
      ],);
      await tester.pumpAndSettle();

      await tester.tap(find.byIcon(Icons.arrow_back));
      await tester.pumpAndSettle();
      expect(find.text('HOME'), findsOneWidget);
    });

    testWidgets('pull-to-refresh shows RefreshIndicator scaffolding',
        (tester) async {
      await _pump(tester, overrides: [
        allTicketsProvider.overrideWith(
          (_) => Stream.value([fixtureTicket(numbers: '123456')]),
        ),
        allTicketMatchesProvider
            .overrideWith((_) => Stream.value(const <String, MatchResult>{})),
      ],);
      await tester.pumpAndSettle();

      expect(find.byType(RefreshIndicator), findsOneWidget);
      await tester.fling(find.byType(ListView), const Offset(0, 300), 1000);
      await tester.pump();
      await tester.pumpAndSettle();
      expect(find.byType(RefreshIndicator), findsOneWidget);
    });
  });
}
