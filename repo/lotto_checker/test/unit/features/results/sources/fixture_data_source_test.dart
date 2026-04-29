import 'package:flutter_test/flutter_test.dart';
import 'package:lotto_checker/features/results/data/sources/fixture_data_source.dart';
import 'package:lotto_checker/features/results/data/sources/lottery_data_source.dart';
import 'package:lotto_checker/shared/models/prize.dart';

import '../../../../fixtures/draws.dart';

void main() {
  group('FixtureDataSource — construction', () {
    test('starts empty when given no draws', () {
      final src = FixtureDataSource();
      expect(src.count, 0);
    });

    test('seeds with the provided map', () {
      final draws = fixtureDraws();
      final src = FixtureDataSource(draws: {
        for (final d in draws) d.drawDate: d,
      },);
      expect(src.count, 3);
    });

    test('normalizes seed keys to date-only — non-midnight collapses', () {
      final d = fixtureDraw(drawDate: DateTime.utc(2026, 4, 16, 14, 30));
      final src = FixtureDataSource(draws: {d.drawDate: d});
      expect(src.count, 1);
    });
  });

  group('FixtureDataSource.fetchLatest', () {
    test('throws FetchException when empty', () async {
      final src = FixtureDataSource();
      await expectLater(
        src.fetchLatest(),
        throwsA(isA<FetchException>()),
      );
    });

    test('returns the draw with the latest date', () async {
      final draws = fixtureDraws();
      final src = FixtureDataSource(draws: {
        for (final d in draws) d.drawDate: d,
      },);
      final latest = await src.fetchLatest();
      expect(latest.winningNumbers[PrizeTier.first], ['333333']);
    });

    test('latest is stable across many puts in random order', () async {
      final src = FixtureDataSource();
      for (final d in fixtureDraws().reversed) {
        src.put(d);
      }
      final latest = await src.fetchLatest();
      expect(
        latest.drawDate.isAtSameMomentAs(DateTime.utc(2026, 5, 16)),
        isTrue,
      );
    });
  });

  group('FixtureDataSource.fetchByDate', () {
    test('returns null when date not present', () async {
      final src = FixtureDataSource();
      expect(await src.fetchByDate(DateTime.utc(2026, 1, 1)), isNull);
    });

    test('returns draw when date matches exactly', () async {
      final src = FixtureDataSource();
      final d = fixtureDraw(drawDate: DateTime.utc(2026, 4, 16));
      src.put(d);
      final hit = await src.fetchByDate(DateTime.utc(2026, 4, 16));
      expect(hit, isNotNull);
      expect(hit!.winningNumbers[PrizeTier.first], ['123456']);
    });

    test('normalizes the lookup key — time component ignored', () async {
      final src = FixtureDataSource();
      src.put(fixtureDraw(drawDate: DateTime.utc(2026, 4, 16)));
      final hit = await src.fetchByDate(DateTime.utc(2026, 4, 16, 22, 45));
      expect(hit, isNotNull);
    });
  });

  group('FixtureDataSource — mutators', () {
    test('put inserts a new draw', () {
      final src = FixtureDataSource();
      src.put(fixtureDraw());
      expect(src.count, 1);
    });

    test('put replaces draw with the same normalized date', () async {
      final src = FixtureDataSource();
      src.put(fixtureDraw(
        drawDate: DateTime.utc(2026, 4, 16),
        winningNumbers: const {
          PrizeTier.first: ['111111'],
        },
        prizes: const {'first': '111111'},
      ),);
      src.put(fixtureDraw(
        drawDate: DateTime.utc(2026, 4, 16, 9),
        winningNumbers: const {
          PrizeTier.first: ['222222'],
        },
        prizes: const {'first': '222222'},
      ),);
      expect(src.count, 1);
      final hit = await src.fetchByDate(DateTime.utc(2026, 4, 16));
      expect(hit!.winningNumbers[PrizeTier.first], ['222222']);
    });

    test('clear empties the store', () {
      final src = FixtureDataSource();
      src.put(fixtureDraw());
      src.clear();
      expect(src.count, 0);
    });
  });
}
