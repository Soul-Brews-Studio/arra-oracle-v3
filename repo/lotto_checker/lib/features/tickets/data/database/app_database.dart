import 'package:drift/drift.dart';
import 'package:drift_flutter/drift_flutter.dart';

import '../../../results/data/database/tables/draws_table.dart';
import 'tables/tickets_table.dart';

part 'app_database.g.dart';

/// Application-wide Drift database. Phase 2a owned [TicketsTable]; Phase 2c
/// adds [DrawsTable] for cached lottery results. The optional [executor]
/// parameter lets tests inject an in-memory database via Riverpod overrides.
@DriftDatabase(tables: [TicketsTable, DrawsTable])
class AppDatabase extends _$AppDatabase {
  AppDatabase([QueryExecutor? executor])
    : super(executor ?? driftDatabase(name: 'lotto_checker'));

  @override
  int get schemaVersion => 2;

  @override
  MigrationStrategy get migration => MigrationStrategy(
    onUpgrade: (m, from, to) async {
      if (from < 2) {
        await m.createTable(drawsTable);
      }
    },
  );
}
