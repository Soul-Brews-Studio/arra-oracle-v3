import 'package:drift/drift.dart';

import '../../../shared/models/ticket.dart';
import 'database/app_database.dart';

/// Contract for persisting and querying [Ticket]s.
///
/// Defined as an abstract class so tests (and future remote/sync backends)
/// can substitute their own implementation via Riverpod overrides without
/// touching call sites.
abstract class TicketRepository {
  /// Watch all tickets, ordered by `drawDate` desc, then `createdAt` desc.
  Stream<List<Ticket>> watchAll();

  /// One-shot fetch of all tickets in the same order as [watchAll].
  Future<List<Ticket>> getAll();

  /// Fetch a single ticket by [id], or `null` if no such row exists.
  Future<Ticket?> getById(String id);

  /// All tickets matching a specific [drawDate]. Comparison is done against
  /// the stored `DateTime` (callers should pass the canonical draw date).
  Future<List<Ticket>> getByDrawDate(DateTime drawDate);

  /// Insert or update [ticket] (upsert keyed by [Ticket.id]).
  Future<void> save(Ticket ticket);

  /// Delete the ticket with [id]. No-op if it doesn't exist.
  Future<void> delete(String id);

  /// Wipe every ticket. Mostly for tests / "clear data" actions.
  Future<void> deleteAll();
}

/// Drift-backed [TicketRepository]. Stateless aside from the [AppDatabase]
/// it wraps; safe to construct as a singleton via Riverpod.
class DriftTicketRepository implements TicketRepository {
  DriftTicketRepository(this._db);

  final AppDatabase _db;

  @override
  Stream<List<Ticket>> watchAll() {
    final query = _db.select(_db.ticketsTable)
      ..orderBy([
        (t) =>
            OrderingTerm(expression: t.drawDate, mode: OrderingMode.desc),
        (t) =>
            OrderingTerm(expression: t.createdAt, mode: OrderingMode.desc),
      ]);
    return query.watch().map(
      (rows) => rows.map(_toDomain).toList(growable: false),
    );
  }

  @override
  Future<List<Ticket>> getAll() async {
    final query = _db.select(_db.ticketsTable)
      ..orderBy([
        (t) =>
            OrderingTerm(expression: t.drawDate, mode: OrderingMode.desc),
        (t) =>
            OrderingTerm(expression: t.createdAt, mode: OrderingMode.desc),
      ]);
    final rows = await query.get();
    return rows.map(_toDomain).toList(growable: false);
  }

  @override
  Future<Ticket?> getById(String id) async {
    final row = await (_db.select(_db.ticketsTable)
      ..where((t) => t.id.equals(id))).getSingleOrNull();
    return row == null ? null : _toDomain(row);
  }

  @override
  Future<List<Ticket>> getByDrawDate(DateTime drawDate) async {
    final query = _db.select(_db.ticketsTable)
      ..where((t) => t.drawDate.equals(drawDate))
      ..orderBy([
        (t) =>
            OrderingTerm(expression: t.createdAt, mode: OrderingMode.desc),
      ]);
    final rows = await query.get();
    return rows.map(_toDomain).toList(growable: false);
  }

  @override
  Future<void> save(Ticket ticket) async {
    await _db
        .into(_db.ticketsTable)
        .insertOnConflictUpdate(_toCompanion(ticket));
  }

  @override
  Future<void> delete(String id) async {
    await (_db.delete(_db.ticketsTable)
      ..where((t) => t.id.equals(id))).go();
  }

  @override
  Future<void> deleteAll() async {
    await _db.delete(_db.ticketsTable).go();
  }

  // --- mapping ---------------------------------------------------------------

  Ticket _toDomain(TicketsTableData row) => Ticket(
    id: row.id,
    numbers: row.numbers,
    drawDate: row.drawDate,
    createdAt: row.createdAt,
    note: row.note,
  );

  TicketsTableCompanion _toCompanion(Ticket ticket) => TicketsTableCompanion(
    id: Value(ticket.id),
    numbers: Value(ticket.numbers),
    drawDate: Value(ticket.drawDate),
    createdAt: Value(ticket.createdAt),
    note: Value(ticket.note),
  );
}
