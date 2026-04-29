// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'ticket.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_$TicketImpl _$$TicketImplFromJson(Map<String, dynamic> json) => _$TicketImpl(
  id: json['id'] as String,
  numbers: json['numbers'] as String,
  drawDate: DateTime.parse(json['drawDate'] as String),
  createdAt: DateTime.parse(json['createdAt'] as String),
  note: json['note'] as String?,
);

Map<String, dynamic> _$$TicketImplToJson(_$TicketImpl instance) =>
    <String, dynamic>{
      'id': instance.id,
      'numbers': instance.numbers,
      'drawDate': instance.drawDate.toIso8601String(),
      'createdAt': instance.createdAt.toIso8601String(),
      'note': instance.note,
    };
