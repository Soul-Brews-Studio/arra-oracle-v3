import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:lotto_checker/features/home/presentation/widgets/next_draw_banner.dart';

import '../../../helpers/pump_app.dart';

void main() {
  setUpAll(() => initializeDateFormatting('th'));

  group('nextDrawDate', () {
    test('day < 16 returns the 16th of the same month', () {
      final next = nextDrawDate(DateTime(2026, 5, 6, 14, 30));
      expect(next, DateTime(2026, 5, 16));
    });

    test('day == 1 returns today (the draw day)', () {
      final next = nextDrawDate(DateTime(2026, 5, 1, 9));
      expect(next, DateTime(2026, 5, 1));
    });

    test('day == 16 returns today (the draw day)', () {
      final next = nextDrawDate(DateTime(2026, 5, 16, 18));
      expect(next, DateTime(2026, 5, 16));
    });

    test('day > 16 returns the 1st of the next month', () {
      final next = nextDrawDate(DateTime(2026, 5, 20));
      expect(next, DateTime(2026, 6, 1));
    });

    test('day > 16 in December rolls into next year', () {
      final next = nextDrawDate(DateTime(2026, 12, 25));
      expect(next, DateTime(2027, 1, 1));
    });
  });

  group('NextDrawBanner', () {
    testWidgets('shows ออกผลครั้งถัดไป and a countdown label', (tester) async {
      await tester.pumpApp(
        Scaffold(
          body: NextDrawBanner(clock: () => DateTime(2026, 5, 6, 12)),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('ออกผลครั้งถัดไป'), findsOneWidget);
      // 6 May 12:00 → 16 May 00:00 == 9 days, 12 hours, 0 minutes.
      expect(find.textContaining('9 วัน'), findsOneWidget);
      expect(find.textContaining('12 ชม.'), findsOneWidget);
    });

    testWidgets('formats the next draw date in Thai', (tester) async {
      await tester.pumpApp(
        Scaffold(
          body: NextDrawBanner(clock: () => DateTime(2026, 5, 20, 10)),
        ),
      );
      await tester.pumpAndSettle();

      // Next draw: 1 June 2026 → "1 มิถุนายน 2569" (Thai BE locale).
      expect(find.textContaining('มิถุนายน'), findsOneWidget);
    });
  });
}
