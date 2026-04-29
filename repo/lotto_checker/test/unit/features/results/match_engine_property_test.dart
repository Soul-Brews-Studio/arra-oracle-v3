import 'dart:math';

import 'package:flutter_test/flutter_test.dart';
import 'package:lotto_checker/features/results/domain/match_engine.dart';
import 'package:lotto_checker/features/results/domain/match_result.dart';
import 'package:lotto_checker/shared/models/draw.dart';
import 'package:lotto_checker/shared/models/prize.dart';
import 'package:lotto_checker/shared/models/ticket.dart';

Ticket _t(String numbers) => Ticket(
      id: 'id-$numbers',
      numbers: numbers,
      drawDate: DateTime.utc(2026, 5, 1),
      createdAt: DateTime.utc(2026, 5, 1),
    );

Draw _draw({
  String first = '111111',
  List<String>? firstNear,
  List<String>? second,
  List<String>? third,
  List<String>? fourth,
  List<String>? fifth,
  List<String>? threeDigitFront,
  List<String>? threeDigitBack,
  List<String>? twoDigitBack,
}) {
  return Draw(
    drawDate: DateTime.utc(2026, 5, 1),
    prizes: const {},
    winningNumbers: {
      PrizeTier.first: [first],
      if (firstNear != null) PrizeTier.firstNear: firstNear,
      if (second != null) PrizeTier.second: second,
      if (third != null) PrizeTier.third: third,
      if (fourth != null) PrizeTier.fourth: fourth,
      if (fifth != null) PrizeTier.fifth: fifth,
      if (threeDigitFront != null) PrizeTier.threeDigitFront: threeDigitFront,
      if (threeDigitBack != null) PrizeTier.threeDigitBack: threeDigitBack,
      if (twoDigitBack != null) PrizeTier.twoDigitBack: twoDigitBack,
    },
  );
}

