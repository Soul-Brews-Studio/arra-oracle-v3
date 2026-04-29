import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../shared/models/ticket.dart';
import '../../tickets/data/providers.dart';
import '../data/providers.dart';
import '../domain/match_result.dart';
import 'ticket_match_service.dart';

final ticketMatchServiceProvider = Provider<TicketMatchService>((ref) {
  return TicketMatchService(
    ticketRepo: ref.watch(ticketRepositoryProvider),
    syncService: ref.watch(drawSyncServiceProvider),
  );
});

final ticketMatchProvider =
    FutureProvider.family<MatchResult, Ticket>((ref, ticket) {
  return ref.watch(ticketMatchServiceProvider).checkTicket(ticket);
});

final allTicketMatchesProvider =
    StreamProvider<Map<String, MatchResult>>((ref) {
  return ref.watch(ticketMatchServiceProvider).watchAll();
});
