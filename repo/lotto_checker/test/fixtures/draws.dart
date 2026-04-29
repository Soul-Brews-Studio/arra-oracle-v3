import 'package:flutter_test/flutter_test.dart';
import 'package:lotto_checker/shared/models/draw.dart';
import 'package:lotto_checker/shared/models/prize.dart';

/// Canonical [Draw] for tests. Mirrors the GLO stub HTML at
/// `test/fixtures/glo_html/2026-04-16.html` so parser tests can assert against
/// it directly.
Draw fixtureDraw({
  DateTime? drawDate,
  Map<PrizeTier, List<String>>? winningNumbers,
  Map<String, String>? prizes,
}) => Draw(
  drawDate: drawDate ?? DateTime.utc(2026, 4, 16),
  prizes: prizes ?? const {
    'first': '123456',
    'firstNear': '123455',
    'second': '200001',
    'third': '300001',
    'fourth': '400001',
    'fifth': '500001',
    'threeDigitFront': '123',
    'threeDigitBack': '456',
    'twoDigitBack': '56',
  },
  winningNumbers: winningNumbers ?? const {
    PrizeTier.first: ['123456'],
    PrizeTier.firstNear: ['123455', '123457'],
    PrizeTier.second: ['200001', '200002', '200003', '200004', '200005'],
    PrizeTier.third: [
      '300001', '300002', '300003', '300004', '300005',
      '300006', '300007', '300008', '300009', '300010',
    ],
    PrizeTier.fourth: ['400001', '400002'],
    PrizeTier.fifth: ['500001', '500002'],
    PrizeTier.threeDigitFront: ['123', '789'],
    PrizeTier.threeDigitBack: ['456', '654'],
    PrizeTier.twoDigitBack: ['56'],
  },
);

/// Three distinct draws spanning several months — used by repository tests
/// that exercise ordering and `deleteOlderThan`.
List<Draw> fixtureDraws() => [
  fixtureDraw(
    drawDate: DateTime.utc(2026, 4, 16),
    winningNumbers: const {
      PrizeTier.first: ['111111'],
    },
    prizes: const {'first': '111111'},
  ),
  fixtureDraw(
    drawDate: DateTime.utc(2026, 5, 1),
    winningNumbers: const {
      PrizeTier.first: ['222222'],
    },
    prizes: const {'first': '222222'},
  ),
  fixtureDraw(
    drawDate: DateTime.utc(2026, 5, 16),
    winningNumbers: const {
      PrizeTier.first: ['333333'],
    },
    prizes: const {'first': '333333'},
  ),
];

/// Inline HTML mirroring `test/fixtures/glo_html/2026-04-16.html`. Returned as
/// a Dart string so parser tests stay hermetic and don't depend on the test
/// runner's working directory.
const String fixtureGloHtml = '''
<!doctype html>
<html lang="th">
<body>
<main>
  <section data-prize="first">
    <span class="lotto-number">123456</span>
  </section>
  <section data-prize="firstNear">
    <span class="lotto-number">123455</span>
    <span class="lotto-number">123457</span>
  </section>
  <section data-prize="second">
    <span class="lotto-number">200001</span>
    <span class="lotto-number">200002</span>
    <span class="lotto-number">200003</span>
    <span class="lotto-number">200004</span>
    <span class="lotto-number">200005</span>
  </section>
  <section data-prize="third">
    <span class="lotto-number">300001</span>
    <span class="lotto-number">300002</span>
    <span class="lotto-number">300003</span>
    <span class="lotto-number">300004</span>
    <span class="lotto-number">300005</span>
    <span class="lotto-number">300006</span>
    <span class="lotto-number">300007</span>
    <span class="lotto-number">300008</span>
    <span class="lotto-number">300009</span>
    <span class="lotto-number">300010</span>
  </section>
  <section data-prize="fourth">
    <span class="lotto-number">400001</span>
    <span class="lotto-number">400002</span>
  </section>
  <section data-prize="fifth">
    <span class="lotto-number">500001</span>
    <span class="lotto-number">500002</span>
  </section>
  <section data-prize="threeDigitFront">
    <span class="lotto-number">123</span>
    <span class="lotto-number">789</span>
  </section>
  <section data-prize="threeDigitBack">
    <span class="lotto-number">456</span>
    <span class="lotto-number">654</span>
  </section>
  <section data-prize="twoDigitBack">
    <span class="lotto-number">56</span>
  </section>
</main>
</body>
</html>
''';

/// HTML with only the first prize present — used to test "missing tiers
/// gracefully" behavior.
const String fixtureGloHtmlFirstOnly = '''
<!doctype html><html><body>
<section data-prize="first">
  <span class="lotto-number">654321</span>
</section>
</body></html>
''';

/// Compares two Draws by all fields, normalizing dates to instants so the
/// roundtrip through Drift (which strips the UTC flag on read) still matches.
Matcher drawEquals(Draw expected) => _DrawMatcher(expected);

class _DrawMatcher extends Matcher {
  _DrawMatcher(this.expected);
  final Draw expected;

  @override
  bool matches(Object? item, Map<dynamic, dynamic> matchState) {
    if (item is! Draw) return false;
    if (!item.drawDate.isAtSameMomentAs(expected.drawDate)) return false;
    if (item.prizes.length != expected.prizes.length) return false;
    for (final entry in expected.prizes.entries) {
      if (item.prizes[entry.key] != entry.value) return false;
    }
    if (item.winningNumbers.length != expected.winningNumbers.length) {
      return false;
    }
    for (final entry in expected.winningNumbers.entries) {
      final actual = item.winningNumbers[entry.key];
      if (actual == null) return false;
      if (actual.length != entry.value.length) return false;
      for (var i = 0; i < entry.value.length; i++) {
        if (actual[i] != entry.value[i]) return false;
      }
    }
    return true;
  }

  @override
  Description describe(Description d) => d.add('Draw equal to $expected');
}
