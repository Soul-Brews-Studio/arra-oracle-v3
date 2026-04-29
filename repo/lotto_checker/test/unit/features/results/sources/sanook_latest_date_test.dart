import 'package:flutter_test/flutter_test.dart';
import 'package:lotto_checker/features/results/data/sources/sanook_html_parser.dart';

const String _oneArticleHtml = '''
<article class="lotto-check__article">
  <time datetime="2026-04-16 13:00" class="lotto-check__time">16/04/2026</time>
  <p class="lotto-check__para">
    <small class="lotto-check__item">รางวัลที่ 1</small>
    <b class="lotto__number">309612</b>
  </p>
</article>
''';

const String _twoArticlesHtml = '''
<article class="lotto-check__article">
  <time datetime="2026-04-16 13:00" class="lotto-check__time">16/04/2026</time>
  <p class="lotto-check__para">
    <small class="lotto-check__item">รางวัลที่ 1</small>
    <b class="lotto__number">309612</b>
  </p>
</article>
<article class="lotto-check__article">
  <time datetime="2026-04-01 12:59" class="lotto-check__time">01/04/2026</time>
  <p class="lotto-check__para">
    <small class="lotto-check__item">รางวัลที่ 1</small>
    <b class="lotto__number">292514</b>
  </p>
</article>
''';

void main() {
  group('parseSanookLatestDate', () {
    test('returns the date of the first article when present', () {
      final date = parseSanookLatestDate(_oneArticleHtml);
      expect(date, isNotNull);
      expect(date!.year, 2026);
      expect(date.month, 4);
      expect(date.day, 16);
    });

    test('returns the FIRST article date when multiple articles present', () {
      final date = parseSanookLatestDate(_twoArticlesHtml);
      expect(date, DateTime(2026, 4, 16));
    });

    test('returns null when no article present', () {
      expect(parseSanookLatestDate('<html></html>'), isNull);
    });

    test('returns null when article has no time element', () {
      const html = '<article class="lotto-check__article">'
          '<p>no date here</p></article>';
      expect(parseSanookLatestDate(html), isNull);
    });

    test('returns null when datetime attribute is malformed (no digits)', () {
      const html = '<article class="lotto-check__article">'
          '<time datetime="never" class="x">never</time>'
          '</article>';
      expect(parseSanookLatestDate(html), isNull);
    });
  });
}
