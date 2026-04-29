import 'dart:async';

import '../../../shared/models/draw.dart';
import '../../../shared/models/ticket.dart';
import '../../tickets/data/ticket_repository.dart';
import '../data/sync_service.dart';
import '../domain/match_engine.dart' as engine;
import '../domain/match_result.dart';

class TicketMatchService {
  TicketMatchService({
    required TicketRepository ticketRepo,
    required DrawSyncService syncService,
  }) : _ticketRepo = ticketRepo,
       _syncService = syncService;

  final TicketRepository _ticketRepo;
  final DrawSyncService _syncService;

  Future<MatchResult> checkTicket(Ticket ticket) async {
    final draw = await _safeGetOrFetch(ticket.drawDate);
    if (draw == null) return const MatchResult.noMatch();
    return engine.checkTicket(ticket, draw);
  }

  Future<Map<String, MatchResult>> checkAll() async {
    final tickets = await _ticketRepo.getAll();
    return _matchAll(tickets);
  }

  Stream<Map<String, MatchResult>> watchAll() {
    return _ticketRepo.watchAll().asyncMap(_matchAll);
  }

  Future<Map<String, MatchResult>> _matchAll(List<Ticket> tickets) async {
    if (tickets.isEmpty) return const <String, MatchResult>{};
    final byDate = <DateTime, Future<Draw?>>{};
    final results = <String, MatchResult>{};
    for (final ticket in tickets) {
      final pending = byDate.putIfAbsent(
        ticket.drawDate,
        () => _safeGetOrFetch(ticket.drawDate),
      );
      final draw = await pending;
      results[ticket.id] = draw == null
          ? const MatchResult.noMatch()
          : engine.checkTicket(ticket, draw);
    }
    return results;
  }

  Future<Draw?> _safeGetOrFetch(DateTime drawDate) async {
    try {
      return await _syncService.getOrFetch(drawDate);
    } catch (_) {
      return null;
    }
  }
}
