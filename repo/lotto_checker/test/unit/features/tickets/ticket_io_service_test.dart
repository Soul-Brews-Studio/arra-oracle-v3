import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lotto_checker/features/tickets/data/providers.dart';
import 'package:lotto_checker/features/tickets/data/ticket_io_service.dart';

import '../../../fixtures/tickets.dart';
import '../../../helpers/in_memory_db.dart';

void main() {
  group('TicketIoService.encode', () {
    test('produces metadata header + tickets array', () {
      final tickets = fixtureTickets();
      final json = TicketIoService.encode(
        tickets,
        now: DateTime.utc(2026, 5, 6, 12),
      );
      final decoded = jsonDecode(json) as Map<String, dynamic>;

      expect(decoded['app'], 'lotto_checker');
      expect(decoded['version'], 1);
      expect(decoded['exportedAt'], '2026-05-06T12:00:00.000Z');
      expect((decoded['tickets'] as List).length, tickets.length);
    });
  });

  group('TicketIoService.decode', () {
    test('round-trips encoded archive back into Tickets', () {
      final tickets = fixtureTickets();
      final json = TicketIoService.encode(tickets);
      final result = TicketIoService.decode(json);

      expect(result.length, tickets.length);
      for (var i = 0; i < tickets.length; i++) {
        expect(result[i], ticketEquals(tickets[i]));
      }
    });

    test('rejects non-JSON', () {
      expect(
        () => TicketIoService.decode('not-json'),
        throwsA(isA<TicketImportFormatException>()),
      );
    });

    test('rejects wrong app', () {
      final bad = jsonEncode({
        'app': 'something_else',
        'version': 1,
        'tickets': <dynamic>[],
      });
      expect(
        () => TicketIoService.decode(bad),
        throwsA(isA<TicketImportFormatException>()),
      );
    });

    test('rejects future version', () {
      final bad = jsonEncode({
        'app': 'lotto_checker',
        'version': 99,
        'tickets': <dynamic>[],
      });
      expect(
        () => TicketIoService.decode(bad),
        throwsA(isA<TicketImportFormatException>()),
      );
    });

    test('rejects non-array tickets field', () {
      final bad = jsonEncode({
        'app': 'lotto_checker',
        'version': 1,
        'tickets': 'oops',
      });
      expect(
        () => TicketIoService.decode(bad),
        throwsA(isA<TicketImportFormatException>()),
      );
    });

    test('rejects non-object ticket entry', () {
      final bad = jsonEncode({
        'app': 'lotto_checker',
        'version': 1,
        'tickets': ['not-an-object'],
      });
      expect(
        () => TicketIoService.decode(bad),
        throwsA(isA<TicketImportFormatException>()),
      );
    });
  });

  group('TicketIoService round-trip via repository', () {
    test('export then import on empty repo restores all tickets', () async {
      final dbA = makeInMemoryDatabase();
      final dbB = makeInMemoryDatabase();
      addTearDown(dbA.close);
      addTearDown(dbB.close);

      final containerA = ProviderContainer(
        overrides: [appDatabaseProvider.overrideWithValue(dbA)],
      );
      final containerB = ProviderContainer(
        overrides: [appDatabaseProvider.overrideWithValue(dbB)],
      );
      addTearDown(containerA.dispose);
      addTearDown(containerB.dispose);

      final repoA = containerA.read(ticketRepositoryProvider);
      final repoB = containerB.read(ticketRepositoryProvider);
      final ioA = containerA.read(ticketIoServiceProvider);
      final ioB = containerB.read(ticketIoServiceProvider);

      final originals = fixtureTickets();
      for (final t in originals) {
        await repoA.save(t);
      }

      final archive = await ioA.exportJsonString();
      final result = await ioB.importJsonString(archive);

      expect(result.imported, originals.length);
      final restored = await repoB.getAll();
      expect(restored.length, originals.length);
      for (final original in originals) {
        final found = restored.firstWhere((t) => t.id == original.id);
        expect(found, ticketEquals(original));
      }
    });

    test('import upserts duplicates (same id overwrites)', () async {
      final db = makeInMemoryDatabase();
      addTearDown(db.close);
      final container = ProviderContainer(
        overrides: [appDatabaseProvider.overrideWithValue(db)],
      );
      addTearDown(container.dispose);

      final repo = container.read(ticketRepositoryProvider);
      final io = container.read(ticketIoServiceProvider);

      await repo.save(fixtureTicket(numbers: '111111', note: 'old'));

      final incoming = fixtureTicket(numbers: '999999', note: 'new');
      final archive = TicketIoService.encode([incoming]);
      await io.importJsonString(archive);

      final after = await repo.getAll();
      expect(after.length, 1);
      expect(after.single.numbers, '999999');
      expect(after.single.note, 'new');
    });
  });
}
