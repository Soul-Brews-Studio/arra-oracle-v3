// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'app_database.dart';

// ignore_for_file: type=lint
class $TicketsTableTable extends TicketsTable
    with TableInfo<$TicketsTableTable, TicketsTableData> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $TicketsTableTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<String> id = GeneratedColumn<String>(
    'id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _numbersMeta = const VerificationMeta(
    'numbers',
  );
  @override
  late final GeneratedColumn<String> numbers = GeneratedColumn<String>(
    'numbers',
    aliasedName,
    false,
    additionalChecks: GeneratedColumn.checkTextLength(
      minTextLength: 6,
      maxTextLength: 6,
    ),
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _drawDateMeta = const VerificationMeta(
    'drawDate',
  );
  @override
  late final GeneratedColumn<DateTime> drawDate = GeneratedColumn<DateTime>(
    'draw_date',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _createdAtMeta = const VerificationMeta(
    'createdAt',
  );
  @override
  late final GeneratedColumn<DateTime> createdAt = GeneratedColumn<DateTime>(
    'created_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _noteMeta = const VerificationMeta('note');
  @override
  late final GeneratedColumn<String> note = GeneratedColumn<String>(
    'note',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  @override
  List<GeneratedColumn> get $columns => [
    id,
    numbers,
    drawDate,
    createdAt,
    note,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'tickets';
  @override
  VerificationContext validateIntegrity(
    Insertable<TicketsTableData> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('numbers')) {
      context.handle(
        _numbersMeta,
        numbers.isAcceptableOrUnknown(data['numbers']!, _numbersMeta),
      );
    } else if (isInserting) {
      context.missing(_numbersMeta);
    }
    if (data.containsKey('draw_date')) {
      context.handle(
        _drawDateMeta,
        drawDate.isAcceptableOrUnknown(data['draw_date']!, _drawDateMeta),
      );
    } else if (isInserting) {
      context.missing(_drawDateMeta);
    }
    if (data.containsKey('created_at')) {
      context.handle(
        _createdAtMeta,
        createdAt.isAcceptableOrUnknown(data['created_at']!, _createdAtMeta),
      );
    } else if (isInserting) {
      context.missing(_createdAtMeta);
    }
    if (data.containsKey('note')) {
      context.handle(
        _noteMeta,
        note.isAcceptableOrUnknown(data['note']!, _noteMeta),
      );
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  TicketsTableData map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return TicketsTableData(
      id:
          attachedDatabase.typeMapping.read(
            DriftSqlType.string,
            data['${effectivePrefix}id'],
          )!,
      numbers:
          attachedDatabase.typeMapping.read(
            DriftSqlType.string,
            data['${effectivePrefix}numbers'],
          )!,
      drawDate:
          attachedDatabase.typeMapping.read(
            DriftSqlType.dateTime,
            data['${effectivePrefix}draw_date'],
          )!,
      createdAt:
          attachedDatabase.typeMapping.read(
            DriftSqlType.dateTime,
            data['${effectivePrefix}created_at'],
          )!,
      note: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}note'],
      ),
    );
  }

  @override
  $TicketsTableTable createAlias(String alias) {
    return $TicketsTableTable(attachedDatabase, alias);
  }
}

class TicketsTableData extends DataClass
    implements Insertable<TicketsTableData> {
  final String id;
  final String numbers;
  final DateTime drawDate;
  final DateTime createdAt;
  final String? note;
  const TicketsTableData({
    required this.id,
    required this.numbers,
    required this.drawDate,
    required this.createdAt,
    this.note,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<String>(id);
    map['numbers'] = Variable<String>(numbers);
    map['draw_date'] = Variable<DateTime>(drawDate);
    map['created_at'] = Variable<DateTime>(createdAt);
    if (!nullToAbsent || note != null) {
      map['note'] = Variable<String>(note);
    }
    return map;
  }

  TicketsTableCompanion toCompanion(bool nullToAbsent) {
    return TicketsTableCompanion(
      id: Value(id),
      numbers: Value(numbers),
      drawDate: Value(drawDate),
      createdAt: Value(createdAt),
      note: note == null && nullToAbsent ? const Value.absent() : Value(note),
    );
  }

  factory TicketsTableData.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return TicketsTableData(
      id: serializer.fromJson<String>(json['id']),
      numbers: serializer.fromJson<String>(json['numbers']),
      drawDate: serializer.fromJson<DateTime>(json['drawDate']),
      createdAt: serializer.fromJson<DateTime>(json['createdAt']),
      note: serializer.fromJson<String?>(json['note']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<String>(id),
      'numbers': serializer.toJson<String>(numbers),
      'drawDate': serializer.toJson<DateTime>(drawDate),
      'createdAt': serializer.toJson<DateTime>(createdAt),
      'note': serializer.toJson<String?>(note),
    };
  }

  TicketsTableData copyWith({
    String? id,
    String? numbers,
    DateTime? drawDate,
    DateTime? createdAt,
    Value<String?> note = const Value.absent(),
  }) => TicketsTableData(
    id: id ?? this.id,
    numbers: numbers ?? this.numbers,
    drawDate: drawDate ?? this.drawDate,
    createdAt: createdAt ?? this.createdAt,
    note: note.present ? note.value : this.note,
  );
  TicketsTableData copyWithCompanion(TicketsTableCompanion data) {
    return TicketsTableData(
      id: data.id.present ? data.id.value : this.id,
      numbers: data.numbers.present ? data.numbers.value : this.numbers,
      drawDate: data.drawDate.present ? data.drawDate.value : this.drawDate,
      createdAt: data.createdAt.present ? data.createdAt.value : this.createdAt,
      note: data.note.present ? data.note.value : this.note,
    );
  }

  @override
  String toString() {
    return (StringBuffer('TicketsTableData(')
          ..write('id: $id, ')
          ..write('numbers: $numbers, ')
          ..write('drawDate: $drawDate, ')
          ..write('createdAt: $createdAt, ')
          ..write('note: $note')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(id, numbers, drawDate, createdAt, note);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is TicketsTableData &&
          other.id == this.id &&
          other.numbers == this.numbers &&
          other.drawDate == this.drawDate &&
          other.createdAt == this.createdAt &&
          other.note == this.note);
}

class TicketsTableCompanion extends UpdateCompanion<TicketsTableData> {
  final Value<String> id;
  final Value<String> numbers;
  final Value<DateTime> drawDate;
  final Value<DateTime> createdAt;
  final Value<String?> note;
  final Value<int> rowid;
  const TicketsTableCompanion({
    this.id = const Value.absent(),
    this.numbers = const Value.absent(),
    this.drawDate = const Value.absent(),
    this.createdAt = const Value.absent(),
    this.note = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  TicketsTableCompanion.insert({
    required String id,
    required String numbers,
    required DateTime drawDate,
    required DateTime createdAt,
    this.note = const Value.absent(),
    this.rowid = const Value.absent(),
  }) : id = Value(id),
       numbers = Value(numbers),
       drawDate = Value(drawDate),
       createdAt = Value(createdAt);
  static Insertable<TicketsTableData> custom({
    Expression<String>? id,
    Expression<String>? numbers,
    Expression<DateTime>? drawDate,
    Expression<DateTime>? createdAt,
    Expression<String>? note,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (numbers != null) 'numbers': numbers,
      if (drawDate != null) 'draw_date': drawDate,
      if (createdAt != null) 'created_at': createdAt,
      if (note != null) 'note': note,
      if (rowid != null) 'rowid': rowid,
    });
  }

  TicketsTableCompanion copyWith({
    Value<String>? id,
    Value<String>? numbers,
    Value<DateTime>? drawDate,
    Value<DateTime>? createdAt,
    Value<String?>? note,
    Value<int>? rowid,
  }) {
    return TicketsTableCompanion(
      id: id ?? this.id,
      numbers: numbers ?? this.numbers,
      drawDate: drawDate ?? this.drawDate,
      createdAt: createdAt ?? this.createdAt,
      note: note ?? this.note,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<String>(id.value);
    }
    if (numbers.present) {
      map['numbers'] = Variable<String>(numbers.value);
    }
    if (drawDate.present) {
      map['draw_date'] = Variable<DateTime>(drawDate.value);
    }
    if (createdAt.present) {
      map['created_at'] = Variable<DateTime>(createdAt.value);
    }
    if (note.present) {
      map['note'] = Variable<String>(note.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('TicketsTableCompanion(')
          ..write('id: $id, ')
          ..write('numbers: $numbers, ')
          ..write('drawDate: $drawDate, ')
          ..write('createdAt: $createdAt, ')
          ..write('note: $note, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $DrawsTableTable extends DrawsTable
    with TableInfo<$DrawsTableTable, DrawsTableData> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $DrawsTableTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _drawDateMeta = const VerificationMeta(
    'drawDate',
  );
  @override
  late final GeneratedColumn<DateTime> drawDate = GeneratedColumn<DateTime>(
    'draw_date',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _fetchedAtMeta = const VerificationMeta(
    'fetchedAt',
  );
  @override
  late final GeneratedColumn<DateTime> fetchedAt = GeneratedColumn<DateTime>(
    'fetched_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _prizesJsonMeta = const VerificationMeta(
    'prizesJson',
  );
  @override
  late final GeneratedColumn<String> prizesJson = GeneratedColumn<String>(
    'prizes_json',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _winningNumbersJsonMeta =
      const VerificationMeta('winningNumbersJson');
  @override
  late final GeneratedColumn<String> winningNumbersJson =
      GeneratedColumn<String>(
        'winning_numbers_json',
        aliasedName,
        false,
        type: DriftSqlType.string,
        requiredDuringInsert: true,
      );
  @override
  List<GeneratedColumn> get $columns => [
    drawDate,
    fetchedAt,
    prizesJson,
    winningNumbersJson,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'draws';
  @override
  VerificationContext validateIntegrity(
    Insertable<DrawsTableData> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('draw_date')) {
      context.handle(
        _drawDateMeta,
        drawDate.isAcceptableOrUnknown(data['draw_date']!, _drawDateMeta),
      );
    } else if (isInserting) {
      context.missing(_drawDateMeta);
    }
    if (data.containsKey('fetched_at')) {
      context.handle(
        _fetchedAtMeta,
        fetchedAt.isAcceptableOrUnknown(data['fetched_at']!, _fetchedAtMeta),
      );
    } else if (isInserting) {
      context.missing(_fetchedAtMeta);
    }
    if (data.containsKey('prizes_json')) {
      context.handle(
        _prizesJsonMeta,
        prizesJson.isAcceptableOrUnknown(data['prizes_json']!, _prizesJsonMeta),
      );
    } else if (isInserting) {
      context.missing(_prizesJsonMeta);
    }
    if (data.containsKey('winning_numbers_json')) {
      context.handle(
        _winningNumbersJsonMeta,
        winningNumbersJson.isAcceptableOrUnknown(
          data['winning_numbers_json']!,
          _winningNumbersJsonMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_winningNumbersJsonMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {drawDate};
  @override
  DrawsTableData map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return DrawsTableData(
      drawDate:
          attachedDatabase.typeMapping.read(
            DriftSqlType.dateTime,
            data['${effectivePrefix}draw_date'],
          )!,
      fetchedAt:
          attachedDatabase.typeMapping.read(
            DriftSqlType.dateTime,
            data['${effectivePrefix}fetched_at'],
          )!,
      prizesJson:
          attachedDatabase.typeMapping.read(
            DriftSqlType.string,
            data['${effectivePrefix}prizes_json'],
          )!,
      winningNumbersJson:
          attachedDatabase.typeMapping.read(
            DriftSqlType.string,
            data['${effectivePrefix}winning_numbers_json'],
          )!,
    );
  }

  @override
  $DrawsTableTable createAlias(String alias) {
    return $DrawsTableTable(attachedDatabase, alias);
  }
}

class DrawsTableData extends DataClass implements Insertable<DrawsTableData> {
  final DateTime drawDate;
  final DateTime fetchedAt;
  final String prizesJson;
  final String winningNumbersJson;
  const DrawsTableData({
    required this.drawDate,
    required this.fetchedAt,
    required this.prizesJson,
    required this.winningNumbersJson,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['draw_date'] = Variable<DateTime>(drawDate);
    map['fetched_at'] = Variable<DateTime>(fetchedAt);
    map['prizes_json'] = Variable<String>(prizesJson);
    map['winning_numbers_json'] = Variable<String>(winningNumbersJson);
    return map;
  }

  DrawsTableCompanion toCompanion(bool nullToAbsent) {
    return DrawsTableCompanion(
      drawDate: Value(drawDate),
      fetchedAt: Value(fetchedAt),
      prizesJson: Value(prizesJson),
      winningNumbersJson: Value(winningNumbersJson),
    );
  }

  factory DrawsTableData.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return DrawsTableData(
      drawDate: serializer.fromJson<DateTime>(json['drawDate']),
      fetchedAt: serializer.fromJson<DateTime>(json['fetchedAt']),
      prizesJson: serializer.fromJson<String>(json['prizesJson']),
      winningNumbersJson: serializer.fromJson<String>(
        json['winningNumbersJson'],
      ),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'drawDate': serializer.toJson<DateTime>(drawDate),
      'fetchedAt': serializer.toJson<DateTime>(fetchedAt),
      'prizesJson': serializer.toJson<String>(prizesJson),
      'winningNumbersJson': serializer.toJson<String>(winningNumbersJson),
    };
  }

  DrawsTableData copyWith({
    DateTime? drawDate,
    DateTime? fetchedAt,
    String? prizesJson,
    String? winningNumbersJson,
  }) => DrawsTableData(
    drawDate: drawDate ?? this.drawDate,
    fetchedAt: fetchedAt ?? this.fetchedAt,
    prizesJson: prizesJson ?? this.prizesJson,
    winningNumbersJson: winningNumbersJson ?? this.winningNumbersJson,
  );
  DrawsTableData copyWithCompanion(DrawsTableCompanion data) {
    return DrawsTableData(
      drawDate: data.drawDate.present ? data.drawDate.value : this.drawDate,
      fetchedAt: data.fetchedAt.present ? data.fetchedAt.value : this.fetchedAt,
      prizesJson:
          data.prizesJson.present ? data.prizesJson.value : this.prizesJson,
      winningNumbersJson:
          data.winningNumbersJson.present
              ? data.winningNumbersJson.value
              : this.winningNumbersJson,
    );
  }

  @override
  String toString() {
    return (StringBuffer('DrawsTableData(')
          ..write('drawDate: $drawDate, ')
          ..write('fetchedAt: $fetchedAt, ')
          ..write('prizesJson: $prizesJson, ')
          ..write('winningNumbersJson: $winningNumbersJson')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode =>
      Object.hash(drawDate, fetchedAt, prizesJson, winningNumbersJson);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is DrawsTableData &&
          other.drawDate == this.drawDate &&
          other.fetchedAt == this.fetchedAt &&
          other.prizesJson == this.prizesJson &&
          other.winningNumbersJson == this.winningNumbersJson);
}

class DrawsTableCompanion extends UpdateCompanion<DrawsTableData> {
  final Value<DateTime> drawDate;
  final Value<DateTime> fetchedAt;
  final Value<String> prizesJson;
  final Value<String> winningNumbersJson;
  final Value<int> rowid;
  const DrawsTableCompanion({
    this.drawDate = const Value.absent(),
    this.fetchedAt = const Value.absent(),
    this.prizesJson = const Value.absent(),
    this.winningNumbersJson = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  DrawsTableCompanion.insert({
    required DateTime drawDate,
    required DateTime fetchedAt,
    required String prizesJson,
    required String winningNumbersJson,
    this.rowid = const Value.absent(),
  }) : drawDate = Value(drawDate),
       fetchedAt = Value(fetchedAt),
       prizesJson = Value(prizesJson),
       winningNumbersJson = Value(winningNumbersJson);
  static Insertable<DrawsTableData> custom({
    Expression<DateTime>? drawDate,
    Expression<DateTime>? fetchedAt,
    Expression<String>? prizesJson,
    Expression<String>? winningNumbersJson,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (drawDate != null) 'draw_date': drawDate,
      if (fetchedAt != null) 'fetched_at': fetchedAt,
      if (prizesJson != null) 'prizes_json': prizesJson,
      if (winningNumbersJson != null)
        'winning_numbers_json': winningNumbersJson,
      if (rowid != null) 'rowid': rowid,
    });
  }

  DrawsTableCompanion copyWith({
    Value<DateTime>? drawDate,
    Value<DateTime>? fetchedAt,
    Value<String>? prizesJson,
    Value<String>? winningNumbersJson,
    Value<int>? rowid,
  }) {
    return DrawsTableCompanion(
      drawDate: drawDate ?? this.drawDate,
      fetchedAt: fetchedAt ?? this.fetchedAt,
      prizesJson: prizesJson ?? this.prizesJson,
      winningNumbersJson: winningNumbersJson ?? this.winningNumbersJson,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (drawDate.present) {
      map['draw_date'] = Variable<DateTime>(drawDate.value);
    }
    if (fetchedAt.present) {
      map['fetched_at'] = Variable<DateTime>(fetchedAt.value);
    }
    if (prizesJson.present) {
      map['prizes_json'] = Variable<String>(prizesJson.value);
    }
    if (winningNumbersJson.present) {
      map['winning_numbers_json'] = Variable<String>(winningNumbersJson.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('DrawsTableCompanion(')
          ..write('drawDate: $drawDate, ')
          ..write('fetchedAt: $fetchedAt, ')
          ..write('prizesJson: $prizesJson, ')
          ..write('winningNumbersJson: $winningNumbersJson, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

abstract class _$AppDatabase extends GeneratedDatabase {
  _$AppDatabase(QueryExecutor e) : super(e);
  $AppDatabaseManager get managers => $AppDatabaseManager(this);
  late final $TicketsTableTable ticketsTable = $TicketsTableTable(this);
  late final $DrawsTableTable drawsTable = $DrawsTableTable(this);
  @override
  Iterable<TableInfo<Table, Object?>> get allTables =>
      allSchemaEntities.whereType<TableInfo<Table, Object?>>();
  @override
  List<DatabaseSchemaEntity> get allSchemaEntities => [
    ticketsTable,
    drawsTable,
  ];
}

typedef $$TicketsTableTableCreateCompanionBuilder =
    TicketsTableCompanion Function({
      required String id,
      required String numbers,
      required DateTime drawDate,
      required DateTime createdAt,
      Value<String?> note,
      Value<int> rowid,
    });
typedef $$TicketsTableTableUpdateCompanionBuilder =
    TicketsTableCompanion Function({
      Value<String> id,
      Value<String> numbers,
      Value<DateTime> drawDate,
      Value<DateTime> createdAt,
      Value<String?> note,
      Value<int> rowid,
    });

class $$TicketsTableTableFilterComposer
    extends Composer<_$AppDatabase, $TicketsTableTable> {
  $$TicketsTableTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get numbers => $composableBuilder(
    column: $table.numbers,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get drawDate => $composableBuilder(
    column: $table.drawDate,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get createdAt => $composableBuilder(
    column: $table.createdAt,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get note => $composableBuilder(
    column: $table.note,
    builder: (column) => ColumnFilters(column),
  );
}

class $$TicketsTableTableOrderingComposer
    extends Composer<_$AppDatabase, $TicketsTableTable> {
  $$TicketsTableTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get numbers => $composableBuilder(
    column: $table.numbers,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get drawDate => $composableBuilder(
    column: $table.drawDate,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get createdAt => $composableBuilder(
    column: $table.createdAt,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get note => $composableBuilder(
    column: $table.note,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$TicketsTableTableAnnotationComposer
    extends Composer<_$AppDatabase, $TicketsTableTable> {
  $$TicketsTableTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get numbers =>
      $composableBuilder(column: $table.numbers, builder: (column) => column);

  GeneratedColumn<DateTime> get drawDate =>
      $composableBuilder(column: $table.drawDate, builder: (column) => column);

  GeneratedColumn<DateTime> get createdAt =>
      $composableBuilder(column: $table.createdAt, builder: (column) => column);

  GeneratedColumn<String> get note =>
      $composableBuilder(column: $table.note, builder: (column) => column);
}

class $$TicketsTableTableTableManager
    extends
        RootTableManager<
          _$AppDatabase,
          $TicketsTableTable,
          TicketsTableData,
          $$TicketsTableTableFilterComposer,
          $$TicketsTableTableOrderingComposer,
          $$TicketsTableTableAnnotationComposer,
          $$TicketsTableTableCreateCompanionBuilder,
          $$TicketsTableTableUpdateCompanionBuilder,
          (
            TicketsTableData,
            BaseReferences<_$AppDatabase, $TicketsTableTable, TicketsTableData>,
          ),
          TicketsTableData,
          PrefetchHooks Function()
        > {
  $$TicketsTableTableTableManager(_$AppDatabase db, $TicketsTableTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer:
              () => $$TicketsTableTableFilterComposer($db: db, $table: table),
          createOrderingComposer:
              () => $$TicketsTableTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer:
              () =>
                  $$TicketsTableTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> id = const Value.absent(),
                Value<String> numbers = const Value.absent(),
                Value<DateTime> drawDate = const Value.absent(),
                Value<DateTime> createdAt = const Value.absent(),
                Value<String?> note = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => TicketsTableCompanion(
                id: id,
                numbers: numbers,
                drawDate: drawDate,
                createdAt: createdAt,
                note: note,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String id,
                required String numbers,
                required DateTime drawDate,
                required DateTime createdAt,
                Value<String?> note = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => TicketsTableCompanion.insert(
                id: id,
                numbers: numbers,
                drawDate: drawDate,
                createdAt: createdAt,
                note: note,
                rowid: rowid,
              ),
          withReferenceMapper:
              (p0) =>
                  p0
                      .map(
                        (e) => (
                          e.readTable(table),
                          BaseReferences(db, table, e),
                        ),
                      )
                      .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$TicketsTableTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDatabase,
      $TicketsTableTable,
      TicketsTableData,
      $$TicketsTableTableFilterComposer,
      $$TicketsTableTableOrderingComposer,
      $$TicketsTableTableAnnotationComposer,
      $$TicketsTableTableCreateCompanionBuilder,
      $$TicketsTableTableUpdateCompanionBuilder,
      (
        TicketsTableData,
        BaseReferences<_$AppDatabase, $TicketsTableTable, TicketsTableData>,
      ),
      TicketsTableData,
      PrefetchHooks Function()
    >;
typedef $$DrawsTableTableCreateCompanionBuilder =
    DrawsTableCompanion Function({
      required DateTime drawDate,
      required DateTime fetchedAt,
      required String prizesJson,
      required String winningNumbersJson,
      Value<int> rowid,
    });
typedef $$DrawsTableTableUpdateCompanionBuilder =
    DrawsTableCompanion Function({
      Value<DateTime> drawDate,
      Value<DateTime> fetchedAt,
      Value<String> prizesJson,
      Value<String> winningNumbersJson,
      Value<int> rowid,
    });

class $$DrawsTableTableFilterComposer
    extends Composer<_$AppDatabase, $DrawsTableTable> {
  $$DrawsTableTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<DateTime> get drawDate => $composableBuilder(
    column: $table.drawDate,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get fetchedAt => $composableBuilder(
    column: $table.fetchedAt,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get prizesJson => $composableBuilder(
    column: $table.prizesJson,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get winningNumbersJson => $composableBuilder(
    column: $table.winningNumbersJson,
    builder: (column) => ColumnFilters(column),
  );
}

class $$DrawsTableTableOrderingComposer
    extends Composer<_$AppDatabase, $DrawsTableTable> {
  $$DrawsTableTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<DateTime> get drawDate => $composableBuilder(
    column: $table.drawDate,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get fetchedAt => $composableBuilder(
    column: $table.fetchedAt,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get prizesJson => $composableBuilder(
    column: $table.prizesJson,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get winningNumbersJson => $composableBuilder(
    column: $table.winningNumbersJson,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$DrawsTableTableAnnotationComposer
    extends Composer<_$AppDatabase, $DrawsTableTable> {
  $$DrawsTableTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<DateTime> get drawDate =>
      $composableBuilder(column: $table.drawDate, builder: (column) => column);

  GeneratedColumn<DateTime> get fetchedAt =>
      $composableBuilder(column: $table.fetchedAt, builder: (column) => column);

  GeneratedColumn<String> get prizesJson => $composableBuilder(
    column: $table.prizesJson,
    builder: (column) => column,
  );

  GeneratedColumn<String> get winningNumbersJson => $composableBuilder(
    column: $table.winningNumbersJson,
    builder: (column) => column,
  );
}

class $$DrawsTableTableTableManager
    extends
        RootTableManager<
          _$AppDatabase,
          $DrawsTableTable,
          DrawsTableData,
          $$DrawsTableTableFilterComposer,
          $$DrawsTableTableOrderingComposer,
          $$DrawsTableTableAnnotationComposer,
          $$DrawsTableTableCreateCompanionBuilder,
          $$DrawsTableTableUpdateCompanionBuilder,
          (
            DrawsTableData,
            BaseReferences<_$AppDatabase, $DrawsTableTable, DrawsTableData>,
          ),
          DrawsTableData,
          PrefetchHooks Function()
        > {
  $$DrawsTableTableTableManager(_$AppDatabase db, $DrawsTableTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer:
              () => $$DrawsTableTableFilterComposer($db: db, $table: table),
          createOrderingComposer:
              () => $$DrawsTableTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer:
              () => $$DrawsTableTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<DateTime> drawDate = const Value.absent(),
                Value<DateTime> fetchedAt = const Value.absent(),
                Value<String> prizesJson = const Value.absent(),
                Value<String> winningNumbersJson = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => DrawsTableCompanion(
                drawDate: drawDate,
                fetchedAt: fetchedAt,
                prizesJson: prizesJson,
                winningNumbersJson: winningNumbersJson,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required DateTime drawDate,
                required DateTime fetchedAt,
                required String prizesJson,
                required String winningNumbersJson,
                Value<int> rowid = const Value.absent(),
              }) => DrawsTableCompanion.insert(
                drawDate: drawDate,
                fetchedAt: fetchedAt,
                prizesJson: prizesJson,
                winningNumbersJson: winningNumbersJson,
                rowid: rowid,
              ),
          withReferenceMapper:
              (p0) =>
                  p0
                      .map(
                        (e) => (
                          e.readTable(table),
                          BaseReferences(db, table, e),
                        ),
                      )
                      .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$DrawsTableTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDatabase,
      $DrawsTableTable,
      DrawsTableData,
      $$DrawsTableTableFilterComposer,
      $$DrawsTableTableOrderingComposer,
      $$DrawsTableTableAnnotationComposer,
      $$DrawsTableTableCreateCompanionBuilder,
      $$DrawsTableTableUpdateCompanionBuilder,
      (
        DrawsTableData,
        BaseReferences<_$AppDatabase, $DrawsTableTable, DrawsTableData>,
      ),
      DrawsTableData,
      PrefetchHooks Function()
    >;

class $AppDatabaseManager {
  final _$AppDatabase _db;
  $AppDatabaseManager(this._db);
  $$TicketsTableTableTableManager get ticketsTable =>
      $$TicketsTableTableTableManager(_db, _db.ticketsTable);
  $$DrawsTableTableTableManager get drawsTable =>
      $$DrawsTableTableTableManager(_db, _db.drawsTable);
}
