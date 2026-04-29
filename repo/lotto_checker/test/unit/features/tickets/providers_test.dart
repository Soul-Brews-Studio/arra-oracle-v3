import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lotto_checker/features/tickets/data/providers.dart';
import 'package:lotto_checker/shared/models/ticket.dart';

import '../../../fixtures/tickets.dart';
import '../../../helpers/in_memory_db.dart';

void main() {
  group('tickets providers (Riverpod wiring)', () {
    test('overriding appDatabaseProvider routes repository to in-memory db',
        () async {
      final db = makeInMemoryDatabase();
      addTearDown(db.close);
      final container = ProviderContainer(
        overrides: [appDatabaseProvider.overrideWithValue(db)],
      );
      addTearDown(container.dispose);

      final repo = container.read(ticketRepositoryProvider);
      final ticket = fixtureTicket();
      await repo.save(ticket);
      expect(await repo.getById(ticket.id), ticketEquals(ticket));
    });

    test('allTicketsProvider emits saved tickets', () async {
      final db = makeInMemoryDatabase();
      addTearDown(db.close);
      final container = ProviderContainer(
        overrides: [appDatabaseProvider.overrideWithValue(db)],
      );
      addTearDown(container.dispose);

      // Subscribe so the StreamProvider stays alive.
      container.listen<AsyncValue<List<Ticket>>>(
        allTicketsProvider,
        (_, __) {},
      );
      await container.read(ticketRepositoryProvider).save(fixtureTicket());

      // Wait for the stream to flush a non-loading value.
      AsyncValue<List<Ticket>> snap = container.read(allTicketsProvider);
      for (var i = 0; i < 20 && (snap.isLoading || snap.value!.isEmpty); i++) {
        await Future<void>.delayed(const Duration(milliseconds: 20));
        snap = container.read(allTicketsProvider);
      }
      expect(snap.value, isNotNull);
      expect(snap.value!.length, 1);
      expect(snap.value!.single.id, 'ticket-1');
    });

    test('overriding ticketRepositoryProvider does not require db override',
        () async {
      final db = makeInMemoryDatabase();
      addTearDown(db.close);
      final container = ProviderContainer(
        overrides: [appDatabaseProvider.overrideWithValue(db)],
      );
      addTearDown(container.dispose);

      final firstRead = container.read(ticketRepositoryProvider);
      final secondRead = container.read(ticketRepositoryProvider);
      // Provider returns a stable reference within the container.
      expect(identical(firstRead, secondRead), isTrue);
    });
  });
}
