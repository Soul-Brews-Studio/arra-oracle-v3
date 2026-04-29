import 'package:freezed_annotation/freezed_annotation.dart';

import 'prize.dart';

part 'draw.freezed.dart';
part 'draw.g.dart';

/// A single Thai lottery draw result.
///
/// `prizes` is the raw GLO payload (tier-id → first winning number) preserved
/// for ingest fidelity. `winningNumbers` is the structured form keyed by
/// [PrizeTier] with a list of winning numbers per tier — required because
/// tiers 2–5, threeDigitBack and firstNear have multiple winners.
@freezed
class Draw with _$Draw {
  const factory Draw({
    required DateTime drawDate,
    required Map<String, String> prizes,
    @Default(<PrizeTier, List<String>>{})
    Map<PrizeTier, List<String>> winningNumbers,
  }) = _Draw;

  factory Draw.fromJson(Map<String, dynamic> json) => _$DrawFromJson(json);
}
