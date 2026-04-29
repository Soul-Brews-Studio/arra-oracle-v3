import 'package:flutter_test/flutter_test.dart';
import 'package:lotto_checker/features/results/data/sources/glo_html_parser.dart';
import 'package:lotto_checker/features/results/data/sources/lottery_data_source.dart';
import 'package:lotto_checker/shared/models/prize.dart';

import '../../../../fixtures/draws.dart';

void main() {
  group('parseGloHtml — happy path', () {
    test('parses all 9 tiers from the fixture HTML', () {
      final draw = parseGloHtml(fixtureGloHtml, DateTime.utc(2026, 4, 16));
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

    test('first prize is exactly one number', () {
      final draw = parseGloHtml(fixtureGloHtml, DateTime.utc(2026, 4, 16));
      expect(draw.winningNumbers[PrizeTier.first], ['123456']);
    });

    test('firstNear has two neighbour numbers', () {
      final draw = parseGloHtml(fixtureGloHtml, DateTime.utc(2026, 4, 16));
      expect(draw.winningNumbers[PrizeTier.firstNear], ['123455', '123457']);
    });

    test('second has 5 winning numbers', () {
      final draw = parseGloHtml(fixtureGloHtml, DateTime.utc(2026, 4, 16));
      expect(draw.winningNumbers[PrizeTier.second]!.length, 5);
    });

    test('third has 10 winning numbers', () {
      final draw = parseGloHtml(fixtureGloHtml, DateTime.utc(2026, 4, 16));
      expect(draw.winningNumbers[PrizeTier.third]!.length, 10);
    });

    test('two-digit back parses a 2-digit number', () {
      final draw = parseGloHtml(fixtureGloHtml, DateTime.utc(2026, 4, 16));
      expect(draw.winningNumbers[PrizeTier.twoDigitBack], ['56']);
    });

    test('prizes map carries the first winner per tier', () {
      final draw = parseGloHtml(fixtureGloHtml, DateTime.utc(2026, 4, 16));
      expect(draw.prizes['first'], '123456');
      expect(draw.prizes['twoDigitBack'], '56');
      expect(draw.prizes['threeDigitFront'], '123');
    });

    test('drawDate is forwarded onto the returned Draw', () {
      final date = DateTime.utc(2026, 5, 1);
      final draw = parseGloHtml(fixtureGloHtml, date);
      expect(draw.drawDate, date);
    });
  });

  group('parseGloHtml — degraded input', () {
    test('throws ParseException on empty string', () {
      expect(
        () => parseGloHtml('', DateTime.utc(2026, 4, 16)),
        throwsA(isA<ParseException>()),
      );
    });

    test('throws ParseException on whitespace-only string', () {
      expect(
        () => parseGloHtml('   \n\t  ', DateTime.utc(2026, 4, 16)),
        throwsA(isA<ParseException>()),
      );
    });

    test('throws ParseException when first prize is missing', () {
      const html = '<html><body>'
          '<section data-prize="second"><span class="lotto-number">123</span></section>'
          '</body></html>';
      expect(
        () => parseGloHtml(html, DateTime.utc(2026, 4, 16)),
        throwsA(isA<ParseException>()),
      );
    });

    test('throws ParseException when html has no prize sections at all', () {
      expect(
        () => parseGloHtml(
          '<html><body><p>nothing</p></body></html>',
          DateTime.utc(2026, 4, 16),
        ),
        throwsA(isA<ParseException>()),
      );
    });

    test('handles missing tiers gracefully — only first present is fine', () {
      final draw =
          parseGloHtml(fixtureGloHtmlFirstOnly, DateTime.utc(2026, 4, 16));
      expect(draw.winningNumbers[PrizeTier.first], ['654321']);
      expect(draw.winningNumbers.containsKey(PrizeTier.second), isFalse);
      expect(draw.winningNumbers.containsKey(PrizeTier.twoDigitBack), isFalse);
    });

    test('ignores empty section (no lotto-number children)', () {
      const html = '<html><body>'
          '<section data-prize="first"><span class="lotto-number">123456</span></section>'
          '<section data-prize="second"></section>'
          '</body></html>';
      final draw = parseGloHtml(html, DateTime.utc(2026, 4, 16));
      expect(draw.winningNumbers[PrizeTier.first], ['123456']);
      expect(draw.winningNumbers.containsKey(PrizeTier.second), isFalse);
    });
  });

  group('parseGloHtml — locale + tolerance', () {
    test('tolerates surrounding Thai labels in the section', () {
      const html = '<html><body>'
          '<section data-prize="first">'
          '<h2>รางวัลที่ 1</h2>'
          '<span class="lotto-number">  987654  </span>'
          '</section>'
          '</body></html>';
      final draw = parseGloHtml(html, DateTime.utc(2026, 4, 16));
      expect(draw.winningNumbers[PrizeTier.first], ['987654']);
    });

    test('tolerates extra whitespace and newlines around numbers', () {
      const html = '<html><body>'
          '<section data-prize="first">\n'
          '  <span class="lotto-number">\n    246810\n  </span>\n'
          '</section>'
          '</body></html>';
      final draw = parseGloHtml(html, DateTime.utc(2026, 4, 16));
      expect(draw.winningNumbers[PrizeTier.first], ['246810']);
    });

    test('preserves leading zeros', () {
      const html = '<html><body>'
          '<section data-prize="first">'
          '<span class="lotto-number">000123</span>'
          '</section>'
          '<section data-prize="twoDigitBack">'
          '<span class="lotto-number">07</span>'
          '</section>'
          '</body></html>';
      final draw = parseGloHtml(html, DateTime.utc(2026, 4, 16));
      expect(draw.winningNumbers[PrizeTier.first], ['000123']);
      expect(draw.winningNumbers[PrizeTier.twoDigitBack], ['07']);
    });

    test('only matches lotto-number class, ignores foreign spans', () {
      const html = '<html><body>'
          '<section data-prize="first">'
          '<span class="lotto-number">111111</span>'
          '<span class="other-number">999999</span>'
          '</section>'
          '</body></html>';
      final draw = parseGloHtml(html, DateTime.utc(2026, 4, 16));
      expect(draw.winningNumbers[PrizeTier.first], ['111111']);
    });
  });
}
