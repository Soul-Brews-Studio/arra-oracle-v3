import 'package:flutter_test/flutter_test.dart';
import 'package:lotto_checker/shared/models/prize.dart';

void main() {
  group('PrizeTier', () {
    test('has all 9 official Thai government lottery tiers', () {
      expect(PrizeTier.values, hasLength(9));
    });

    test('exposes a non-empty Thai label for every tier', () {
      for (final tier in PrizeTier.values) {
        expect(
          tier.label,
          isNotEmpty,
          reason: '${tier.name} must have a label',
        );
      }
    });

    test('amount is positive (Baht) for every tier', () {
      for (final tier in PrizeTier.values) {
        expect(
          tier.amount,
          greaterThan(0),
          reason: '${tier.name} must have a positive amount',
        );
      }
    });

    test('first prize is 6,000,000 THB', () {
      expect(PrizeTier.first.amount, 6000000);
      expect(PrizeTier.first.label, 'รางวัลที่ 1');
    });

    test('two-digit back is 2,000 THB (smallest tier)', () {
      expect(PrizeTier.twoDigitBack.amount, 2000);
    });

    test('tier ordering: first > second > third > fourth > fifth', () {
      expect(
        PrizeTier.first.amount,
        greaterThan(PrizeTier.second.amount),
      );
      expect(
        PrizeTier.second.amount,
        greaterThan(PrizeTier.third.amount),
      );
      expect(
        PrizeTier.third.amount,
        greaterThan(PrizeTier.fourth.amount),
      );
      expect(
        PrizeTier.fourth.amount,
        greaterThan(PrizeTier.fifth.amount),
      );
    });
  });
}
