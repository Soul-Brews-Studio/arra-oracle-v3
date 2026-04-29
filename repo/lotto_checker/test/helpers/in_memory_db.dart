import 'package:drift/native.dart';
import 'package:lotto_checker/features/tickets/data/database/app_database.dart';

/// Build a fresh, isolated [AppDatabase] backed by an in-memory SQLite engine.
///
/// Used in unit tests so each test runs against a clean schema with no disk
/// state. Caller must `db.close()` in `tearDown`.
AppDatabase makeInMemoryDatabase() => AppDatabase(NativeDatabase.memory());