void main() {
  group('checkTicket — exact tier matches', () {
    test('first prize match returns Match with first tier', () {
      final r = checkTicket(_t('111111'), _draw(first: '111111'));
      expect(r, isA<Match>());
      final m = r as Match;
      expect(m.tier, PrizeTier.first);
      expect(m.matchedDigits, '111111');
      expect(m.prizeAmount, PrizeTier.first.amount);
    });

    test('firstNear match returns firstNear tier', () {
      final r = checkTicket(
        _t('222222'),
        _draw(first: '111111', firstNear: ['222222']),
      );
      expect((r as Match).tier, PrizeTier.firstNear);
      expect(r.prizeAmount, PrizeTier.firstNear.amount);
    });

    test('second/third/fourth/fifth recognized at correct amounts', () {
      const tiers = [
        PrizeTier.second,
        PrizeTier.third,
        PrizeTier.fourth,
        PrizeTier.fifth,
      ];
      for (final tier in tiers) {
        final draw = Draw(
          drawDate: DateTime.utc(2026, 5, 1),
          prizes: const {},
          winningNumbers: {
            PrizeTier.first: const ['000000'],
            tier: const ['555555'],
          },
        );
        final r = checkTicket(_t('555555'), draw) as Match;
        expect(r.tier, tier, reason: 'tier=$tier');
        expect(r.prizeAmount, tier.amount, reason: 'amount=$tier');
      }
    });
  });

  group('checkTicket — partial tier matches', () {
    test('threeDigitFront matches first 3 digits', () {
      final r = checkTicket(
        _t('123456'),
        _draw(first: '000000', threeDigitFront: ['123']),
      ) as Match;
      expect(r.tier, PrizeTier.threeDigitFront);
      expect(r.matchedDigits, '123');
    });

    test('threeDigitBack matches last 3 digits', () {
      final r = checkTicket(
        _t('123456'),
        _draw(first: '000000', threeDigitBack: ['456']),
      ) as Match;
      expect(r.tier, PrizeTier.threeDigitBack);
      expect(r.matchedDigits, '456');
    });

    test('twoDigitBack matches last 2 digits', () {
      final r = checkTicket(
        _t('123456'),
        _draw(first: '000000', twoDigitBack: ['56']),
      ) as Match;
      expect(r.tier, PrizeTier.twoDigitBack);
      expect(r.matchedDigits, '56');
    });

    test('threeDigitFront uses front-only — back match does not satisfy it',
        () {
      final r = checkTicket(
        _t('123456'),
        _draw(first: '000000', threeDigitFront: ['456']),
      );
      expect(r, const MatchResult.noMatch());
    });

    test('twoDigitBack uses last 2 — middle/front digits do not satisfy it',
        () {
      final r = checkTicket(
        _t('123456'),
        _draw(first: '000000', twoDigitBack: ['12']),
      );
      expect(r, const MatchResult.noMatch());
    });
  });

  group('checkTicket — tier priority', () {
    test('first beats firstNear', () {
      final draw = _draw(first: '111111', firstNear: ['111111']);
      expect(
        (checkTicket(_t('111111'), draw) as Match).tier,
        PrizeTier.first,
      );
    });

    test('first beats threeDigitFront', () {
      final draw = _draw(first: '111111', threeDigitFront: ['111']);
      expect(
        (checkTicket(_t('111111'), draw) as Match).tier,
        PrizeTier.first,
      );
    });

    test('threeDigitBack beats twoDigitBack', () {
      final draw = _draw(
        first: '000000',
        threeDigitBack: ['456'],
        twoDigitBack: ['56'],
      );
      expect(
        (checkTicket(_t('123456'), draw) as Match).tier,
        PrizeTier.threeDigitBack,
      );
    });

    test('fifth beats threeDigitFront', () {
      final draw = Draw(
        drawDate: DateTime.utc(2026, 5, 1),
        prizes: const {},
        winningNumbers: const {
          PrizeTier.first: ['000000'],
          PrizeTier.fifth: ['123456'],
          PrizeTier.threeDigitFront: ['123'],
        },
      );
      expect(
        (checkTicket(_t('123456'), draw) as Match).tier,
        PrizeTier.fifth,
      );
    });
  });

  group('checkTicket — invalid input', () {
    test('5-digit ticket → noMatch', () {
      expect(
        checkTicket(_t('12345'), _draw(first: '12345')),
        const MatchResult.noMatch(),
      );
    });

    test('7-digit ticket → noMatch', () {
      expect(
        checkTicket(_t('1234567'), _draw(first: '1234567')),
        const MatchResult.noMatch(),
      );
    });

    test('non-digit characters → noMatch', () {
      expect(
        checkTicket(_t('abcdef'), _draw(first: 'abcdef')),
        const MatchResult.noMatch(),
      );
    });

    test('empty string → noMatch', () {
      expect(checkTicket(_t(''), _draw()), const MatchResult.noMatch());
    });

    test('mixed digits and letters → noMatch', () {
      expect(checkTicket(_t('12345a'), _draw()), const MatchResult.noMatch());
    });
  });

  group('checkTicket — empty draw', () {
    test('every well-formed ticket → noMatch when draw has no winners', () {
      final empty = Draw(
        drawDate: DateTime.utc(2026, 5, 1),
        prizes: const {},
        winningNumbers: const {},
      );
      for (var i = 0; i < 30; i++) {
        final n = i.toString().padLeft(6, '0');
        expect(
          checkTicket(_t(n), empty),
          const MatchResult.noMatch(),
          reason: 'ticket $n',
        );
      }
    });
  });

  group('checkTicket — property-style: 100 random tickets vs known draw', () {
    final draw = Draw(
      drawDate: DateTime.utc(2026, 5, 1),
      prizes: const {},
      winningNumbers: const {
        PrizeTier.first: ['824613'],
        PrizeTier.firstNear: ['824612', '824614'],
        PrizeTier.second: ['111111', '222222', '333333', '444444', '555555'],
        PrizeTier.third: ['666666'],
        PrizeTier.fourth: ['777777'],
        PrizeTier.fifth: ['888888'],
        PrizeTier.threeDigitFront: ['100', '200'],
        PrizeTier.threeDigitBack: ['456', '789'],
        PrizeTier.twoDigitBack: ['00'],
      },
    );

    PrizeTier? expectedTier(String n) {
      if (n.length != 6) return null;
      const exactOrder = [
        PrizeTier.first,
        PrizeTier.firstNear,
        PrizeTier.second,
        PrizeTier.third,
        PrizeTier.fourth,
        PrizeTier.fifth,
      ];
      for (final t in exactOrder) {
        final list = draw.winningNumbers[t] ?? const <String>[];
        if (list.contains(n)) return t;
      }
      final front = draw.winningNumbers[PrizeTier.threeDigitFront] ??
          const <String>[];
      if (front.contains(n.substring(0, 3))) return PrizeTier.threeDigitFront;
      final back = draw.winningNumbers[PrizeTier.threeDigitBack] ??
          const <String>[];
      if (back.contains(n.substring(3, 6))) return PrizeTier.threeDigitBack;
      final two = draw.winningNumbers[PrizeTier.twoDigitBack] ??
          const <String>[];
      if (two.contains(n.substring(4, 6))) return PrizeTier.twoDigitBack;
      return null;
    }

    test('100 random 6-digit tickets — actual matches expected tier', () {
      final rng = Random(42); // seeded for reproducibility
      for (var i = 0; i < 100; i++) {
        final n = rng.nextInt(1000000).toString().padLeft(6, '0');
        final actual = checkTicket(_t(n), draw);
        final expected = expectedTier(n);
        if (expected == null) {
          expect(
            actual,
            const MatchResult.noMatch(),
            reason: 'expected NoMatch for $n',
          );
        } else {
          expect(actual, isA<Match>(), reason: 'expected Match for $n');
          final m = actual as Match;
          expect(m.tier, expected, reason: 'tier mismatch for $n');
          expect(
            m.prizeAmount,
            expected.amount,
            reason: 'prize amount mismatch for $n',
          );
        }
      }
    });

    test('every winning first-tier number is detected as first', () {
      for (final n in draw.winningNumbers[PrizeTier.first]!) {
        expect(
          (checkTicket(_t(n), draw) as Match).tier,
          PrizeTier.first,
        );
      }
    });

    test('every winning second-tier number is detected as second', () {
      for (final n in draw.winningNumbers[PrizeTier.second]!) {
        expect(
          (checkTicket(_t(n), draw) as Match).tier,
          PrizeTier.second,
        );
      }
    });

    test('NoMatch verification — 50 generated guaranteed losers', () {
      // '999' front (not in front candidates ['100','200'])
      // back-3 in 101..199 odd (not in back candidates ['456','789'])
      // back-2 always 01..99 odd (not '00')
      final losers = <String>[
        for (var i = 0; i < 50; i++)
          '999${(101 + i * 2).toString().padLeft(3, '0')}',
      ];
      for (final n in losers) {
        // Sanity-check the generator independently of checkTicket.
        expect(n.length, 6);
        expect(
          (draw.winningNumbers[PrizeTier.threeDigitFront] ?? const [])
              .contains(n.substring(0, 3)),
          isFalse,
          reason: 'precondition front $n',
        );
        expect(
          (draw.winningNumbers[PrizeTier.threeDigitBack] ?? const [])
              .contains(n.substring(3, 6)),
          isFalse,
          reason: 'precondition back $n',
        );
        expect(
          (draw.winningNumbers[PrizeTier.twoDigitBack] ?? const [])
              .contains(n.substring(4, 6)),
          isFalse,
          reason: 'precondition twoBack $n',
        );
        expect(
          checkTicket(_t(n), draw),
          const MatchResult.noMatch(),
          reason: 'ticket $n',
        );
      }
    });
  });
}
