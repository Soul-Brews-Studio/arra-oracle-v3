import 'package:lotto_checker/shared/models/draw.dart';
import 'package:lotto_checker/shared/models/prize.dart';
import 'package:lotto_checker/shared/models/ticket.dart';

Ticket testTicket(String numbers) => Ticket(
      id: 't1',
      numbers: numbers,
      drawDate: DateTime(2026, 5, 1),
      createdAt: DateTime(2026, 4, 28),
    );

Draw testDraw({
  Map<PrizeTier, List<String>> winners = const {},
  Map<String, String> raw = const {},
}) =>
    Draw(
      drawDate: DateTime(2026, 5, 1),
      prizes: raw,
      winningNumbers: winners,
    );
