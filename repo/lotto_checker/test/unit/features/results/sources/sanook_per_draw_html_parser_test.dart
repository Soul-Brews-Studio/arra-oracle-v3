import 'package:flutter_test/flutter_test.dart';
import 'package:lotto_checker/features/results/data/sources/lottery_data_source.dart';
import 'package:lotto_checker/features/results/data/sources/sanook_per_draw_html_parser.dart';
import 'package:lotto_checker/shared/models/prize.dart';

// ── minimal fixture HTML ──────────────────────────────────────────────────────
// Mirrors the real per-draw page structure exactly enough to exercise the
// parser without the full 235 kB page.

const String _perDrawHtml = '''
<!doctype html>
<html lang="th">
<head>
  <script type="application/ld+json">
  {"datePublished":"2026-04-16T13:00:00+07:00"}
  </script>
</head>
<body>
  <!-- top-4 tiers in lottocheck__column divs -->
  <div class="lottocheck__column">
    <p class="default-font title__reward lottocheck__box-item--bg">
      <span class="default-font--reward">รางวัลที่ 1</span>
      <small>รางวัลละ 6,000,000 บาท</small>
    </p>
    <strong class="lotto__number lotto__number--first">309612</strong>
  </div>
  <div class="lottocheck__column">
    <p class="default-font title__reward lottocheck__box-item--bg">
      <span class="default-font--reward">เลขหน้า 3 ตัว</span>
      <small>2 รางวัลๆละ 4,000 บาท</small>
    </p>
    <strong class="lotto__number">355</strong>
    <strong class="lotto__number">108</strong>
  </div>
  <div class="lottocheck__column">
    <p class="default-font title__reward lottocheck__box-item--bg">
      <span class="default-font--reward">เลขท้าย 3 ตัว</span>
      <small>2 รางวัลๆละ 4,000 บาท</small>
    </p>
    <strong class="lotto__number">868</strong>
    <strong class="lotto__number">424</strong>
  </div>
  <div class="lottocheck__column">
    <p class="default-font title__reward lottocheck__box-item--bg">
      <span class="default-font--reward">เลขท้าย 2 ตัว</span>
      <small>1 รางวัลๆละ 2,000 บาท</small>
    </p>
    <strong class="lotto__number">77</strong>
  </div>

  <!-- near-1st -->
  <div class="lottocheck__sec--nearby">
    <p class="default-font title__reward">
      <span class="default-font--reward">รางวัลข้างเคียงรางวัลที่ 1</span>2 รางวัลๆละ 100,000 บาท
    </p>
    <strong class="lotto__number">309611</strong>
    <strong class="lotto__number">309613</strong>
  </div>

  <!-- 2nd prize — label contains <a> tag -->
  <div class="lottocheck__sec">
    <p class="default-font title__reward">
      <span class="default-font--reward"><a href="https://news.sanook.com/lotto/">ผลสลากกินแบ่งรัฐบาล</a> รางวัลที่ 2 มี 5 รางวัลๆละ 200,000 บาท</span>
    </p>
    <div class="lottocheck__box-item">
      <span class="lotto__number">175203</span>
      <span class="lotto__number">554697</span>
      <span class="lotto__number">097722</span>
      <span class="lotto__number">482398</span>
      <span class="lotto__number">419269</span>
    </div>
  </div>

  <!-- 3rd prize -->
  <div class="lottocheck__sec">
    <p class="default-font title__reward">
      <span class="default-font--reward"><a href="https://news.sanook.com/lotto/">ผลสลากกินแบ่งรัฐบาล</a> รางวัลที่ 3 มี 10 รางวัลๆละ 80,000 บาท</span>
    </p>
    <div class="lottocheck__box-item">
      <span class="lotto__number">753452</span>
      <span class="lotto__number">443166</span>
      <span class="lotto__number">742087</span>
      <span class="lotto__number">806727</span>
      <span class="lotto__number">746898</span>
      <span class="lotto__number">575200</span>
      <span class="lotto__number">136798</span>
      <span class="lotto__number">916619</span>
      <span class="lotto__number">366037</span>
      <span class="lotto__number">870392</span>
    </div>
  </div>

  <!-- 4th prize (abbreviated to 5 for test brevity) -->
  <div class="lottocheck__sec">
    <p class="default-font title__reward">
      <span class="default-font--reward"><a href="https://news.sanook.com/lotto/">ผลสลากกินแบ่งรัฐบาล</a> รางวัลที่ 4 มี 50 รางวัลๆละ 40,000 บาท</span>
    </p>
    <div class="lottocheck__box-item lottocheck__box-item--bg">
      <span class="lotto__number">280931</span>
      <span class="lotto__number">961998</span>
      <span class="lotto__number">752784</span>
      <span class="lotto__number">053998</span>
      <span class="lotto__number">921061</span>
    </div>
  </div>

  <!-- 5th prize (abbreviated to 5 for test brevity) -->
  <div class="lottocheck__sec">
    <p class="default-font title__reward">
      <span class="default-font--reward"><a href="https://news.sanook.com/lotto/">ผลสลากกินแบ่งรัฐบาล</a> รางวัลที่ 5 มี 100 รางวัลๆละ 20,000 บาท</span>
    </p>
    <div class="lottocheck__box-item">
      <span class="lotto__number">466167</span>
      <span class="lotto__number">643979</span>
      <span class="lotto__number">575626</span>
      <span class="lotto__number">809679</span>
      <span class="lotto__number">614737</span>
    </div>
  </div>
</body>
</html>
''';

// ── tests ─────────────────────────────────────────────────────────────────────

