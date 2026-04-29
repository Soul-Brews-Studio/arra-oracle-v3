import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:lotto_checker/features/tickets/data/providers.dart';
import 'package:lotto_checker/features/tickets/data/ticket_repository.dart';
import 'package:lotto_checker/features/tickets/presentation/ticket_input_screen.dart';
import 'package:lotto_checker/shared/models/ticket.dart';
import 'package:mocktail/mocktail.dart';

import '../../../fixtures/tickets.dart';
import '../../../helpers/pump_router_app.dart';

class _MockTicketRepository extends Mock implements TicketRepository {}

GoRouter _router() {
  return GoRouter(
    initialLocation: '/input',
    routes: [
      GoRoute(
        path: '/',
        builder: (context, state) => const Scaffold(
          body: Center(child: Text('HOME')),
        ),
      ),
      GoRoute(
        path: '/input',
        builder: (context, state) => const TicketInputScreen(),
      ),
    ],
  );
}

void main() {
  setUpAll(() {
    registerFallbackValue(fixtureTicket());
  });

  late _MockTicketRepository repo;

  setUp(() {
    repo = _MockTicketRepository();
    when(() => repo.save(any())).thenAnswer((_) async {});
  });

  Future<void> pumpScreen(WidgetTester tester) async {
    // The full input screen (display + date picker + note + keypad + save)
    // does not fit in the default 800x600 test viewport. Use a tall surface
    // so every control is hit-testable without scrolling.
    tester.view.physicalSize = const Size(800, 1600);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpRouterApp(
      router: _router(),
      overrides: [ticketRepositoryProvider.overrideWithValue(repo)],
    );
    await tester.pumpAndSettle();
  }

  Future<void> typeAll(WidgetTester tester, List<String> digits) async {
    for (final d in digits) {
      await tester.tap(find.text(d));
    }
    await tester.pump();
  }

  group('TicketInputScreen — chrome', () {
    testWidgets('renders AppBar with "Add ticket"', (tester) async {
      await pumpScreen(tester);
      expect(find.byType(AppBar), findsOneWidget);
      expect(find.text('Add ticket'), findsOneWidget);
    });

    testWidgets('renders a back button in the AppBar', (tester) async {
      await pumpScreen(tester);
      expect(find.byIcon(Icons.arrow_back), findsOneWidget);
    });

    testWidgets('renders the ticket form (display + keypad + save)',
        (tester) async {
      await pumpScreen(tester);
      expect(find.text('_ _ _ _ _ _'), findsOneWidget);
      expect(find.text('Save ticket'), findsOneWidget);
      expect(find.text('0'), findsOneWidget);
      expect(find.text('9'), findsOneWidget);
      expect(find.text('⌫'), findsOneWidget);
    });
  });

  group('TicketInputScreen — validation gate', () {
    testWidgets('tapping save with fewer than 6 digits does nothing',
        (tester) async {
      await pumpScreen(tester);
      await tester.tap(find.text('1'));
      await tester.pump();
      await tester.tap(find.text('Save ticket'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 200));
      verifyNever(() => repo.save(any()));
      // Still on the input screen (no SnackBar, no nav).
      expect(find.text('Add ticket'), findsOneWidget);
      expect(find.text('Ticket saved'), findsNothing);
    });

    testWidgets('tapping save with exactly 6 digits invokes repository',
        (tester) async {
      await pumpScreen(tester);
      await typeAll(tester, ['1', '2', '3', '4', '5', '6']);
      await tester.tap(find.text('Save ticket'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));
      verify(() => repo.save(any())).called(1);
    });
  });

  group('TicketInputScreen — save flow', () {
    testWidgets('save calls repository with the entered ticket numbers',
        (tester) async {
      await pumpScreen(tester);
      await typeAll(tester, ['7', '5', '3', '9', '1', '0']);
      await tester.tap(find.text('Save ticket'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));
      final captured = verify(() => repo.save(captureAny())).captured;
      expect((captured.single as Ticket).numbers, '753910');
    });

    testWidgets('save shows SnackBar with "Ticket saved"', (tester) async {
      await pumpScreen(tester);
      await typeAll(tester, ['1', '2', '3', '4', '5', '6']);
      await tester.tap(find.text('Save ticket'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));
      expect(find.text('Ticket saved'), findsOneWidget);
    });

    testWidgets('save navigates back to home after success', (tester) async {
      await pumpScreen(tester);
      await typeAll(tester, ['1', '2', '3', '4', '5', '6']);
      await tester.tap(find.text('Save ticket'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));
      expect(find.text('HOME'), findsOneWidget);
    });

    testWidgets('failed save does not navigate or show SnackBar',
        (tester) async {
      when(() => repo.save(any())).thenThrow(Exception('boom'));
      await pumpScreen(tester);
      await typeAll(tester, ['1', '2', '3', '4', '5', '6']);
      await tester.tap(find.text('Save ticket'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));
      expect(find.text('Ticket saved'), findsNothing);
      expect(find.text('HOME'), findsNothing);
      expect(find.text('Add ticket'), findsOneWidget);
    });
  });

  group('TicketInputScreen — back button', () {
    testWidgets('back button navigates to home', (tester) async {
      await pumpScreen(tester);
      await tester.tap(find.byIcon(Icons.arrow_back));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));
      expect(find.text('HOME'), findsOneWidget);
    });
  });
}
