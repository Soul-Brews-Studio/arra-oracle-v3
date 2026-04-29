import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:lotto_checker/features/results/data/sources/sanook_html_parser.dart';
import 'package:lotto_checker/shared/models/prize.dart';

/// Loads the captured real sanook HTML and asserts the parser still finds
/// the four supported tiers. This is the canary that catches sanook layout
/// changes — if the home page markup drifts, this fails before the live
/// data source does.
void main() {
  group('sanook real HTML regression — 2026-04-16 capture', () {
    late final String html;

    setUpAll(() {
      final file = File('test/fixtures/sanook_html/2026-04-16.html');
      expect(
        file.existsSync(),
        isTrue,
        reason: 'fixture file must exist at ${file.path}',
      );
      html = file.readAsStringSync();
    });

    test('parser returns a Draw without throwing', () {
      final draw = parseSanookHtml(html, DateTime.utc(2026, 4, 16));
      expect(draw, isNotNull);
    });

    test('first prize is exactly 6 digits', () {
      final draw = parseSanookHtml(html, DateTime.utc(2026, 4, 16));
      final first = draw.winningNumbers[PrizeTier.first];
      expect(first, isNotNull);
      expect(first!.length, 1);
      expect(first.first, matches(RegExp(r'^\d{6}$')));
    });

    test('exactly the 4 supported tiers are populated', () {
      final draw = parseSanookHtml(html, DateTime.utc(2026, 4, 16));
      final populated = draw.winningNumbers.entries
          .where((e) => e.value.isNotEmpty)
          .map((e) => e.key)
          .toSet();
      expect(populated, {
        PrizeTier.first,
        PrizeTier.threeDigitFront,
        PrizeTier.threeDigitBack,
        PrizeTier.twoDigitBack,
      });
    });

    test('unsupported tiers are absent (sanook home does not expose them)',
        () {
      final draw = parseSanookHtml(html, DateTime.utc(2026, 4, 16));
      for (final t in [
        PrizeTier.firstNear,
        PrizeTier.second,
        PrizeTier.third,
        PrizeTier.fourth,
        PrizeTier.fifth,
      ]) {
        expect(draw.winningNumbers.containsKey(t), isFalse, reason: '$t');
      }
    });

    test('threeDigitFront has 2 entries each 3 digits', () {
      final draw = parseSanookHtml(html, DateTime.utc(2026, 4, 16));
      final v = draw.winningNumbers[PrizeTier.threeDigitFront]!;
      expect(v.length, 2);
      expect(v.every((n) => RegExp(r'^\d{3}$').hasMatch(n)), isTrue);
    });

    test('threeDigitBack has 2 entries each 3 digits', () {
      final draw = parseSanookHtml(html, DateTime.utc(2026, 4, 16));
      final v = draw.winningNumbers[PrizeTier.threeDigitBack]!;
      expect(v.length, 2);
      expect(v.every((n) => RegExp(r'^\d{3}$').hasMatch(n)), isTrue);
    });

    test('twoDigitBack is exactly one 2-digit entry', () {
      final draw = parseSanookHtml(html, DateTime.utc(2026, 4, 16));
      final v = draw.winningNumbers[PrizeTier.twoDigitBack]!;
      expect(v.length, 1);
      expect(v.first, matches(RegExp(r'^\d{2}$')));
    });

    test('parseSanookLatestDate matches the captured 2026-04-16 draw', () {
      final date = parseSanookLatestDate(html);
      expect(date, DateTime(2026, 4, 16));
    });

    test('prizes map carries first winner per populated tier', () {
      final draw = parseSanookHtml(html, DateTime.utc(2026, 4, 16));
      expect(draw.prizes['first'], matches(RegExp(r'^\d{6}$')));
      expect(draw.prizes['threeDigitFront'], matches(RegExp(r'^\d{3}$')));
      expect(draw.prizes['threeDigitBack'], matches(RegExp(r'^\d{3}$')));
      expect(draw.prizes['twoDigitBack'], matches(RegExp(r'^\d{2}$')));
    });
  });
}
