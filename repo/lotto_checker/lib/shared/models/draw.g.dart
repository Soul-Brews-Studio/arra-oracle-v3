// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'draw.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_$DrawImpl _$$DrawImplFromJson(Map<String, dynamic> json) => _$DrawImpl(
  drawDate: DateTime.parse(json['drawDate'] as String),
  prizes: Map<String, String>.from(json['prizes'] as Map),
  winningNumbers:
      (json['winningNumbers'] as Map<String, dynamic>?)?.map(
        (k, e) => MapEntry(
          $enumDecode(_$PrizeTierEnumMap, k),
          (e as List<dynamic>).map((e) => e as String).toList(),
        ),
      ) ??
      const <PrizeTier, List<String>>{},
);

Map<String, dynamic> _$$DrawImplToJson(_$DrawImpl instance) =>
    <String, dynamic>{
      'drawDate': instance.drawDate.toIso8601String(),
      'prizes': instance.prizes,
      'winningNumbers': instance.winningNumbers.map(
        (k, e) => MapEntry(_$PrizeTierEnumMap[k]!, e),
      ),
    };

const _$PrizeTierEnumMap = {
  PrizeTier.first: 'first',
  PrizeTier.firstNear: 'firstNear',
  PrizeTier.second: 'second',
  PrizeTier.third: 'third',
  PrizeTier.fourth: 'fourth',
  PrizeTier.fifth: 'fifth',
  PrizeTier.threeDigitFront: 'threeDigitFront',
  PrizeTier.threeDigitBack: 'threeDigitBack',
  PrizeTier.twoDigitBack: 'twoDigitBack',
};
