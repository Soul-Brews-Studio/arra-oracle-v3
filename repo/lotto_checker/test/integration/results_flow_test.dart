import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lotto_checker/features/results/application/providers.dart';
import 'package:lotto_checker/features/results/data/providers.dart';
import 'package:lotto_checker/features/results/data/sources/fixture_data_source.dart';
import 'package:lotto_checker/features/results/domain/match_result.dart';
import 'package:lotto_checker/features/tickets/data/providers.dart';
import 'package:lotto_checker/shared/models/prize.dart';

import '../fixtures/draws.dart';
import '../fixtures/tickets.dart';
import '../helpers/in_memory_db.dart';

ProviderContainer _buildContainer({FixtureDataSource? source}) {
  final db = makeInMemoryDatabase();
  addTearDown(db.close);
  final container = ProviderContainer(
    overrides: [
      appDatabaseProvider.overrideWithValue(db),
      lotteryDataSourceProvider.overrideWithValue(
        source ?? FixtureDataSource(),
      ),
    ],
  );
  addTearDown(container.dispose);
  return container;
}

FixtureDataSource _draws({
  Map<PrizeTier, List<String>>? winners,
  Map<String, String>? rawPrizes,
}) {
  return FixtureDataSource(
    draws: {
      DateTime.utc(2026, 5, 1): fixtureDraw(
        drawDate: DateTime.utc(2026, 5, 1),
        winningNumbers: winners ??
            const {
              PrizeTier.first: ['123456'],
              PrizeTier.threeDigitBack: ['456'],
            },
        prizes: rawPrizes ??
            const {
              'first': '123456',
              'threeDigitBack': '456',
            },
      ),
    },
  );
}

void main() {
  test('happy path: save tickets → service returns matches end-to-end',
      () async {
    final container = _buildContainer(source: _draws());
    final repo = container.read(ticketRepositoryProvider);

    await repo.save(
      fixtureTicket(
        id: 'win',
        numbers: '123456',
        drawDate: DateTime.utc(2026, 5, 1),
      ),
    );
    await repo.save(
      fixtureTicket(
        id: 'partial',
        numbers: '789456',
        drawDate: DateTime.utc(2026, 5, 1),
      ),
    );
    await repo.save(
      fixtureTicket(
        id: 'lose',
        numbers: '999999',
        drawDate: DateTime.utc(2026, 5, 1),
      ),
    );

    final service = container.read(ticketMatchServiceProvider);
    final matches = await service.checkAll();

    expect(matches.keys, hasLength(3));
    expect(matches['win'], isA<Match>());
    expect((matches['win']! as Match).tier, PrizeTier.first);
    expect(matches['partial'], isA<Match>());
    expect((matches['partial']! as Match).tier, PrizeTier.threeDigitBack);
    expect(matches['lose'], isA<NoMatch>());

    // Cache hit on second call: draw is now persisted in repo, no source
    // refetch needed.
    final drawRepo = container.read(drawRepositoryProvider);
    expect(await drawRepo.getByDate(DateTime.utc(2026, 5, 1)), isNotNull);
  });

  test('graceful path: empty source → all tickets resolve to NoMatch',
      () async {
    final container = _buildContainer(source: FixtureDataSource());
    final repo = container.read(ticketRepositoryProvider);

    await repo.save(
      fixtureTicket(
        numbers: '123456',
        drawDate: DateTime.utc(2026, 5, 1),
      ),
    );

    final service = container.read(ticketMatchServiceProvider);
    final matches = await service.checkAll();

    expect(matches, hasLength(1));
    expect(matches.values.first, isA<NoMatch>());

    // Nothing was cached — graceful failure must not write empty rows.
    final drawRepo = container.read(drawRepositoryProvider);
    expect(await drawRepo.getByDate(DateTime.utc(2026, 5, 1)), isNull);
  });

  test('allTicketMatchesProvider stream stays correct across saves', () async {
    final container = _buildContainer(source: _draws());
    final repo = container.read(ticketRepositoryProvider);

    container.listen<AsyncValue<Map<String, MatchResult>>>(
      allTicketMatchesProvider,
      (_, __) {},
    );

    AsyncValue<Map<String, MatchResult>> snap;
    snap = container.read(allTicketMatchesProvider);
    for (var i = 0; i < 30 && snap.isLoading; i++) {
      await Future<void>.delayed(const Duration(milliseconds: 20));
      snap = container.read(allTicketMatchesProvider);
    }
    expect(snap.value, isEmpty);

    await repo.save(
      fixtureTicket(
        numbers: '123456',
        drawDate: DateTime.utc(2026, 5, 1),
      ),
    );

    snap = container.read(allTicketMatchesProvider);
    for (var i = 0; i < 30 &&
            (snap.isLoading || (snap.value?.isEmpty ?? true));
        i++) {
      await Future<void>.delayed(const Duration(milliseconds: 30));
      snap = container.read(allTicketMatchesProvider);
    }
    expect(snap.value!.length, 1);
    expect(snap.value!.values.first, isA<Match>());
    expect((snap.value!.values.first as Match).tier, PrizeTier.first);
  });
}
