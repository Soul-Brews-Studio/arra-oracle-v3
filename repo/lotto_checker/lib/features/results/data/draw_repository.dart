import 'dart:convert';

import 'package:drift/drift.dart';

import '../../../shared/models/draw.dart';
import '../../../shared/models/prize.dart';
import '../../tickets/data/database/app_database.dart';

abstract class DrawRepository {
  Stream<List<Draw>> watchAll();

  Future<Draw?> getByDate(DateTime drawDate);

  Future<Draw?> getLatest();

  Future<void> save(Draw draw);

  Future<void> deleteOlderThan(Duration retention);
}

class DriftDrawRepository implements DrawRepository {
  DriftDrawRepository(this._db);

  final AppDatabase _db;

  @override
  Stream<List<Draw>> watchAll() {
    final query = _db.select(_db.drawsTable)
      ..orderBy([
        (t) => OrderingTerm(expression: t.drawDate, mode: OrderingMode.desc),
      ]);
    return query.watch().map(
      (rows) => rows.map(_toDomain).toList(growable: false),
    );
  }

  @override
  Future<Draw?> getByDate(DateTime drawDate) async {
    final row = await (_db.select(_db.drawsTable)
      ..where((t) => t.drawDate.equals(drawDate))).getSingleOrNull();
    return row == null ? null : _toDomain(row);
  }

  @override
  Future<Draw?> getLatest() async {
    final row = await (_db.select(_db.drawsTable)
          ..orderBy([
            (t) =>
                OrderingTerm(expression: t.drawDate, mode: OrderingMode.desc),
          ])
          ..limit(1))
        .getSingleOrNull();
    return row == null ? null : _toDomain(row);
  }

  @override
  Future<void> save(Draw draw) async {
    await _db
        .into(_db.drawsTable)
        .insertOnConflictUpdate(_toCompanion(draw));
  }

  @override
  Future<void> deleteOlderThan(Duration retention) async {
    final cutoff = DateTime.now().subtract(retention);
    await (_db.delete(_db.drawsTable)
      ..where((t) => t.drawDate.isSmallerThanValue(cutoff))).go();
  }

  Draw _toDomain(DrawsTableData row) {
    final prizes = (jsonDecode(row.prizesJson) as Map<String, dynamic>)
        .map((k, v) => MapEntry(k, v as String));
    final decoded =
        jsonDecode(row.winningNumbersJson) as Map<String, dynamic>;
    final winning = <PrizeTier, List<String>>{};
    for (final entry in decoded.entries) {
      final tier = PrizeTier.values.firstWhere(
        (t) => t.name == entry.key,
        orElse: () => throw FormatException(
          'Unknown PrizeTier "${entry.key}" in cached draw',
        ),
      );
      winning[tier] = (entry.value as List)
          .map((e) => e as String)
          .toList(growable: false);
    }
    return Draw(
      drawDate: row.drawDate,
      prizes: prizes,
      winningNumbers: winning,
    );
  }

  DrawsTableCompanion _toCompanion(Draw draw) {
    final winningEncoded = <String, List<String>>{
      for (final entry in draw.winningNumbers.entries)
        entry.key.name: entry.value,
    };
    return DrawsTableCompanion(
      drawDate: Value(draw.drawDate),
      fetchedAt: Value(DateTime.now()),
      prizesJson: Value(jsonEncode(draw.prizes)),
      winningNumbersJson: Value(jsonEncode(winningEncoded)),
    );
  }
}
