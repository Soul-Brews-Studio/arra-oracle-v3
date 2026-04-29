import 'package:flutter_test/flutter_test.dart';
import 'package:lotto_checker/features/tickets/data/database/app_database.dart';
import 'package:lotto_checker/features/tickets/data/ticket_repository.dart';
import 'package:lotto_checker/shared/models/ticket.dart';

import '../../../fixtures/tickets.dart';
import '../../../helpers/in_memory_db.dart';

void main() {
  late AppDatabase db;
  late TicketRepository repo;

  setUp(() {
    db = makeInMemoryDatabase();
    repo = DriftTicketRepository(db);
  });

  tearDown(() async {
    await db.close();
  });

  group('save', () {
    test('inserts a new ticket', () async {
      final ticket = fixtureTicket();
      await repo.save(ticket);
      expect(await repo.getById(ticket.id), ticketEquals(ticket));
    });

    test('upserts: saving same id twice replaces fields', () async {
      final original = fixtureTicket(numbers: '111111', note: 'first');
      await repo.save(original);
      final updated = fixtureTicket(numbers: '999999', note: 'second');
      await repo.save(updated);
      final stored = await repo.getById(original.id);
      expect(stored, ticketEquals(updated));
      expect((await repo.getAll()).length, 1);
    });

    test('persists nullable note: null roundtrip', () async {
      final ticket = fixtureTicket(note: null);
      await repo.save(ticket);
      expect((await repo.getById(ticket.id))!.note, isNull);
    });

    test('persists nullable note: non-null roundtrip', () async {
      final ticket = fixtureTicket(note: 'lucky');
      await repo.save(ticket);
      expect((await repo.getById(ticket.id))!.note, 'lucky');
    });
  });

  group('getById', () {
    test('returns Ticket when present', () async {
      final ticket = fixtureTicket();
      await repo.save(ticket);
      expect(await repo.getById(ticket.id), ticketEquals(ticket));
    });

    test('returns null when missing', () async {
      expect(await repo.getById('does-not-exist'), isNull);
    });
  });

  group('getAll', () {
    test('returns empty list initially', () async {
      expect(await repo.getAll(), isEmpty);
    });

    test('returns all saved tickets', () async {
      for (final t in fixtureTickets()) {
        await repo.save(t);
      }
      expect((await repo.getAll()).length, 3);
    });

    test('orders by drawDate desc, then createdAt desc', () async {
      // Same drawDate, different createdAt → newer createdAt first.
      final older = fixtureTicket(
        id: 'older',
        drawDate: DateTime.utc(2026, 5, 1),
        createdAt: DateTime.utc(2026, 4, 27, 8),
      );
      final newer = fixtureTicket(
        id: 'newer',
        drawDate: DateTime.utc(2026, 5, 1),
        createdAt: DateTime.utc(2026, 4, 27, 12),
      );
      // Different (later) drawDate → comes first regardless of createdAt.
      final latest = fixtureTicket(
        id: 'latest',
        drawDate: DateTime.utc(2026, 5, 16),
        createdAt: DateTime.utc(2026, 4, 27, 6),
      );
      await repo.save(older);
      await repo.save(newer);
      await repo.save(latest);
      final ids = (await repo.getAll()).map((t) => t.id).toList();
      expect(ids, ['latest', 'newer', 'older']);
    });
  });

  group('watchAll', () {
    test('emits initial empty list', () async {
      await expectLater(
        repo.watchAll(),
        emits(isA<List<Ticket>>().having((l) => l.length, 'length', 0)),
      );
    });

    test('emits updated list when a ticket is saved', () async {
      final stream = repo.watchAll();
      final ticket = fixtureTicket();
      final later = expectLater(
        stream,
        emitsInOrder([
          isA<List<Ticket>>().having((l) => l.length, 'length', 0),
          isA<List<Ticket>>().having((l) => l.length, 'length', 1),
        ]),
      );
      await Future<void>.delayed(Duration.zero);
      await repo.save(ticket);
      await later;
    });

    test('emits when a ticket is deleted', () async {
      final ticket = fixtureTicket();
      await repo.save(ticket);
      final stream = repo.watchAll();
      final later = expectLater(
        stream,
        emitsInOrder([
          isA<List<Ticket>>().having((l) => l.length, 'length', 1),
          isA<List<Ticket>>().having((l) => l.length, 'length', 0),
        ]),
      );
      await Future<void>.delayed(Duration.zero);
      await repo.delete(ticket.id);
      await later;
    });

    test('same ordering as getAll', () async {
      for (final t in fixtureTickets()) {
        await repo.save(t);
      }
      final streamed = await repo.watchAll().first;
      final fetched = await repo.getAll();
      expect(
        streamed.map((t) => t.id).toList(),
        fetched.map((t) => t.id).toList(),
      );
    });
  });

  group('getByDrawDate', () {
    test('returns only tickets matching the exact drawDate', () async {
      final target = DateTime.utc(2026, 5, 1);
      await repo.save(fixtureTicket(id: 'match-1', drawDate: target));
      await repo.save(
        fixtureTicket(
          id: 'match-2',
          drawDate: target,
          createdAt: DateTime.utc(2026, 4, 27, 11),
        ),
      );
      await repo.save(
        fixtureTicket(
          id: 'no-match',
          drawDate: DateTime.utc(2026, 5, 16),
        ),
      );
      final results = await repo.getByDrawDate(target);
      expect(results.map((t) => t.id).toSet(), {'match-1', 'match-2'});
    });

    test('returns empty for unmatched drawDate', () async {
      await repo.save(fixtureTicket());
      final results = await repo.getByDrawDate(DateTime.utc(2099, 1, 1));
      expect(results, isEmpty);
    });

    test('treats UTC vs local DateTime distinctly when they differ',
        () async {
      // UTC midnight and local midnight at non-UTC offsets are different
      // instants; getByDrawDate uses exact equality so they should not match.
      final utc = DateTime.utc(2026, 5, 1);
      final localNoon = DateTime(2026, 5, 1, 12);
      await repo.save(fixtureTicket(id: 'utc', drawDate: utc));
      final hits = await repo.getByDrawDate(localNoon);
      expect(hits, isEmpty);
    });
  });

  group('delete', () {
    test('removes the ticket', () async {
      final ticket = fixtureTicket();
      await repo.save(ticket);
      await repo.delete(ticket.id);
      expect(await repo.getById(ticket.id), isNull);
    });

    test('is a no-op when id does not exist', () async {
      final ticket = fixtureTicket();
      await repo.save(ticket);
      await repo.delete('missing-id'); // does not throw
      expect((await repo.getAll()).length, 1);
      expect(await repo.getById(ticket.id), ticketEquals(ticket));
    });
  });

  group('deleteAll', () {
    test('wipes table', () async {
      for (final t in fixtureTickets()) {
        await repo.save(t);
      }
      await repo.deleteAll();
      expect(await repo.getAll(), isEmpty);
    });

    test('leaves empty stream emission downstream', () async {
      await repo.save(fixtureTicket());
      final stream = repo.watchAll();
      final later = expectLater(
        stream,
        emitsInOrder([
          isA<List<Ticket>>().having((l) => l.length, 'length', 1),
          isA<List<Ticket>>().having((l) => l.length, 'length', 0),
        ]),
      );
      await Future<void>.delayed(Duration.zero);
      await repo.deleteAll();
      await later;
    });
  });
}
