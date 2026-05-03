import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:lotto_checker/features/home/presentation/home_screen.dart';
import 'package:lotto_checker/features/tickets/data/providers.dart';
import 'package:lotto_checker/features/tickets/data/ticket_repository.dart';
import 'package:lotto_checker/features/tickets/presentation/ticket_input_screen.dart';
import 'package:lotto_checker/shared/models/ticket.dart';
import 'package:mocktail/mocktail.dart';

import '../../../helpers/pump_router_app.dart';

class _MockRepo extends Mock implements TicketRepository {}

// ── router matching real app routes ──────────────────────────────────────────

GoRouter _router() => GoRouter(
      initialLocation: '/',
      routes: [
        GoRoute(
          path: '/',
          builder: (context, state) => const HomeScreen(),
        ),
        GoRoute(
          path: '/tickets/new',
          builder: (context, state) => const TicketInputScreen(),
        ),
        GoRoute(
          path: '/tickets/:id/edit',
          builder: (context, state) => TicketInputScreen(
            ticketId: state.pathParameters['id'],
          ),
        ),
      ],
    );

// ── shared tickets ────────────────────────────────────────────────────────────

final _ticket1 = Ticket(
  id: 'tid-1',
  numbers: '123456',
  drawDate: DateTime(2026, 4, 16),
  createdAt: DateTime(2026, 4, 1),
);

final _ticket2 = Ticket(
  id: 'tid-2',
  numbers: '654321',
  drawDate: DateTime(2026, 5, 1),
  createdAt: DateTime(2026, 4, 10),
  note: 'lucky',
);

// ── tests ─────────────────────────────────────────────────────────────────────

void main() {
  setUpAll(() async {
    await initializeDateFormatting('th');
    registerFallbackValue(_ticket1);
  });

  group('HomeScreen — empty state', () {
    testWidgets('shows ยังไม่มีตั๋ว when list is empty', (tester) async {
      final repo = _MockRepo();
      when(repo.watchAll).thenAnswer((_) => Stream.value([]));

      await tester.pumpRouterApp(
        router: _router(),
        overrides: [
          allTicketsProvider.overrideWith((_) => Stream.value([])),
          ticketRepositoryProvider.overrideWithValue(repo),
        ],
      );
      await tester.pumpAndSettle();

      expect(find.text('ยังไม่มีตั๋ว'), findsOneWidget);
    });

    testWidgets('empty state FAB navigates to add screen', (tester) async {
      final repo = _MockRepo();
      when(repo.watchAll).thenAnswer((_) => Stream.value([]));

      await tester.pumpRouterApp(
        router: _router(),
        overrides: [
          allTicketsProvider.overrideWith((_) => Stream.value([])),
          ticketRepositoryProvider.overrideWithValue(repo),
        ],
      );
      await tester.pumpAndSettle();

      // Two Icons.add exist (empty-state FilledButton + FAB) — tap either one.
      await tester.tap(find.byIcon(Icons.add).first);
      await tester.pumpAndSettle();
      expect(find.text('Add ticket'), findsOneWidget);
    });
  });

  group('HomeScreen — ticket list', () {
    testWidgets('shows ticket numbers spaced', (tester) async {
      await tester.pumpRouterApp(
        router: _router(),
        overrides: [
          allTicketsProvider.overrideWith(
            (_) => Stream.value([_ticket1]),
          ),
        ],
      );
      await tester.pumpAndSettle();

      // _spaced('123456') = '1 2 3 4 5 6'
      expect(find.textContaining('1 2 3 4 5 6'), findsOneWidget);
    });

    testWidgets('shows note subtitle when note is set', (tester) async {
      await tester.pumpRouterApp(
        router: _router(),
        overrides: [
          allTicketsProvider.overrideWith(
            (_) => Stream.value([_ticket2]),
          ),
        ],
      );
      await tester.pumpAndSettle();

      expect(find.text('lucky'), findsOneWidget);
    });

    testWidgets('edit icon navigates to /tickets/:id/edit', (tester) async {
      final repo = _MockRepo();
      when(() => repo.getById('tid-1'))
          .thenAnswer((_) async => _ticket1);

      await tester.pumpRouterApp(
        router: _router(),
        overrides: [
          allTicketsProvider.overrideWith(
            (_) => Stream.value([_ticket1]),
          ),
          ticketRepositoryProvider.overrideWithValue(repo),
        ],
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byIcon(Icons.edit_outlined));
      await tester.pumpAndSettle();

      expect(find.text('Edit ticket'), findsOneWidget);
    });

    testWidgets('results icon in AppBar navigates to /results', (tester) async {
      await tester.pumpRouterApp(
        router: GoRouter(
          initialLocation: '/',
          routes: [
            GoRoute(
              path: '/',
              builder: (context, state) => const HomeScreen(),
            ),
            GoRoute(
              path: '/results',
              builder: (context, state) => const Scaffold(
                body: Center(child: Text('RESULTS')),
              ),
            ),
          ],
        ),
        overrides: [
          allTicketsProvider.overrideWith((_) => Stream.value([])),
        ],
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byIcon(Icons.assignment_turned_in_outlined));
      await tester.pumpAndSettle();

      expect(find.text('RESULTS'), findsOneWidget);
    });
  });

  group('HomeScreen — swipe to delete', () {
    testWidgets('swiping left shows delete background', (tester) async {
      final repo = _MockRepo();
      when(() => repo.delete(any())).thenAnswer((_) async {});

      await tester.pumpRouterApp(
        router: _router(),
        overrides: [
          allTicketsProvider.overrideWith(
            (_) => Stream.value([_ticket1]),
          ),
          ticketRepositoryProvider.overrideWithValue(repo),
        ],
      );
      await tester.pumpAndSettle();

      // Drag ticket to the left to reveal delete background.
      await tester.drag(
        find.textContaining('1 2 3 4 5 6'),
        const Offset(-200, 0),
      );
      await tester.pump();

      expect(find.byIcon(Icons.delete_outline), findsOneWidget);
    });
  });
}
