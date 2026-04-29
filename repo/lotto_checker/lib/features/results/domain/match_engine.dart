import '../../../shared/models/draw.dart';
import '../../../shared/models/prize.dart';
import '../../../shared/models/ticket.dart';
import 'match_result.dart';

/// Tier priority — earlier wins beat later wins when a ticket qualifies for
/// more than one. Order mirrors prize value; firstNear sits just below first.
const List<PrizeTier> _tierPriority = [
  PrizeTier.first,
  PrizeTier.firstNear,
  PrizeTier.second,
  PrizeTier.third,
  PrizeTier.fourth,
  PrizeTier.fifth,
  PrizeTier.threeDigitFront,
  PrizeTier.threeDigitBack,
  PrizeTier.twoDigitBack,
];

/// Pure check of a single [ticket] against a single [draw].
///
/// Returns the highest tier the ticket wins, or [NoMatch] if none. Ticket
/// numbers must be exactly 6 digits — anything else is treated as no match
/// rather than thrown, so callers can stay total.
MatchResult checkTicket(Ticket ticket, Draw draw) {
  final n = ticket.numbers;
  if (n.length != 6 || !_isAllDigits(n)) {
    return const MatchResult.noMatch();
  }

  for (final tier in _tierPriority) {
    final hit = _checkTier(tier, n, draw);
    if (hit != null) {
      return MatchResult.match(
        tier: tier,
        prizeAmount: tier.amount,
        matchedDigits: hit,
      );
    }
  }
  return const MatchResult.noMatch();
}

String? _checkTier(PrizeTier tier, String n, Draw draw) {
  switch (tier) {
    case PrizeTier.threeDigitFront:
      return _matchPartial(
        candidates: draw.winningNumbers[tier] ?? const [],
        slice: n.substring(0, 3),
        width: 3,
      );
    case PrizeTier.threeDigitBack:
      return _matchPartial(
        candidates: draw.winningNumbers[tier] ?? const [],
        slice: n.substring(3, 6),
        width: 3,
      );
    case PrizeTier.twoDigitBack:
      return _matchPartial(
        candidates: draw.winningNumbers[tier] ?? const [],
        slice: n.substring(4, 6),
        width: 2,
      );
    case PrizeTier.first:
    case PrizeTier.firstNear:
    case PrizeTier.second:
    case PrizeTier.third:
    case PrizeTier.fourth:
    case PrizeTier.fifth:
      final list = draw.winningNumbers[tier] ?? const [];
      return list.contains(n) ? n : null;
  }
}

String? _matchPartial({
  required List<String> candidates,
  required String slice,
  required int width,
}) {
  for (final c in candidates) {
    if (c.length == width && c == slice) return slice;
  }
  return null;
}

bool _isAllDigits(String s) {
  for (var i = 0; i < s.length; i++) {
    final c = s.codeUnitAt(i);
    if (c < 0x30 || c > 0x39) return false;
  }
  return true;
}
