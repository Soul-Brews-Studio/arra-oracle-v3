import 'package:flutter_test/flutter_test.dart';
import 'package:lotto_checker/features/results/data/draw_repository.dart';
import 'package:lotto_checker/features/results/data/sources/fixture_data_source.dart';
import 'package:lotto_checker/features/results/data/sources/lottery_data_source.dart';
import 'package:lotto_checker/features/results/data/sync_service.dart';
import 'package:lotto_checker/features/tickets/data/database/app_database.dart';
import 'package:lotto_checker/shared/models/draw.dart';
import 'package:lotto_checker/shared/models/prize.dart';
import 'package:mocktail/mocktail.dart';

import '../../../fixtures/draws.dart';
import '../../../helpers/in_memory_db.dart';

class _SpySource implements LotteryDataSource {
  _SpySource(this._delegate);
  final LotteryDataSource _delegate;
  int latestCalls = 0;
  int byDateCalls = 0;

  @override
  Future<Draw> fetchLatest() {
    latestCalls++;
    return _delegate.fetchLatest();
  }

  @override
  Future<Draw?> fetchByDate(DateTime drawDate) {
    byDateCalls++;
    return _delegate.fetchByDate(drawDate);
  }
}

class _MockSource extends Mock implements LotteryDataSource {}

class _FakeDateTime extends Fake implements DateTime {}

void main() {
  setUpAll(() {
    registerFallbackValue(_FakeDateTime());
  });

  late AppDatabase db;
  late DrawRepository repo;

  setUp(() {
    db = makeInMemoryDatabase();
    repo = DriftDrawRepository(db);
  });

  tearDown(() async {
    await db.close();
  });

  group('refreshLatest', () {
    test('fetches from source and writes to repository', () async {
      final source = FixtureDataSource(draws: {
        DateTime.utc(2026, 4, 16): fixtureDraw(),
      },);
      final svc = DrawSyncService(source: source, repository: repo);

      final draw = await svc.refreshLatest();
      expect(draw.winningNumbers[PrizeTier.first], ['123456']);

      final cached = await repo.getByDate(DateTime.utc(2026, 4, 16));
      expect(cached, isNotNull);
      expect(cached!.winningNumbers[PrizeTier.first], ['123456']);
    });

    test('always calls source even if cache is populated', () async {
      final draws = fixtureDraws();
      final source = _SpySource(FixtureDataSource(draws: {
        for (final d in draws) d.drawDate: d,
      },),);
      for (final d in draws) {
        await repo.save(d);
      }
      final svc = DrawSyncService(source: source, repository: repo);

      await svc.refreshLatest();
      expect(source.latestCalls, 1);
    });

    test('propagates FetchException when source fails', () async {
      final source = FixtureDataSource();
      final svc = DrawSyncService(source: source, repository: repo);

      await expectLater(svc.refreshLatest(), throwsA(isA<FetchException>()));
    });
  });

  group('getOrFetch — cache-first', () {
    test('returns cached draw without calling source', () async {
      final draw = fixtureDraw();
      await repo.save(draw);
      final source = _SpySource(FixtureDataSource());
      final svc = DrawSyncService(source: source, repository: repo);

      final hit = await svc.getOrFetch(draw.drawDate);
      expect(hit, isNotNull);
      expect(hit!.winningNumbers[PrizeTier.first], ['123456']);
      expect(source.byDateCalls, 0);
      expect(source.latestCalls, 0);
    });

    test('falls through to source when cache misses, then writes back',
        () async {
      final source = _SpySource(FixtureDataSource(draws: {
        DateTime.utc(2026, 4, 16): fixtureDraw(),
      },),);
      final svc = DrawSyncService(source: source, repository: repo);

      final hit = await svc.getOrFetch(DateTime.utc(2026, 4, 16));
      expect(hit, isNotNull);
      expect(source.byDateCalls, 1);

      // Now the second call should hit cache, not source.
      final secondHit = await svc.getOrFetch(DateTime.utc(2026, 4, 16));
      expect(secondHit, isNotNull);
      expect(source.byDateCalls, 1, reason: 'second call must be cached');
    });

    test('returns null when both cache and source miss', () async {
      final source = FixtureDataSource();
      final svc = DrawSyncService(source: source, repository: repo);

      final hit = await svc.getOrFetch(DateTime.utc(2026, 1, 1));
      expect(hit, isNull);
    });

    test('does not write to cache when source returns null', () async {
      final source = _MockSource();
      when(() => source.fetchByDate(any())).thenAnswer((_) async => null);
      final svc = DrawSyncService(source: source, repository: repo);

      await svc.getOrFetch(DateTime.utc(2026, 1, 1));
      expect(await repo.getLatest(), isNull);
    });
  });

  group('integration — Fixture + Drift roundtrip', () {
    test('multiple refreshLatest calls keep one row per drawDate', () async {
      final source = FixtureDataSource(draws: {
        DateTime.utc(2026, 4, 16): fixtureDraw(),
      },);
      final svc = DrawSyncService(source: source, repository: repo);

      await svc.refreshLatest();
      await svc.refreshLatest();
      await svc.refreshLatest();
      expect((await repo.watchAll().first).length, 1);
    });

    test('latest after several puts is the highest date', () async {
      final source = FixtureDataSource(draws: {
        for (final d in fixtureDraws()) d.drawDate: d,
      },);
      final svc = DrawSyncService(source: source, repository: repo);

      await svc.refreshLatest();
      final latest = await repo.getLatest();
      expect(latest!.winningNumbers[PrizeTier.first], ['333333']);
    });
  });
}
