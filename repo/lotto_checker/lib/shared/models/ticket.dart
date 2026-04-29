import 'package:freezed_annotation/freezed_annotation.dart';

part 'ticket.freezed.dart';
part 'ticket.g.dart';

/// A user-saved Thai lottery ticket.
///
/// `numbers` is the 6-digit ticket string (e.g. "123456"). `drawDate` marks
/// which draw this ticket belongs to. `createdAt` is when the user added it.
@freezed
class Ticket with _$Ticket {
  const factory Ticket({
    required String id,
    required String numbers,
    required DateTime drawDate,
    required DateTime createdAt,
    String? note,
  }) = _Ticket;

  factory Ticket.fromJson(Map<String, dynamic> json) => _$TicketFromJson(json);
}
