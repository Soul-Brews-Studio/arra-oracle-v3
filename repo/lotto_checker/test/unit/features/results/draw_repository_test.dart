import 'package:flutter_test/flutter_test.dart';
import 'package:lotto_checker/features/results/data/draw_repository.dart';
import 'package:lotto_checker/features/tickets/data/database/app_database.dart';
import 'package:lotto_checker/shared/models/draw.dart';
import 'package:lotto_checker/shared/models/prize.dart';

import '../../../fixtures/draws.dart';
import '../../../helpers/in_memory_db.dart';

void main() {
  late AppDatabase db;
  late DrawRepository repo;

  setUp(() {
    db = makeInMemoryDatabase();
    repo = DriftDrawRepository(db);
  });

  tearDown(() async {
    await db.close();
  });

  group('save', () {
    test('inserts a new draw', () async {
      final draw = fixtureDraw();
      await repo.save(draw);
      final stored = await repo.getByDate(draw.drawDate);
      expect(stored, drawEquals(draw));
    });

    test('upsert: saving same drawDate twice replaces fields', () async {
      final original = fixtureDraw(
        drawDate: DateTime.utc(2026, 4, 16),
        winningNumbers: const {
          PrizeTier.first: ['111111'],
        },
        prizes: const {'first': '111111'},
      );
      await repo.save(original);
      final updated = fixtureDraw(
        drawDate: DateTime.utc(2026, 4, 16),
        winningNumbers: const {
          PrizeTier.first: ['999999'],
        },
        prizes: const {'first': '999999'},
      );
      await repo.save(updated);
      final stored = await repo.getByDate(original.drawDate);
      expect(stored, drawEquals(updated));
      expect((await repo.watchAll().first).length, 1);
    });

    test('persists complex winningNumbers (all 9 tiers) intact', () async {
      final draw = fixtureDraw();
      await repo.save(draw);
      final stored = await repo.getByDate(draw.drawDate);
      expect(stored!.winningNumbers.length, 9);
      expect(stored.winningNumbers[PrizeTier.third]!.length, 10);
      expect(stored.winningNumbers[PrizeTier.twoDigitBack], ['56']);
    });

    test('persists prizes map intact', () async {
      final draw = fixtureDraw();
      await repo.save(draw);
      final stored = await repo.getByDate(draw.drawDate);
      expect(stored!.prizes['first'], '123456');
      expect(stored.prizes.length, draw.prizes.length);
    });
  });

  group('getByDate', () {
    test('returns null when date is missing', () async {
      expect(await repo.getByDate(DateTime.utc(2099, 1, 1)), isNull);
    });

    test('returns the matching draw', () async {
      final draw = fixtureDraw(drawDate: DateTime.utc(2026, 5, 1));
      await repo.save(draw);
      final hit = await repo.getByDate(DateTime.utc(2026, 5, 1));
      expect(hit, isNotNull);
      expect(hit!.drawDate.isAtSameMomentAs(DateTime.utc(2026, 5, 1)), isTrue);
    });
  });

  group('getLatest', () {
    test('returns null when empty', () async {
      expect(await repo.getLatest(), isNull);
    });

    test('returns the draw with the latest date', () async {
      for (final d in fixtureDraws()) {
        await repo.save(d);
      }
      final latest = await repo.getLatest();
      expect(latest!.winningNumbers[PrizeTier.first], ['333333']);
    });

    test('latest reflects new save', () async {
      await repo.save(fixtureDraw(
        drawDate: DateTime.utc(2026, 4, 16),
        winningNumbers: const {
          PrizeTier.first: ['111111'],
        },
        prizes: const {'first': '111111'},
      ),);
      expect((await repo.getLatest())!.drawDate.year, 2026);
      await repo.save(fixtureDraw(
        drawDate: DateTime.utc(2027, 1, 1),
        winningNumbers: const {
          PrizeTier.first: ['000001'],
        },
        prizes: const {'first': '000001'},
      ),);
      expect((await repo.getLatest())!.drawDate.year, 2027);
    });
  });

  group('watchAll', () {
    test('emits empty list initially', () async {
      await expectLater(
        repo.watchAll(),
        emits(isA<List<Draw>>().having((l) => l.length, 'length', 0)),
      );
    });

    test('orders by drawDate desc', () async {
      for (final d in fixtureDraws()) {
        await repo.save(d);
      }
      final list = await repo.watchAll().first;
      final dates = list.map((d) => d.drawDate.month).toList();
      expect(dates, [5, 5, 4]);
      expect(list.first.drawDate.day, 16);
    });

    test('emits updated list when a draw is saved', () async {
      final stream = repo.watchAll();
      final later = expectLater(
        stream,
        emitsInOrder([
          isA<List<Draw>>().having((l) => l.length, 'length', 0),
          isA<List<Draw>>().having((l) => l.length, 'length', 1),
        ]),
      );
      await Future<void>.delayed(Duration.zero);
      await repo.save(fixtureDraw());
      await later;
    });
  });

  group('deleteOlderThan', () {
    test('removes only draws older than retention cutoff', () async {
      final ancient = fixtureDraw(
        drawDate: DateTime.now().subtract(const Duration(days: 365)),
        winningNumbers: const {
          PrizeTier.first: ['111111'],
        },
        prizes: const {'first': '111111'},
      );
      final recent = fixtureDraw(
        drawDate: DateTime.now().subtract(const Duration(days: 1)),
        winningNumbers: const {
          PrizeTier.first: ['222222'],
        },
        prizes: const {'first': '222222'},
      );
      await repo.save(ancient);
      await repo.save(recent);

      await repo.deleteOlderThan(const Duration(days: 30));
      final remaining = await repo.watchAll().first;
      expect(remaining.length, 1);
      expect(remaining.single.winningNumbers[PrizeTier.first], ['222222']);
    });

    test('is a no-op when nothing is older', () async {
      final recent = fixtureDraw(
        drawDate: DateTime.now().subtract(const Duration(hours: 1)),
      );
      await repo.save(recent);
      await repo.deleteOlderThan(const Duration(days: 365));
      expect((await repo.watchAll().first).length, 1);
    });

    test('removes everything when retention is zero', () async {
      // Use only past-dated draws so deleteOlderThan(0) sweeps them all.
      final now = DateTime.now();
      for (var i = 1; i <= 3; i++) {
        await repo.save(fixtureDraw(
          drawDate: now.subtract(Duration(days: i * 7)),
          winningNumbers: {
            PrizeTier.first: ['00000$i'],
          },
          prizes: {'first': '00000$i'},
        ),);
      }
      await repo.deleteOlderThan(Duration.zero);
      expect((await repo.watchAll().first), isEmpty);
    });
  });
}
