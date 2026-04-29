import 'package:flutter_test/flutter_test.dart';
import 'package:lotto_checker/shared/models/ticket.dart';

void main() {
  group('Ticket', () {
    test('value equality (freezed): two Tickets with same fields are equal', () {
      final t1 = Ticket(
        id: 'abc',
        numbers: '123456',
        drawDate: DateTime.utc(2026, 1, 16),
        createdAt: DateTime.utc(2026, 1, 1),
      );
      final t2 = Ticket(
        id: 'abc',
        numbers: '123456',
        drawDate: DateTime.utc(2026, 1, 16),
        createdAt: DateTime.utc(2026, 1, 1),
      );
      expect(t1, equals(t2));
      expect(t1.hashCode, equals(t2.hashCode));
    });

    test('toJson / fromJson roundtrip preserves all fields', () {
      final original = Ticket(
        id: 'abc',
        numbers: '123456',
        drawDate: DateTime.utc(2026, 1, 16),
        createdAt: DateTime.utc(2026, 1, 1),
        note: 'birthday numbers',
      );
      final restored = Ticket.fromJson(original.toJson());
      expect(restored, equals(original));
    });

    test('note is optional and defaults to null', () {
      final t = Ticket(
        id: 'abc',
        numbers: '123456',
        drawDate: DateTime.utc(2026, 1, 16),
        createdAt: DateTime.utc(2026, 1, 1),
      );
      expect(t.note, isNull);
    });
  });
}
