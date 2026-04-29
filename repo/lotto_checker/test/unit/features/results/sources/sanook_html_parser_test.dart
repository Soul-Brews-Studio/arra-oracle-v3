import 'package:flutter_test/flutter_test.dart';
import 'package:lotto_checker/features/results/data/sources/lottery_data_source.dart';
import 'package:lotto_checker/features/results/data/sources/sanook_html_parser.dart';
import 'package:lotto_checker/shared/models/prize.dart';

const String _articleHtml = '''
<article class="lotto-check__article">
  <time datetime="2026-04-16 13:00" class="lotto-check__time">16/04/2026</time>
  <p class="lotto-check__para lotto-check__para--half">
    <small class="lotto-check__item">รางวัลที่ 1</small>
    <b class="lotto__number lotto__number--three">309612</b>
  </p>
  <p class="lotto-check__para">
    <small class="lotto-check__item">เลขหน้า 3 ตัว</small>
    <b class="lotto__number lotto__number--three">355</b>
    <b class="lotto__number lotto__number--three">108</b>
  </p>
  <p class="lotto-check__para">
    <small class="lotto-check__item">เลขท้าย 3 ตัว</small>
    <b class="lotto__number lotto__number--three">868</b>
    <b class="lotto__number lotto__number--three">424</b>
  </p>
  <p class="lotto-check__para lotto-check__para--half">
    <small class="lotto-check__item">เลขท้าย 2 ตัว</small>
    <b class="lotto__number lotto__number--three">77</b>
  </p>
</article>
''';

const String _twoArticlesHtml = '''
<div>
$_articleHtml
<article class="lotto-check__article">
  <time datetime="2026-04-01 12:59" class="lotto-check__time">01/04/2026</time>
  <p class="lotto-check__para lotto-check__para--half">
    <small class="lotto-check__item">รางวัลที่ 1</small>
    <b class="lotto__number lotto__number--three">292514</b>
  </p>
</article>
</div>
''';

