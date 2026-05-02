import '../../../../shared/models/draw.dart';
import '../../../../shared/models/prize.dart';
import 'lottery_data_source.dart';

/// Parses news.sanook.com/lotto/check/DDMMYYYY/ HTML into a [Draw].
///
/// The per-draw page exposes all 9 Thai lottery tiers — unlike the home page
/// which only carries the 4 headline tiers. Structure differs from the home
/// page: tier labels sit inside `<span class="default-font--reward">` elements
/// and numbers sit in `<strong class="lotto__number">` (top tiers) or
/// `<span class="lotto__number">` (tiers 2-5) elements.
///
/// URL format uses Thai Buddhist Era year (พ.ศ.) = CE year + 543.
/// Example: April 16 2026 CE → https://news.sanook.com/lotto/check/16042569/
Draw parseSanookPerDrawHtml(String html, DateTime drawDate) {
  if (html.trim().isEmpty) throw ParseException('empty html');

  // Collect all label positions (start of the span element)
  final labelPositions = <({int end, String rawText})>[];
  for (final m in _labelSpanRegex.allMatches(html)) {
    final raw = m.group(1) ?? '';
    labelPositions.add((end: m.end, rawText: raw));
  }

  if (labelPositions.isEmpty) {
    throw ParseException('no default-font--reward spans found');
  }

  // Collect all number positions
  final numPositions = <({int start, String number})>[];
  for (final m in _numberRegex.allMatches(html)) {
    numPositions.add((start: m.start, number: m.group(1)!));
  }

  final winningNumbers = <PrizeTier, List<String>>{};
  final prizes = <String, String>{};

  for (var i = 0; i < labelPositions.length; i++) {
    final label = labelPositions[i];
    final nextStart = i + 1 < labelPositions.length
        ? labelPositions[i + 1].end
        : html.length;

    final labelText = _stripTags(label.rawText).trim();
    final tier = _mapLabel(labelText);
    if (tier == null) continue;

    final nums = numPositions
        .where((n) => n.start >= label.end && n.start < nextStart)
        .map((n) => n.number)
        .toList(growable: false);

    if (nums.isEmpty) continue;
    winningNumbers[tier] = nums;
    prizes[tier.name] = nums.first;
  }

  final first = winningNumbers[PrizeTier.first];
  if (first == null || first.isEmpty) {
    throw ParseException('first prize not found in per-draw page');
  }

  return Draw(drawDate: drawDate, prizes: prizes, winningNumbers: winningNumbers);
}

/// Extracts the draw date from the JSON-LD `datePublished` field on the
/// per-draw page. Returns `null` if the field is absent or unparseable.
DateTime? parseSanookPerDrawDate(String html) {
  final m = _datePublishedRegex.firstMatch(html);
  if (m == null) return null;
  final y = int.parse(m.group(1)!);
  final mo = int.parse(m.group(2)!);
  final d = int.parse(m.group(3)!);
  return DateTime(y, mo, d);
}

/// Converts a CE [drawDate] to the Sanook per-draw URL.
/// Sanook uses Thai Buddhist Era year (CE + 543) in DDMMYYYY format.
String sanookPerDrawUrl(DateTime drawDate, {String base = _defaultBase}) {
  final beYear = drawDate.year + 543;
  final dd = drawDate.day.toString().padLeft(2, '0');
  final mm = drawDate.month.toString().padLeft(2, '0');
  return '$base$dd$mm$beYear/';
}

const String _defaultBase = 'https://news.sanook.com/lotto/check/';

// ── regex ────────────────────────────────────────────────────────────────────

/// Matches <span class="default-font--reward">…</span>
/// Captures inner HTML (may include <a> tags for tiers 2-5).
final RegExp _labelSpanRegex = RegExp(
  r'<span[^>]*class="[^"]*\bdefault-font--reward\b[^"]*"[^>]*>([\s\S]*?)</span>',
);

/// Matches lotto__number in <strong> or <span>.
final RegExp _numberRegex = RegExp(
  r'<(?:strong|span)[^>]*class="[^"]*\blotto__number\b[^"]*"[^>]*>\s*([0-9]+)\s*</(?:strong|span)>',
);

/// Extracts CE date from JSON-LD datePublished field.
final RegExp _datePublishedRegex = RegExp(
  r'"datePublished"\s*:\s*"(\d{4})-(\d{2})-(\d{2})',
);

/// Strips all HTML tags from a string, leaving plain text.
String _stripTags(String html) =>
    html.replaceAll(RegExp(r'<[^>]+>'), '').trim();

// ── label → tier mapping ─────────────────────────────────────────────────────

/// Maps stripped label text to a [PrizeTier].
/// Order matters: check เลขหน้า/เลขท้าย before รางวัลที่ so we don't
/// accidentally fall through. Check ข้างเคียง before รางวัลที่ 1.
PrizeTier? _mapLabel(String text) {
  if (text.contains('ข้างเคียง')) return PrizeTier.firstNear;
  if (text.contains('เลขหน้า 3 ตัว')) return PrizeTier.threeDigitFront;
  if (text.contains('เลขท้าย 3 ตัว')) return PrizeTier.threeDigitBack;
  if (text.contains('เลขท้าย 2 ตัว')) return PrizeTier.twoDigitBack;
  if (text.contains('รางวัลที่ 1')) return PrizeTier.first;
  if (text.contains('รางวัลที่ 2')) return PrizeTier.second;
  if (text.contains('รางวัลที่ 3')) return PrizeTier.third;
  if (text.contains('รางวัลที่ 4')) return PrizeTier.fourth;
  if (text.contains('รางวัลที่ 5')) return PrizeTier.fifth;
  return null;
}