void main() {
  final date = DateTime.utc(2026, 4, 16);

  group('parseSanookPerDrawHtml — tier coverage', () {
    test('returns all 9 tiers', () {
      final draw = parseSanookPerDrawHtml(_perDrawHtml, date);
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

    test('first prize — 1 six-digit winner', () {
      final draw = parseSanookPerDrawHtml(_perDrawHtml, date);
      expect(draw.winningNumbers[PrizeTier.first], ['309612']);
    });

    test('firstNear — 2 six-digit winners either side of first', () {
      final draw = parseSanookPerDrawHtml(_perDrawHtml, date);
      expect(draw.winningNumbers[PrizeTier.firstNear], ['309611', '309613']);
    });

    test('second — 5 winners', () {
      final draw = parseSanookPerDrawHtml(_perDrawHtml, date);
      expect(draw.winningNumbers[PrizeTier.second]!.length, 5);
    });

    test('third — 10 winners', () {
      final draw = parseSanookPerDrawHtml(_perDrawHtml, date);
      expect(draw.winningNumbers[PrizeTier.third]!.length, 10);
    });

    test('fourth — 5 winners in abbreviated fixture', () {
      final draw = parseSanookPerDrawHtml(_perDrawHtml, date);
      expect(draw.winningNumbers[PrizeTier.fourth]!.length, 5);
    });

    test('fifth — 5 winners in abbreviated fixture', () {
      final draw = parseSanookPerDrawHtml(_perDrawHtml, date);
      expect(draw.winningNumbers[PrizeTier.fifth]!.length, 5);
    });

    test('threeDigitFront — 2 three-digit winners', () {
      final draw = parseSanookPerDrawHtml(_perDrawHtml, date);
      final v = draw.winningNumbers[PrizeTier.threeDigitFront]!;
      expect(v, ['355', '108']);
      expect(v.every((n) => RegExp(r'^\d{3}$').hasMatch(n)), isTrue);
    });

    test('threeDigitBack — 2 three-digit winners', () {
      final draw = parseSanookPerDrawHtml(_perDrawHtml, date);
      final v = draw.winningNumbers[PrizeTier.threeDigitBack]!;
      expect(v, ['868', '424']);
    });

    test('twoDigitBack — 1 two-digit winner', () {
      final draw = parseSanookPerDrawHtml(_perDrawHtml, date);
      expect(draw.winningNumbers[PrizeTier.twoDigitBack], ['77']);
    });
  });

  group('parseSanookPerDrawHtml — prizes map', () {
    test('prizes map holds first number for each tier', () {
      final draw = parseSanookPerDrawHtml(_perDrawHtml, date);
      expect(draw.prizes['first'], '309612');
      expect(draw.prizes['firstNear'], '309611');
      expect(draw.prizes['second'], '175203');
      expect(draw.prizes['third'], '753452');
      expect(draw.prizes['threeDigitFront'], '355');
      expect(draw.prizes['twoDigitBack'], '77');
    });

    test('drawDate is forwarded onto the returned Draw', () {
      final d = DateTime.utc(2026, 5, 1);
      final draw = parseSanookPerDrawHtml(_perDrawHtml, d);
      expect(draw.drawDate, d);
    });
  });

  group('parseSanookPerDrawHtml — degraded input', () {
    test('throws ParseException on empty string', () {
      expect(
        () => parseSanookPerDrawHtml('', date),
        throwsA(isA<ParseException>()),
      );
    });

    test('throws ParseException when first prize is missing', () {
      const html = '<span class="default-font--reward">เลขท้าย 2 ตัว</span>'
          '<strong class="lotto__number">12</strong>';
      expect(
        () => parseSanookPerDrawHtml(html, date),
        throwsA(isA<ParseException>()),
      );
    });

    test('unknown label is silently ignored', () {
      const html =
          '<span class="default-font--reward">รางวัลที่ 1</span>'
          '<strong class="lotto__number">111111</strong>'
          '<span class="default-font--reward">รางวัลพิเศษมาก</span>'
          '<strong class="lotto__number">999999</strong>';
      final draw = parseSanookPerDrawHtml(html, date);
      expect(draw.winningNumbers[PrizeTier.first], ['111111']);
      expect(draw.winningNumbers.length, 1);
    });

    test('leading zeros preserved', () {
      const html =
          '<span class="default-font--reward">รางวัลที่ 1</span>'
          '<strong class="lotto__number">000123</strong>';
      final draw = parseSanookPerDrawHtml(html, date);
      expect(draw.winningNumbers[PrizeTier.first], ['000123']);
    });
  });

  group('parseSanookPerDrawDate', () {
    test('extracts CE date from datePublished field', () {
      const html = '{"datePublished":"2026-04-16T13:00:00+07:00"}';
      expect(parseSanookPerDrawDate(html), DateTime(2026, 4, 16));
    });

    test('returns null when field absent', () {
      expect(parseSanookPerDrawDate('<html></html>'), isNull);
    });
  });

  group('sanookPerDrawUrl', () {
    test('converts CE date to Buddhist Era URL', () {
      final url = sanookPerDrawUrl(
        DateTime(2026, 4, 16),
        base: 'https://news.sanook.com/lotto/check/',
      );
      // 2026 CE + 543 = 2569 BE
      expect(url, 'https://news.sanook.com/lotto/check/16042569/');
    });

    test('pads day and month with leading zeros', () {
      final url = sanookPerDrawUrl(
        DateTime(2026, 1, 1),
        base: 'https://news.sanook.com/lotto/check/',
      );
      expect(url, 'https://news.sanook.com/lotto/check/01012569/');
    });
  });
}
