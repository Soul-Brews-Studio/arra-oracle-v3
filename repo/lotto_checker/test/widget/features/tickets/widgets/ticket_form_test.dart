import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lotto_checker/features/tickets/data/providers.dart';
import 'package:lotto_checker/features/tickets/data/ticket_repository.dart';
import 'package:lotto_checker/features/tickets/presentation/widgets/ticket_form.dart';
import 'package:lotto_checker/shared/models/ticket.dart';
import 'package:mocktail/mocktail.dart';

import '../../../../fixtures/tickets.dart';
import '../../../../helpers/pump_app.dart';

class _MockTicketRepository extends Mock implements TicketRepository {}

void main() {
  setUpAll(() {
    registerFallbackValue(fixtureTicket());
  });

  late _MockTicketRepository repo;

  setUp(() {
    repo = _MockTicketRepository();
    when(() => repo.save(any())).thenAnswer((_) async {});
  });

  Future<void> pumpForm(
    WidgetTester tester, {
    VoidCallback? onSaved,
  }) async {
    // Use a tall viewport so every control is hit-testable, and wrap the
    // form in Scaffold + SingleChildScrollView (mirroring how the real
    // [TicketInputScreen] hosts it). Without a scroll-view ancestor the
    // keypad's [LayoutBuilder] fights the Column for vertical space.
    tester.view.physicalSize = const Size(800, 1600);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpApp(
      Scaffold(
        body: SingleChildScrollView(
          child: TicketForm(onSaved: onSaved ?? () {}),
        ),
      ),
      overrides: [ticketRepositoryProvider.overrideWithValue(repo)],
    );
  }

  Future<void> typeAll(WidgetTester tester, List<String> digits) async {
    for (final d in digits) {
      await tester.tap(find.text(d));
    }
    await tester.pump();
  }

  group('TicketForm — initial render', () {
    testWidgets('display starts as 6 underscores', (tester) async {
      await pumpForm(tester);
      expect(find.text('_ _ _ _ _ _'), findsOneWidget);
    });

    testWidgets('tapping save with no digits does not invoke repository',
        (tester) async {
      var saved = false;
      await pumpForm(tester, onSaved: () => saved = true);
      await tester.tap(find.text('Save ticket'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));
      verifyNever(() => repo.save(any()));
      expect(saved, isFalse);
    });

    testWidgets('renders the keypad and note field', (tester) async {
      await pumpForm(tester);
      expect(find.text('0'), findsOneWidget);
      expect(find.text('⌫'), findsOneWidget);
      expect(find.byType(TextField), findsOneWidget);
    });
  });

  group('TicketForm — input', () {
    testWidgets('keypad input updates the display', (tester) async {
      await pumpForm(tester);
      await typeAll(tester, ['1', '2', '3']);
      expect(find.text('1 2 3 _ _ _'), findsOneWidget);
    });

    testWidgets('backspace removes last digit', (tester) async {
      await pumpForm(tester);
      await typeAll(tester, ['1', '2']);
      await tester.tap(find.text('⌫'));
      await tester.pump();
      expect(find.text('1 _ _ _ _ _'), findsOneWidget);
    });

    testWidgets('typing more than 6 digits is ignored', (tester) async {
      await pumpForm(tester);
      await typeAll(tester, ['1', '2', '3', '4', '5', '6', '7', '8']);
      expect(find.text('1 2 3 4 5 6'), findsOneWidget);
    });
  });

  group('TicketForm — validation', () {
    testWidgets('save remains disabled until 6 digits entered',
        (tester) async {
      await pumpForm(tester);
      // Fewer than 6 digits → tap save is a no-op.
      for (var i = 0; i < 5; i++) {
        await tester.tap(find.text('1'));
        await tester.pump();
      }
      await tester.tap(find.text('Save ticket'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));
      verifyNever(() => repo.save(any()));

      // Entering the 6th digit unlocks the save action.
      await tester.tap(find.text('1'));
      await tester.pump();
      await tester.tap(find.text('Save ticket'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));
      verify(() => repo.save(any())).called(1);
    });

    testWidgets('backspace below 6 re-disables save', (tester) async {
      await pumpForm(tester);
      await typeAll(tester, ['1', '2', '3', '4', '5', '6']);
      // Drop a digit to fall below the gate.
      await tester.tap(find.text('⌫'));
      await tester.pump();
      await tester.tap(find.text('Save ticket'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));
      verifyNever(() => repo.save(any()));
    });
  });

  group('TicketForm — save flow', () {
    testWidgets('save calls repository once with the entered numbers',
        (tester) async {
      await pumpForm(tester);
      await typeAll(tester, ['9', '8', '7', '6', '5', '4']);
      await tester.tap(find.text('Save ticket'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));
      final captured = verify(() => repo.save(captureAny())).captured;
      expect((captured.single as Ticket).numbers, '987654');
    });

    testWidgets('save invokes onSaved on success', (tester) async {
      var saved = false;
      await pumpForm(tester, onSaved: () => saved = true);
      await typeAll(tester, ['1', '2', '3', '4', '5', '6']);
      await tester.tap(find.text('Save ticket'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));
      expect(saved, isTrue);
    });

    testWidgets('save resets numbers on success', (tester) async {
      await pumpForm(tester);
      await typeAll(tester, ['1', '2', '3', '4', '5', '6']);
      await tester.tap(find.text('Save ticket'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));
      expect(find.text('_ _ _ _ _ _'), findsOneWidget);
    });

    testWidgets('repository failure surfaces as error text + does not call onSaved',
        (tester) async {
      when(() => repo.save(any())).thenThrow(Exception('disk full'));
      var saved = false;
      await pumpForm(tester, onSaved: () => saved = true);
      await typeAll(tester, ['1', '2', '3', '4', '5', '6']);
      await tester.tap(find.text('Save ticket'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));
      expect(find.textContaining('disk full'), findsOneWidget);
      expect(saved, isFalse);
    });

    testWidgets('note text is trimmed and stored on save', (tester) async {
      await pumpForm(tester);
      await typeAll(tester, ['1', '2', '3', '4', '5', '6']);
      await tester.enterText(find.byType(TextField), '  birthday  ');
      await tester.pump();
      await tester.tap(find.text('Save ticket'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));
      final captured = verify(() => repo.save(captureAny())).captured;
      expect((captured.single as Ticket).note, 'birthday');
    });

    testWidgets('blank note is stored as null', (tester) async {
      await pumpForm(tester);
      await typeAll(tester, ['1', '2', '3', '4', '5', '6']);
      await tester.tap(find.text('Save ticket'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));
      final captured = verify(() => repo.save(captureAny())).captured;
      expect((captured.single as Ticket).note, isNull);
    });
  });
}
