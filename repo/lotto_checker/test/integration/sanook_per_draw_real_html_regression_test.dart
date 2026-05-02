import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:lotto_checker/features/results/data/sources/sanook_per_draw_html_parser.dart';
import 'package:lotto_checker/shared/models/prize.dart';

/// Loads the captured real Sanook per-draw page and asserts the parser
/// extracts all 9 tiers with the correct numbers from the 2026-04-16 draw.
///
/// This is the canary for Sanook per-draw page layout changes.
/// Fixture: test/fixtures/sanook_html/per_draw_16042569.html
void main() {
  group('sanook per-draw real HTML regression — 2026-04-16 (2569 BE)', () {
    late final String html;

    setUpAll(() {
      final file = File('test/fixtures/sanook_html/per_draw_16042569.html');
      expect(
        file.existsSync(),
        isTrue,
        reason: 'fixture must exist at ${file.path}',
      );
      html = file.readAsStringSync();
    });

    test('parser returns a Draw without throwing', () {
      final draw = parseSanookPerDrawHtml(html, DateTime.utc(2026, 4, 16));
      expect(draw, isNotNull);
    });

    test('all 9 tiers are populated', () {
      final draw = parseSanookPerDrawHtml(html, DateTime.utc(2026, 4, 16));
      expect(draw.winningNumbers.keys.toSet(), {
        PrizeTier.first,
        PrizeTier.firstNear,
        PrizeTier.second,
        PrizeTier.third,
        PrizeTier.fourth,
        PrizeTier.fifth,
        PrizeTier.threeDigitFront,
        PrizeTier.threeDigitBack,
        PrizeTier.twoDigitBack,
      });
    });

    test('first prize is 309612', () {
      final draw = parseSanookPerDrawHtml(html, DateTime.utc(2026, 4, 16));
      expect(draw.winningNumbers[PrizeTier.first], ['309612']);
    });

    test('firstNear has exactly 2 winners', () {
      final draw = parseSanookPerDrawHtml(html, DateTime.utc(2026, 4, 16));
      expect(draw.winningNumbers[PrizeTier.firstNear]!.length, 2);
    });

    test('firstNear are 309611 and 309613', () {
      final draw = parseSanookPerDrawHtml(html, DateTime.utc(2026, 4, 16));
      expect(
        draw.winningNumbers[PrizeTier.firstNear],
        containsAll(['309611', '309613']),
      );
    });

    test('second prize has exactly 5 winners', () {
      final draw = parseSanookPerDrawHtml(html, DateTime.utc(2026, 4, 16));
      expect(draw.winningNumbers[PrizeTier.second]!.length, 5);
    });

    test('third prize has exactly 10 winners', () {
      final draw = parseSanookPerDrawHtml(html, DateTime.utc(2026, 4, 16));
      expect(draw.winningNumbers[PrizeTier.third]!.length, 10);
    });

    test('fourth prize has exactly 50 winners', () {
      final draw = parseSanookPerDrawHtml(html, DateTime.utc(2026, 4, 16));
      expect(draw.winningNumbers[PrizeTier.fourth]!.length, 50);
    });

    test('fifth prize has exactly 100 winners', () {
      final draw = parseSanookPerDrawHtml(html, DateTime.utc(2026, 4, 16));
      expect(draw.winningNumbers[PrizeTier.fifth]!.length, 100);
    });

    test('threeDigitFront has exactly 2 three-digit winners', () {
      final draw = parseSanookPerDrawHtml(html, DateTime.utc(2026, 4, 16));
      final v = draw.winningNumbers[PrizeTier.threeDigitFront]!;
      expect(v.length, 2);
      expect(v.every((n) => RegExp(r'^\d{3}$').hasMatch(n)), isTrue);
    });

    test('threeDigitBack has exactly 2 three-digit winners', () {
      final draw = parseSanookPerDrawHtml(html, DateTime.utc(2026, 4, 16));
      final v = draw.winningNumbers[PrizeTier.threeDigitBack]!;
      expect(v.length, 2);
      expect(v.every((n) => RegExp(r'^\d{3}$').hasMatch(n)), isTrue);
    });

    test('twoDigitBack has exactly 1 two-digit winner', () {
      final draw = parseSanookPerDrawHtml(html, DateTime.utc(2026, 4, 16));
      final v = draw.winningNumbers[PrizeTier.twoDigitBack]!;
      expect(v.length, 1);
      expect(v.first, matches(RegExp(r'^\d{2}$')));
    });

    test('all winners are digit-only strings', () {
      final draw = parseSanookPerDrawHtml(html, DateTime.utc(2026, 4, 16));
      for (final entry in draw.winningNumbers.entries) {
        for (final n in entry.value) {
          expect(
            n,
            matches(RegExp(r'^\d+$')),
            reason: 'tier ${entry.key} has non-digit winner "$n"',
          );
        }
      }
    });

    test('parseSanookPerDrawDate reads 2026-04-16 from datePublished', () {
      final date = parseSanookPerDrawDate(html);
      expect(date, DateTime(2026, 4, 16));
    });
  });
}
