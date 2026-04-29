import 'package:flutter_test/flutter_test.dart';
import 'package:lotto_checker/features/tickets/presentation/widgets/numeric_keypad.dart';

import '../../../../helpers/pump_app.dart';

void main() {
  group('NumericKeypad', () {
    testWidgets('renders all 10 digits + backspace label', (tester) async {
      await tester.pumpApp(
        NumericKeypad(onDigit: (_) {}, onBackspace: () {}),
      );
      for (final d in const ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']) {
        expect(find.text(d), findsOneWidget, reason: 'digit $d');
      }
      expect(find.text('⌫'), findsOneWidget);
    });

    testWidgets('tapping a digit invokes onDigit with that digit',
        (tester) async {
      final taps = <String>[];
      await tester.pumpApp(
        NumericKeypad(onDigit: taps.add, onBackspace: () {}),
      );
      await tester.tap(find.text('5'));
      await tester.tap(find.text('0'));
      expect(taps, ['5', '0']);
    });

    testWidgets('every digit 0..9 fires onDigit once each', (tester) async {
      final taps = <String>[];
      await tester.pumpApp(
        NumericKeypad(onDigit: taps.add, onBackspace: () {}),
      );
      for (final d in const ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']) {
        await tester.tap(find.text(d));
      }
      expect(taps, ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']);
    });

    testWidgets('tapping ⌫ invokes onBackspace each press', (tester) async {
      var count = 0;
      await tester.pumpApp(
        NumericKeypad(onDigit: (_) {}, onBackspace: () => count++),
      );
      await tester.tap(find.text('⌫'));
      await tester.tap(find.text('⌫'));
      expect(count, 2);
    });

    testWidgets('digit and backspace handlers are independent',
        (tester) async {
      final digits = <String>[];
      var backs = 0;
      await tester.pumpApp(
        NumericKeypad(onDigit: digits.add, onBackspace: () => backs++),
      );
      await tester.tap(find.text('7'));
      await tester.tap(find.text('⌫'));
      expect(digits, ['7']);
      expect(backs, 1);
    });

    testWidgets('multiple digits in sequence preserve order', (tester) async {
      final taps = <String>[];
      await tester.pumpApp(
        NumericKeypad(onDigit: taps.add, onBackspace: () {}),
      );
      await tester.tap(find.text('3'));
      await tester.tap(find.text('1'));
      await tester.tap(find.text('4'));
      await tester.tap(find.text('1'));
      await tester.tap(find.text('5'));
      expect(taps.join(), '31415');
    });
  });
}
