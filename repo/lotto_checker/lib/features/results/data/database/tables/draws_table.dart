import 'package:drift/drift.dart';

class DrawsTable extends Table {
  DateTimeColumn get drawDate => dateTime()();
  DateTimeColumn get fetchedAt => dateTime()();
  TextColumn get prizesJson => text()();
  TextColumn get winningNumbersJson => text()();

  @override
  Set<Column> get primaryKey => {drawDate};

  @override
  String get tableName => 'draws';
}
