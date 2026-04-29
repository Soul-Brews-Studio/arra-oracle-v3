import '../../../../shared/models/draw.dart';
import '../../../../shared/models/prize.dart';
import 'lottery_data_source.dart';

/// Parses news.sanook.com/lotto/ HTML into a [Draw].
///
/// Sanook's home page only carries first prize, front-3, back-3, back-2 for
/// past draws inside `<article class="lotto-check__article">` blocks. Tiers
/// 2-5 and firstNear are NOT exposed on the home page; they live on the
/// per-draw page (`/lotto/check/DDMMYYYY/`) which we deliberately do not
/// scrape. Result: [Draw.winningNumbers] for sanook will only contain the
/// four tiers above.
Draw parseSanookHtml(String html, DateTime drawDate) {
  if (html.trim().isEmpty) {
    throw ParseException('empty html');
  }

  final article = _firstArticleRegex.firstMatch(html);
  if (article == null) {
    throw ParseException('no lotto-check__article found');
  }
  final inner = article.group(1) ?? '';

  final winningNumbers = <PrizeTier, List<String>>{};
  final prizes = <String, String>{};

  for (final paraMatch in _paraRegex.allMatches(inner)) {
    final para = paraMatch.group(1) ?? '';
    final labelMatch = _labelRegex.firstMatch(para);
    if (labelMatch == null) continue;
    final label = labelMatch.group(1)!.trim();
    final tierKey = _labelToKey[label];
    if (tierKey == null) continue;
    final tier = _keyToTier[tierKey]!;
    final numbers = _numberRegex
        .allMatches(para)
        .map((m) => m.group(1)!)
        .toList(growable: false);
    if (numbers.isEmpty) continue;
    winningNumbers[tier] = numbers;
    prizes[tierKey] = numbers.first;
  }

  final first = winningNumbers[PrizeTier.first];
  if (first == null || first.isEmpty) {
    throw ParseException('first prize not found in latest article');
  }

  return Draw(
    drawDate: drawDate,
    prizes: prizes,
    winningNumbers: winningNumbers,
  );
}

/// Extracts the draw date of the most recent article from sanook html.
/// Returns `null` when the page has no article or no `datetime` attribute.
DateTime? parseSanookLatestDate(String html) {
  final article = _firstArticleRegex.firstMatch(html);
  if (article == null) return null;
  final inner = article.group(1) ?? '';
  final timeMatch = _timeRegex.firstMatch(inner);
  if (timeMatch == null) return null;
  final y = int.parse(timeMatch.group(1)!);
  final m = int.parse(timeMatch.group(2)!);
  final d = int.parse(timeMatch.group(3)!);
  return DateTime(y, m, d);
}

const Map<String, String> _labelToKey = {
  'รางวัลที่ 1': 'first',
  'เลขหน้า 3 ตัว': 'threeDigitFront',
  'เลขท้าย 3 ตัว': 'threeDigitBack',
  'เลขท้าย 2 ตัว': 'twoDigitBack',
};

const Map<String, PrizeTier> _keyToTier = {
  'first': PrizeTier.first,
  'threeDigitFront': PrizeTier.threeDigitFront,
  'threeDigitBack': PrizeTier.threeDigitBack,
  'twoDigitBack': PrizeTier.twoDigitBack,
};

final RegExp _firstArticleRegex = RegExp(
  r'<article[^>]*class="[^"]*\blotto-check__article\b[^"]*"[^>]*>([\s\S]*?)</article>',
);

final RegExp _paraRegex = RegExp(
  r'<p[^>]*class="[^"]*\blotto-check__para\b[^"]*"[^>]*>([\s\S]*?)</p>',
);

final RegExp _labelRegex = RegExp(
  r'<small[^>]*class="[^"]*\blotto-check__item\b[^"]*"[^>]*>([^<]+)</small>',
);

final RegExp _numberRegex = RegExp(
  r'<b[^>]*class="[^"]*\blotto__number\b[^"]*"[^>]*>\s*([0-9]+)\s*</b>',
);

final RegExp _timeRegex = RegExp(
  r'<time[^>]*datetime="(\d{4})-(\d{2})-(\d{2})',
);
