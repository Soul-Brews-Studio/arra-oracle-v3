import 'package:drift/drift.dart';

/// Drift table definition for persisted lottery tickets.
///
/// `numbers` is the 6-digit ticket string, fixed length. Primary key is the
/// caller-supplied [id] (UUID/string) so we can map cleanly to the domain
/// `Ticket` model and avoid surfacing rowids to the app layer.
class TicketsTable extends Table {
  TextColumn get id => text()();
  TextColumn get numbers => text().withLength(min: 6, max: 6)();
  DateTimeColumn get drawDate => dateTime()();
  DateTimeColumn get createdAt => dateTime()();
  TextColumn get note => text().nullable()();

  @override
  Set<Column> get primaryKey => {id};

  @override
  String get tableName => 'tickets';
}
