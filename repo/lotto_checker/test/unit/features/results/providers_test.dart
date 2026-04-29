import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lotto_checker/features/results/data/draw_repository.dart';
import 'package:lotto_checker/features/results/data/providers.dart';
import 'package:lotto_checker/features/results/data/sources/fixture_data_source.dart';
import 'package:lotto_checker/features/results/data/sources/lottery_data_source.dart';
import 'package:lotto_checker/features/results/data/sync_service.dart';
import 'package:lotto_checker/features/tickets/data/providers.dart';
import 'package:lotto_checker/shared/models/draw.dart';
import 'package:lotto_checker/shared/models/prize.dart';

import '../../../fixtures/draws.dart';
import '../../../helpers/in_memory_db.dart';

void main() {
  group('results providers (Riverpod wiring)', () {
    test('drawRepositoryProvider routes through overridden appDatabase',
        () async {
      final db = makeInMemoryDatabase();
      addTearDown(db.close);
      final container = ProviderContainer(
        overrides: [appDatabaseProvider.overrideWithValue(db)],
      );
      addTearDown(container.dispose);

      final repo = container.read(drawRepositoryProvider);
      expect(repo, isA<DrawRepository>());

      await repo.save(fixtureDraw());
      final stored = await repo.getByDate(DateTime.utc(2026, 4, 16));
      expect(stored, isNotNull);
      expect(stored!.winningNumbers[PrizeTier.first], ['123456']);
    });

    test('drawRepositoryProvider returns a stable instance', () {
      final db = makeInMemoryDatabase();
      addTearDown(db.close);
      final container = ProviderContainer(
        overrides: [appDatabaseProvider.overrideWithValue(db)],
      );
      addTearDown(container.dispose);

      final first = container.read(drawRepositoryProvider);
      final second = container.read(drawRepositoryProvider);
      expect(identical(first, second), isTrue);
    });

    test('drawSyncServiceProvider composes overridden source + repository',
        () async {
      final db = makeInMemoryDatabase();
      addTearDown(db.close);
      final fixture = FixtureDataSource(draws: {
        DateTime.utc(2026, 4, 16): fixtureDraw(),
      },);
      final container = ProviderContainer(
        overrides: [
          appDatabaseProvider.overrideWithValue(db),
          lotteryDataSourceProvider.overrideWithValue(fixture),
        ],
      );
      addTearDown(container.dispose);

      final svc = container.read(drawSyncServiceProvider);
      expect(svc, isA<DrawSyncService>());

      final draw = await svc.refreshLatest();
      expect(draw.winningNumbers[PrizeTier.first], ['123456']);
    });

    test('latestDrawProvider resolves to a refreshed Draw', () async {
      final db = makeInMemoryDatabase();
      addTearDown(db.close);
      final fixture = FixtureDataSource(draws: {
        DateTime.utc(2026, 4, 16): fixtureDraw(),
      },);
      final container = ProviderContainer(
        overrides: [
          appDatabaseProvider.overrideWithValue(db),
          lotteryDataSourceProvider.overrideWithValue(fixture),
        ],
      );
      addTearDown(container.dispose);

      final draw = await container.read(latestDrawProvider.future);
      expect(draw, isA<Draw>());
      expect(draw.winningNumbers[PrizeTier.first], ['123456']);
    });

    test('latestDrawProvider surfaces FetchException via AsyncError', () async {
      final db = makeInMemoryDatabase();
      addTearDown(db.close);
      final container = ProviderContainer(
        overrides: [
          appDatabaseProvider.overrideWithValue(db),
          lotteryDataSourceProvider.overrideWithValue(FixtureDataSource()),
        ],
      );
      addTearDown(container.dispose);

      await expectLater(
        container.read(latestDrawProvider.future),
        throwsA(isA<FetchException>()),
      );
    });
  });
}
