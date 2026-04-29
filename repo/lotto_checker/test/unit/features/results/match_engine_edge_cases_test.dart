import 'package:flutter_test/flutter_test.dart';
import 'package:lotto_checker/features/results/domain/match_engine.dart';
import 'package:lotto_checker/features/results/domain/match_result.dart';
import 'package:lotto_checker/shared/models/prize.dart';

import '_match_helpers.dart';

void main() {
  group('checkTicket — edge cases', () {
    test('preserves leading zeros on full match', () {
      final r = checkTicket(
        testTicket('000123'),
        testDraw(winners: {
          PrizeTier.first: ['000123'],
        },),
      );
      expect((r as Match).matchedDigits, '000123');
    });

    test('preserves leading zeros on twoDigitBack', () {
      final r = checkTicket(
        testTicket('123407'),
        testDraw(winners: {
          PrizeTier.twoDigitBack: ['07'],
        },),
      );
      expect((r as Match).matchedDigits, '07');
    });

    test('ticket shorter than 6 digits → NoMatch', () {
      final r = checkTicket(
        testTicket('12345'),
        testDraw(winners: {
          PrizeTier.first: ['12345'],
        },),
      );
      expect(r, isA<NoMatch>());
    });

    test('ticket longer than 6 digits → NoMatch', () {
      final r = checkTicket(
        testTicket('1234567'),
        testDraw(winners: {
          PrizeTier.first: ['1234567'],
        },),
      );
      expect(r, isA<NoMatch>());
    });

    test('non-digit characters → NoMatch', () {
      final r = checkTicket(
        testTicket('12A456'),
        testDraw(winners: {
          PrizeTier.first: ['12A456'],
        },),
      );
      expect(r, isA<NoMatch>());
    });

    test('twoDigitBack candidate with wrong width is ignored', () {
      final r = checkTicket(
        testTicket('123456'),
        testDraw(winners: {
          PrizeTier.twoDigitBack: ['456'],
        },),
      );
      expect(r, isA<NoMatch>());
    });

    test('threeDigitFront does not falsely match against last 3', () {
      final r = checkTicket(
        testTicket('111456'),
        testDraw(winners: {
          PrizeTier.threeDigitFront: ['456'],
        },),
      );
      expect(r, isA<NoMatch>());
    });

    test('multiple threeDigitBack candidates — picks the matching one', () {
      final r = checkTicket(
        testTicket('999321'),
        testDraw(winners: {
          PrizeTier.threeDigitBack: ['100', '200', '321', '400'],
        },),
      );
      expect((r as Match).tier, PrizeTier.threeDigitBack);
      expect(r.matchedDigits, '321');
    });
  });
}
