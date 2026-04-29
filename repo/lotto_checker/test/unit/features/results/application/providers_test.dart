import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lotto_checker/features/results/application/providers.dart';
import 'package:lotto_checker/features/results/application/ticket_match_service.dart';
import 'package:lotto_checker/features/results/data/providers.dart';
import 'package:lotto_checker/features/results/data/sources/fixture_data_source.dart';
import 'package:lotto_checker/features/results/domain/match_result.dart';
import 'package:lotto_checker/features/tickets/data/providers.dart';
import 'package:lotto_checker/shared/models/prize.dart';

import '../../../../fixtures/draws.dart';
import '../../../../fixtures/tickets.dart';
import '../../../../helpers/in_memory_db.dart';

ProviderContainer _container({
  FixtureDataSource? source,
}) {
  final db = makeInMemoryDatabase();
  addTearDown(db.close);
  final container = ProviderContainer(
    overrides: [
      appDatabaseProvider.overrideWithValue(db),
      lotteryDataSourceProvider.overrideWithValue(
        source ??
            FixtureDataSource(
              draws: {
                DateTime.utc(2026, 5, 1): fixtureDraw(
                  drawDate: DateTime.utc(2026, 5, 1),
                  winningNumbers: const {
                    PrizeTier.first: ['123456'],
                  },
                  prizes: const {'first': '123456'},
                ),
              },
            ),
      ),
    ],
  );
  addTearDown(container.dispose);
  return container;
}

void main() {
  group('ticketMatchServiceProvider', () {
    test('builds a TicketMatchService instance', () {
      final container = _container();
      final svc = container.read(ticketMatchServiceProvider);
      expect(svc, isA<TicketMatchService>());
    });

    test('returns a stable instance per container', () {
      final container = _container();
      final first = container.read(ticketMatchServiceProvider);
      final second = container.read(ticketMatchServiceProvider);
      expect(identical(first, second), isTrue);
    });
  });

  group('ticketMatchProvider (family)', () {
    test('parameterized by ticket: returns Match when ticket wins', () async {
      final container = _container();
      final ticket = fixtureTicket(
        id: 'win',
        numbers: '123456',
        drawDate: DateTime.utc(2026, 5, 1),
      );

      final result = await container.read(
        ticketMatchProvider(ticket).future,
      );

      expect(result, isA<Match>());
      expect((result as Match).tier, PrizeTier.first);
    });

    test('parameterized by ticket: returns NoMatch when ticket loses',
        () async {
      final container = _container();
      final ticket = fixtureTicket(
        id: 'lose',
        numbers: '999999',
        drawDate: DateTime.utc(2026, 5, 1),
      );

      final result = await container.read(
        ticketMatchProvider(ticket).future,
      );

      expect(result, isA<NoMatch>());
    });

    test('returns NoMatch when source has no data (graceful)', () async {
      final container = _container(source: FixtureDataSource());
      final ticket = fixtureTicket(numbers: '123456');

      final result = await container.read(
        ticketMatchProvider(ticket).future,
      );

      expect(result, isA<NoMatch>());
    });
  });

  group('allTicketMatchesProvider', () {
    test('emits empty map when no tickets are saved', () async {
      final container = _container();

      container.listen<AsyncValue<Map<String, MatchResult>>>(
        allTicketMatchesProvider,
        (_, __) {},
      );
      // Give the stream time to flush.
      AsyncValue<Map<String, MatchResult>> snap =
          container.read(allTicketMatchesProvider);
      for (var i = 0; i < 20 && snap.isLoading; i++) {
        await Future<void>.delayed(const Duration(milliseconds: 20));
        snap = container.read(allTicketMatchesProvider);
      }
      expect(snap.value, isNotNull);
      expect(snap.value!, isEmpty);
    });

    test('emits a populated map after a ticket is saved', () async {
      final container = _container();
      final repo = container.read(ticketRepositoryProvider);
      await repo.save(
        fixtureTicket(
          numbers: '123456',
          drawDate: DateTime.utc(2026, 5, 1),
        ),
      );

      container.listen<AsyncValue<Map<String, MatchResult>>>(
        allTicketMatchesProvider,
        (_, __) {},
      );

      AsyncValue<Map<String, MatchResult>> snap =
          container.read(allTicketMatchesProvider);
      for (var i = 0; i < 30 &&
              (snap.isLoading || (snap.value?.isEmpty ?? true));
          i++) {
        await Future<void>.delayed(const Duration(milliseconds: 20));
        snap = container.read(allTicketMatchesProvider);
      }
      expect(snap.value, isNotNull);
      expect(snap.value!.containsKey('ticket-1'), isTrue);
      expect(snap.value!['ticket-1'], isA<Match>());
    });
  });
}
