import '../../../../shared/models/draw.dart';
import '../../../../shared/models/prize.dart';
import 'lottery_data_source.dart';

/// Parses glo.or.th HTML into a [Draw].
///
/// Uses a marker-based stub format
/// (`<section data-prize="first"><span class="lotto-number">123456</span></section>`)
/// while the real GLO HTML structure is being captured. The parser will be
/// rewritten in Phase 2d against real markup; the contract — pure function,
/// throws [ParseException] on malformed input — stays.
Draw parseGloHtml(String html, DateTime drawDate) {
  if (html.trim().isEmpty) {
    throw ParseException('empty html');
  }

  final winningNumbers = <PrizeTier, List<String>>{};
  final prizes = <String, String>{};

  for (final entry in _tierKey.entries) {
    final numbers = _extractTier(html, entry.key);
    if (numbers.isEmpty) continue;
    winningNumbers[entry.value] = numbers;
    prizes[entry.key] = numbers.first;
  }

  final first = winningNumbers[PrizeTier.first];
  if (first == null || first.isEmpty) {
    throw ParseException('first prize not found in html');
  }

  return Draw(
    drawDate: drawDate,
    prizes: prizes,
    winningNumbers: winningNumbers,
  );
}

const Map<String, PrizeTier> _tierKey = {
  'first': PrizeTier.first,
  'firstNear': PrizeTier.firstNear,
  'second': PrizeTier.second,
  'third': PrizeTier.third,
  'fourth': PrizeTier.fourth,
  'fifth': PrizeTier.fifth,
  'threeDigitFront': PrizeTier.threeDigitFront,
  'threeDigitBack': PrizeTier.threeDigitBack,
  'twoDigitBack': PrizeTier.twoDigitBack,
};

final RegExp _numberRegex =
    RegExp(r'class="[^"]*\blotto-number\b[^"]*"[^>]*>\s*([0-9]+)\s*<');

List<String> _extractTier(String html, String tierKey) {
  final escaped = RegExp.escape(tierKey);
  final blockRegex =
      RegExp('<section[^>]*data-prize="$escaped"[^>]*>([\\s\\S]*?)</section>');
  final match = blockRegex.firstMatch(html);
  if (match == null) return const [];
  final inner = match.group(1) ?? '';
  return _numberRegex
      .allMatches(inner)
      .map((m) => m.group(1)!)
      .toList(growable: false);
}