void main() {
  group('parseSanookHtml — happy path', () {
    test('parses the 4 supported tiers from the article HTML', () {
      final draw = parseSanookHtml(_articleHtml, DateTime.utc(2026, 4, 16));
      expect(draw.winningNumbers.keys.toSet(), {
        PrizeTier.first,
        PrizeTier.threeDigitFront,
        PrizeTier.threeDigitBack,
        PrizeTier.twoDigitBack,
      });
    });

    test('first prize is the single 6-digit number', () {
      final draw = parseSanookHtml(_articleHtml, DateTime.utc(2026, 4, 16));
      expect(draw.winningNumbers[PrizeTier.first], ['309612']);
    });

    test('threeDigitFront has 2 winners', () {
      final draw = parseSanookHtml(_articleHtml, DateTime.utc(2026, 4, 16));
      expect(draw.winningNumbers[PrizeTier.threeDigitFront], ['355', '108']);
    });

    test('threeDigitBack has 2 winners', () {
      final draw = parseSanookHtml(_articleHtml, DateTime.utc(2026, 4, 16));
      expect(draw.winningNumbers[PrizeTier.threeDigitBack], ['868', '424']);
    });

    test('twoDigitBack is the single 2-digit number', () {
      final draw = parseSanookHtml(_articleHtml, DateTime.utc(2026, 4, 16));
      expect(draw.winningNumbers[PrizeTier.twoDigitBack], ['77']);
    });

    test('tiers 2-5 + firstNear are intentionally absent', () {
      final draw = parseSanookHtml(_articleHtml, DateTime.utc(2026, 4, 16));
      for (final t in [
        PrizeTier.firstNear,
        PrizeTier.second,
        PrizeTier.third,
        PrizeTier.fourth,
        PrizeTier.fifth,
      ]) {
        expect(
          draw.winningNumbers.containsKey(t),
          isFalse,
          reason: 'sanook home page does not expose $t',
        );
      }
    });

    test('prizes map carries the first winner per tier', () {
      final draw = parseSanookHtml(_articleHtml, DateTime.utc(2026, 4, 16));
      expect(draw.prizes['first'], '309612');
      expect(draw.prizes['threeDigitFront'], '355');
      expect(draw.prizes['threeDigitBack'], '868');
      expect(draw.prizes['twoDigitBack'], '77');
    });

    test('drawDate is forwarded onto the returned Draw', () {
      final date = DateTime.utc(2026, 5, 1);
      final draw = parseSanookHtml(_articleHtml, date);
      expect(draw.drawDate, date);
    });

    test('only the FIRST article is parsed (older draws ignored)', () {
      final draw =
          parseSanookHtml(_twoArticlesHtml, DateTime.utc(2026, 4, 16));
      expect(draw.winningNumbers[PrizeTier.first], ['309612']);
      expect(draw.winningNumbers[PrizeTier.first], isNot(contains('292514')));
    });
  });

  group('parseSanookHtml — degraded input', () {
    test('throws ParseException on empty string', () {
      expect(
        () => parseSanookHtml('', DateTime.utc(2026, 4, 16)),
        throwsA(isA<ParseException>()),
      );
    });

    test('throws ParseException on whitespace-only string', () {
      expect(
        () => parseSanookHtml('   \n\t  ', DateTime.utc(2026, 4, 16)),
        throwsA(isA<ParseException>()),
      );
    });

    test('throws ParseException when no article element exists', () {
      expect(
        () => parseSanookHtml(
          '<html><body><p>nothing</p></body></html>',
          DateTime.utc(2026, 4, 16),
        ),
        throwsA(isA<ParseException>()),
      );
    });

    test('throws ParseException when article has no first prize', () {
      const html = '<article class="lotto-check__article">'
          '<p class="lotto-check__para">'
          '<small class="lotto-check__item">เลขท้าย 2 ตัว</small>'
          '<b class="lotto__number">12</b>'
          '</p>'
          '</article>';
      expect(
        () => parseSanookHtml(html, DateTime.utc(2026, 4, 16)),
        throwsA(isA<ParseException>()),
      );
    });

    test('skips paragraphs whose label is unknown', () {
      const html = '<article class="lotto-check__article">'
          '<p class="lotto-check__para">'
          '<small class="lotto-check__item">รางวัลที่ 1</small>'
          '<b class="lotto__number">111111</b>'
          '</p>'
          '<p class="lotto-check__para">'
          '<small class="lotto-check__item">รางวัลพิเศษ</small>'
          '<b class="lotto__number">999</b>'
          '</p>'
          '</article>';
      final draw = parseSanookHtml(html, DateTime.utc(2026, 4, 16));
      expect(draw.winningNumbers[PrizeTier.first], ['111111']);
      expect(draw.winningNumbers.length, 1);
    });

    test('skips paragraphs that have no number nodes', () {
      const html = '<article class="lotto-check__article">'
          '<p class="lotto-check__para">'
          '<small class="lotto-check__item">รางวัลที่ 1</small>'
          '<b class="lotto__number">222222</b>'
          '</p>'
          '<p class="lotto-check__para">'
          '<small class="lotto-check__item">เลขท้าย 2 ตัว</small>'
          '</p>'
          '</article>';
      final draw = parseSanookHtml(html, DateTime.utc(2026, 4, 16));
      expect(draw.winningNumbers[PrizeTier.first], ['222222']);
      expect(draw.winningNumbers.containsKey(PrizeTier.twoDigitBack), isFalse);
    });
  });

  group('parseSanookHtml — locale + tolerance', () {
    test('tolerates extra whitespace and newlines around digits', () {
      const html = '<article class="lotto-check__article">\n'
          '  <p class="lotto-check__para">\n'
          '    <small class="lotto-check__item">รางวัลที่ 1</small>\n'
          '    <b class="lotto__number lotto__number--three">\n  246810\n</b>\n'
          '  </p>\n'
          '</article>';
      final draw = parseSanookHtml(html, DateTime.utc(2026, 4, 16));
      expect(draw.winningNumbers[PrizeTier.first], ['246810']);
    });

    test('tolerates BOM at the start of the document', () {
      const html = '\uFEFF$_articleHtml';
      final draw = parseSanookHtml(html, DateTime.utc(2026, 4, 16));
      expect(draw.winningNumbers[PrizeTier.first], ['309612']);
    });

    test('preserves leading zeros in the parsed digits', () {
      const html = '<article class="lotto-check__article">'
          '<p class="lotto-check__para">'
          '<small class="lotto-check__item">รางวัลที่ 1</small>'
          '<b class="lotto__number">000123</b>'
          '</p>'
          '<p class="lotto-check__para">'
          '<small class="lotto-check__item">เลขท้าย 2 ตัว</small>'
          '<b class="lotto__number">07</b>'
          '</p>'
          '</article>';
      final draw = parseSanookHtml(html, DateTime.utc(2026, 4, 16));
      expect(draw.winningNumbers[PrizeTier.first], ['000123']);
      expect(draw.winningNumbers[PrizeTier.twoDigitBack], ['07']);
    });

    test('matches lotto__number regardless of trailing modifier classes', () {
      const html = '<article class="lotto-check__article">'
          '<p class="lotto-check__para">'
          '<small class="lotto-check__item">รางวัลที่ 1</small>'
          '<b class="lotto__number lotto__number--big foo">555555</b>'
          '</p>'
          '</article>';
      final draw = parseSanookHtml(html, DateTime.utc(2026, 4, 16));
      expect(draw.winningNumbers[PrizeTier.first], ['555555']);
    });
  });

}
