import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../shared/models/ticket.dart';
import 'database/app_database.dart';
import 'ticket_repository.dart';

/// Singleton [AppDatabase] for the running app. Tests should override this
/// with an in-memory executor:
///
/// ```dart
/// final container = ProviderContainer(overrides: [
///   appDatabaseProvider.overrideWithValue(
///     AppDatabase(NativeDatabase.memory()),
///   ),
/// ]);
/// ```
final appDatabaseProvider = Provider<AppDatabase>((ref) {
  final db = AppDatabase();
  ref.onDispose(db.close);
  return db;
});

/// Default repository provider — wraps the singleton [AppDatabase]. Override
/// this in tests if you want to swap in a fake implementation entirely.
final ticketRepositoryProvider = Provider<TicketRepository>((ref) {
  final db = ref.watch(appDatabaseProvider);
  return DriftTicketRepository(db);
});

/// Live stream of every saved ticket (sorted draw-date desc, created-at desc).
final allTicketsProvider = StreamProvider<List<Ticket>>((ref) {
  return ref.watch(ticketRepositoryProvider).watchAll();
});
