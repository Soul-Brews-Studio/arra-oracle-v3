import 'package:freezed_annotation/freezed_annotation.dart';

import '../../../shared/models/prize.dart';

part 'match_result.freezed.dart';

/// Outcome of checking a ticket against a draw.
///
/// `noMatch` covers losing tickets; `match` carries the highest tier won
/// plus the digit substring that triggered the win (full 6 digits for
/// exact-match tiers, last/first 2-3 digits for partial tiers).
@freezed
sealed class MatchResult with _$MatchResult {
  const factory MatchResult.noMatch() = NoMatch;

  const factory MatchResult.match({
    required PrizeTier tier,
    required int prizeAmount,
    required String matchedDigits,
  }) = Match;
}
