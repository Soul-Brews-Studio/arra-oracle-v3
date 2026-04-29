import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:lotto_checker/features/results/application/ticket_match_service.dart';
import 'package:lotto_checker/features/results/data/draw_repository.dart';
import 'package:lotto_checker/features/results/data/sources/lottery_data_source.dart';
import 'package:lotto_checker/features/results/data/sync_service.dart';
import 'package:lotto_checker/features/results/domain/match_result.dart';
import 'package:lotto_checker/features/tickets/data/ticket_repository.dart';
import 'package:lotto_checker/shared/models/draw.dart';
import 'package:lotto_checker/shared/models/prize.dart';
import 'package:lotto_checker/shared/models/ticket.dart';
import 'package:mocktail/mocktail.dart';

import '../../../../fixtures/draws.dart';
import '../../../../fixtures/tickets.dart';

class _MockTicketRepository extends Mock implements TicketRepository {}

class _MockDrawRepository extends Mock implements DrawRepository {}

class _MockLotterySource extends Mock implements LotteryDataSource {}

class _FakeDateTime extends Fake implements DateTime {}

class _FakeDraw extends Fake implements Draw {}

void main() {
  setUpAll(() {
    registerFallbackValue(_FakeDateTime());
    registerFallbackValue(_FakeDraw());
  });

  late _MockTicketRepository tickets;
  late _MockDrawRepository draws;
  late _MockLotterySource source;
  late DrawSyncService sync;
  late TicketMatchService service;

  setUp(() {
    tickets = _MockTicketRepository();
    draws = _MockDrawRepository();
    source = _MockLotterySource();
    sync = DrawSyncService(source: source, repository: draws);
    service = TicketMatchService(ticketRepo: tickets, syncService: sync);
    when(() => draws.save(any())).thenAnswer((_) async {});
  });

  Ticket winning() => fixtureTicket(numbers: '123456');
  Ticket losing() => fixtureTicket(id: 'ticket-2', numbers: '999999');

  group('checkTicket', () {
    test('returns Match when draw cached and ticket wins', () async {
      when(() => draws.getByDate(any())).thenAnswer((_) async => fixtureDraw());

      final result = await service.checkTicket(winning());

      expect(result, isA<Match>());
      final m = result as Match;
      expect(m.tier, PrizeTier.first);
      expect(m.prizeAmount, PrizeTier.first.amount);
      expect(m.matchedDigits, '123456');
      verifyNever(() => source.fetchByDate(any()));
    });

    test('returns NoMatch when draw cached and ticket loses', () async {
      when(() => draws.getByDate(any())).thenAnswer((_) async => fixtureDraw());

      final result = await service.checkTicket(losing());

      expect(result, isA<NoMatch>());
    });

    test('falls through to source when cache misses; saves on success',
        () async {
      when(() => draws.getByDate(any())).thenAnswer((_) async => null);
      when(() => source.fetchByDate(any()))
          .thenAnswer((_) async => fixtureDraw());

      final result = await service.checkTicket(winning());

      expect(result, isA<Match>());
      verify(() => source.fetchByDate(any())).called(1);
      verify(() => draws.save(any())).called(1);
    });

    test('returns NoMatch when both cache and source miss', () async {
      when(() => draws.getByDate(any())).thenAnswer((_) async => null);
      when(() => source.fetchByDate(any())).thenAnswer((_) async => null);

      final result = await service.checkTicket(winning());

      expect(result, isA<NoMatch>());
      verifyNever(() => draws.save(any()));
    });

    test('returns NoMatch (no throw) when source raises FetchException',
        () async {
      when(() => draws.getByDate(any())).thenAnswer((_) async => null);
      when(() => source.fetchByDate(any()))
          .thenThrow(FetchException('boom', statusCode: 500));

      final result = await service.checkTicket(winning());

      expect(result, isA<NoMatch>());
    });

    test('returns NoMatch (no throw) when source raises ParseException',
        () async {
      when(() => draws.getByDate(any())).thenAnswer((_) async => null);
      when(() => source.fetchByDate(any())).thenThrow(ParseException('bad'));

      final result = await service.checkTicket(winning());

      expect(result, isA<NoMatch>());
    });

    test('returns NoMatch when underlying repository raises', () async {
      when(() => draws.getByDate(any())).thenThrow(StateError('db gone'));

      final result = await service.checkTicket(winning());

      expect(result, isA<NoMatch>());
    });
  });

  group('checkAll', () {
    test('returns empty map when no tickets exist', () async {
      when(tickets.getAll).thenAnswer((_) async => <Ticket>[]);

      final results = await service.checkAll();

      expect(results, isEmpty);
      verifyNever(() => draws.getByDate(any()));
    });

    test('returns map keyed by ticket.id covering every ticket', () async {
      when(tickets.getAll)
          .thenAnswer((_) async => [winning(), losing()]);
      when(() => draws.getByDate(any())).thenAnswer((_) async => fixtureDraw());

      final results = await service.checkAll();

      expect(results.keys, containsAll(['ticket-1', 'ticket-2']));
      expect(results['ticket-1'], isA<Match>());
      expect(results['ticket-2'], isA<NoMatch>());
    });

    test('dedups draw fetches per drawDate', () async {
      final t1 = fixtureTicket(id: 'a', numbers: '123456');
      final t2 = fixtureTicket(id: 'b', numbers: '999999');
      when(tickets.getAll).thenAnswer((_) async => [t1, t2]);
      when(() => draws.getByDate(any())).thenAnswer((_) async => fixtureDraw());

      await service.checkAll();

      verify(() => draws.getByDate(any())).called(1);
    });

    test('NoMatch for every ticket when all draws fail to fetch', () async {
      when(tickets.getAll)
          .thenAnswer((_) async => [winning(), losing()]);
      when(() => draws.getByDate(any())).thenAnswer((_) async => null);
      when(() => source.fetchByDate(any())).thenThrow(FetchException('x'));

      final results = await service.checkAll();

      expect(results['ticket-1'], isA<NoMatch>());
      expect(results['ticket-2'], isA<NoMatch>());
    });
  });

  group('watchAll', () {
    test('emits empty map when ticket stream emits empty list', () async {
      final controller = StreamController<List<Ticket>>();
      addTearDown(controller.close);
      when(tickets.watchAll).thenAnswer((_) => controller.stream);

      final emissions = <Map<String, MatchResult>>[];
      final sub = service.watchAll().listen(emissions.add);
      addTearDown(sub.cancel);

      controller.add(<Ticket>[]);
      await Future<void>.delayed(const Duration(milliseconds: 20));

      expect(emissions, hasLength(1));
      expect(emissions.single, isEmpty);
    });

    test('re-emits a new map when ticket stream emits an updated list',
        () async {
      final controller = StreamController<List<Ticket>>();
      addTearDown(controller.close);
      when(tickets.watchAll).thenAnswer((_) => controller.stream);
      when(() => draws.getByDate(any())).thenAnswer((_) async => fixtureDraw());

      final emissions = <Map<String, MatchResult>>[];
      final sub = service.watchAll().listen(emissions.add);
      addTearDown(sub.cancel);

      controller.add([winning()]);
      await Future<void>.delayed(const Duration(milliseconds: 20));
      controller.add([winning(), losing()]);
      await Future<void>.delayed(const Duration(milliseconds: 20));

      expect(emissions.length, 2);
      expect(emissions[0].keys, ['ticket-1']);
      expect(emissions[1].keys, containsAll(['ticket-1', 'ticket-2']));
      expect(emissions[1]['ticket-2'], isA<NoMatch>());
    });

    test('graceful when draw fetch fails mid-stream', () async {
      final controller = StreamController<List<Ticket>>();
      addTearDown(controller.close);
      when(tickets.watchAll).thenAnswer((_) => controller.stream);
      when(() => draws.getByDate(any())).thenAnswer((_) async => null);
      when(() => source.fetchByDate(any()))
          .thenThrow(FetchException('offline'));

      final emissions = <Map<String, MatchResult>>[];
      final sub = service.watchAll().listen(emissions.add);
      addTearDown(sub.cancel);

      controller.add([winning()]);
      await Future<void>.delayed(const Duration(milliseconds: 20));

      expect(emissions, hasLength(1));
      expect(emissions.single['ticket-1'], isA<NoMatch>());
    });
  });
}
