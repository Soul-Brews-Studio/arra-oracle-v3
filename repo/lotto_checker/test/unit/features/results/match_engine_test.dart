import 'package:flutter_test/flutter_test.dart';
import 'package:lotto_checker/features/results/domain/match_engine.dart';
import 'package:lotto_checker/features/results/domain/match_result.dart';
import 'package:lotto_checker/shared/models/prize.dart';

import '_match_helpers.dart';

void main() {
  group('checkTicket — exact 6-digit tiers', () {
    test('first prize: full 6-digit match → ฿6,000,000', () {
      final r = checkTicket(
        testTicket('123456'),
        testDraw(winners: {
          PrizeTier.first: ['123456'],
        },),
      );
      expect(r, isA<Match>());
      final m = r as Match;
      expect(m.tier, PrizeTier.first);
      expect(m.prizeAmount, 6000000);
      expect(m.matchedDigits, '123456');
    });

    test('firstNear: ±1 neighbour numbers → ฿100,000', () {
      final r = checkTicket(
        testTicket('123455'),
        testDraw(winners: {
          PrizeTier.first: ['123456'],
          PrizeTier.firstNear: ['123455', '123457'],
        },),
      );
      expect((r as Match).tier, PrizeTier.firstNear);
      expect(r.prizeAmount, 100000);
    });

    test('second prize: matches one of 5 winners → ฿200,000', () {
      final r = checkTicket(
        testTicket('555555'),
        testDraw(winners: {
          PrizeTier.second: ['111111', '222222', '333333', '444444', '555555'],
        },),
      );
      expect((r as Match).tier, PrizeTier.second);
      expect(r.prizeAmount, 200000);
    });

    test('third prize: matches one of 10 winners → ฿80,000', () {
      final winners = List.generate(10, (i) => '90000$i');
      final r = checkTicket(
        testTicket('900007'),
        testDraw(winners: {PrizeTier.third: winners}),
      );
      expect((r as Match).tier, PrizeTier.third);
      expect(r.prizeAmount, 80000);
    });

    test('fourth prize: matches one of 50 winners → ฿40,000', () {
      final winners = List.generate(50, (i) => i.toString().padLeft(6, '0'));
      final r = checkTicket(
        testTicket('000042'),
        testDraw(winners: {PrizeTier.fourth: winners}),
      );
      expect((r as Match).tier, PrizeTier.fourth);
      expect(r.prizeAmount, 40000);
    });

    test('fifth prize: matches one of 100 winners → ฿20,000', () {
      final winners =
          List.generate(100, (i) => '7${i.toString().padLeft(5, '0')}');
      final r = checkTicket(
        testTicket('700099'),
        testDraw(winners: {PrizeTier.fifth: winners}),
      );
      expect((r as Match).tier, PrizeTier.fifth);
      expect(r.prizeAmount, 20000);
    });
  });

  group('checkTicket — partial-digit tiers', () {
    test('threeDigitFront: first 3 digits match → ฿4,000', () {
      final r = checkTicket(
        testTicket('789012'),
        testDraw(winners: {
          PrizeTier.threeDigitFront: ['789', '321'],
        },),
      );
      expect((r as Match).tier, PrizeTier.threeDigitFront);
      expect(r.matchedDigits, '789');
      expect(r.prizeAmount, 4000);
    });

    test('threeDigitBack: last 3 digits match (multi-candidate) → ฿4,000', () {
      final r = checkTicket(
        testTicket('111888'),
        testDraw(winners: {
          PrizeTier.threeDigitBack: ['888', '999'],
        },),
      );
      expect((r as Match).tier, PrizeTier.threeDigitBack);
      expect(r.matchedDigits, '888');
    });

    test('twoDigitBack: last 2 digits match → ฿2,000', () {
      final r = checkTicket(
        testTicket('123442'),
        testDraw(winners: {
          PrizeTier.twoDigitBack: ['42'],
        },),
      );
      expect((r as Match).tier, PrizeTier.twoDigitBack);
      expect(r.matchedDigits, '42');
      expect(r.prizeAmount, 2000);
    });
  });

  group('checkTicket — priority + no-match', () {
    test('returns NoMatch when nothing matches', () {
      final r = checkTicket(
        testTicket('000000'),
        testDraw(winners: {
          PrizeTier.first: ['999999'],
          PrizeTier.twoDigitBack: ['11'],
          PrizeTier.threeDigitFront: ['111'],
        },),
      );
      expect(r, isA<NoMatch>());
    });

    test('first prize beats lower tiers when ticket qualifies for both', () {
      final r = checkTicket(
        testTicket('123456'),
        testDraw(winners: {
          PrizeTier.first: ['123456'],
          PrizeTier.threeDigitFront: ['123'],
          PrizeTier.threeDigitBack: ['456'],
          PrizeTier.twoDigitBack: ['56'],
        },),
      );
      expect((r as Match).tier, PrizeTier.first);
    });

    test('threeDigitBack beats twoDigitBack when both apply', () {
      final r = checkTicket(
        testTicket('111456'),
        testDraw(winners: {
          PrizeTier.threeDigitBack: ['456'],
          PrizeTier.twoDigitBack: ['56'],
        },),
      );
      expect((r as Match).tier, PrizeTier.threeDigitBack);
    });

    test('empty draw → NoMatch', () {
      final r = checkTicket(testTicket('123456'), testDraw());
      expect(r, isA<NoMatch>());
    });
  });
}
