import 'package:flutter_test/flutter_test.dart';
import 'package:lotto_checker/shared/models/ticket.dart';

/// Build a canonical [Ticket] for tests. All fields default to deterministic
/// UTC values so equality assertions are stable across machines/timezones.
Ticket fixtureTicket({
  String id = 'ticket-1',
  String numbers = '123456',
  DateTime? drawDate,
  DateTime? createdAt,
  String? note,
}) => Ticket(
  id: id,
  numbers: numbers,
  drawDate: drawDate ?? DateTime.utc(2026, 5, 1),
  createdAt: createdAt ?? DateTime.utc(2026, 4, 27, 10),
  note: note,
);

/// Three distinct tickets covering different draw dates, created-at times,
/// and note values. Used by repository tests that exercise ordering and
/// filtering.
List<Ticket> fixtureTickets() => [
  fixtureTicket(
    id: 'ticket-a',
    numbers: '111111',
    drawDate: DateTime.utc(2026, 5, 1),
    createdAt: DateTime.utc(2026, 4, 27, 10),
    note: 'birthday numbers',
  ),
  fixtureTicket(
    id: 'ticket-b',
    numbers: '222222',
    drawDate: DateTime.utc(2026, 5, 16),
    createdAt: DateTime.utc(2026, 4, 28, 9),
  ),
  fixtureTicket(
    id: 'ticket-c',
    numbers: '333333',
    drawDate: DateTime.utc(2026, 4, 16),
    createdAt: DateTime.utc(2026, 4, 26, 8),
    note: 'lucky pick',
  ),
];

/// Compares a [Ticket] by all fields, treating `DateTime`s by *instant* so
/// stored values that come back as local-tz Dart [DateTime]s still match the
/// originals (Drift drops the UTC flag on read; the instant is preserved).
Matcher ticketEquals(Ticket expected) => _TicketMatcher(expected);

class _TicketMatcher extends Matcher {
  _TicketMatcher(this.expected);
  final Ticket expected;

  @override
  bool matches(Object? item, Map<dynamic, dynamic> matchState) {
    if (item is! Ticket) return false;
    return item.id == expected.id &&
        item.numbers == expected.numbers &&
        item.note == expected.note &&
        item.drawDate.isAtSameMomentAs(expected.drawDate) &&
        item.createdAt.isAtSameMomentAs(expected.createdAt);
  }

  @override
  Description describe(Description d) => d.add('Ticket equal to $expected');
}
