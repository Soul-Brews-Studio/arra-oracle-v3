import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:lotto_checker/features/results/data/sources/lottery_data_source.dart';
import 'package:lotto_checker/features/results/data/sources/sanook_data_source.dart';
import 'package:lotto_checker/shared/models/prize.dart';
import 'package:mocktail/mocktail.dart';

class _MockClient extends Mock implements http.Client {}

class _FakeUri extends Fake implements Uri {}

const String _validHtml = '''
<article class="lotto-check__article">
  <time datetime="2026-04-16 13:00" class="lotto-check__time">16/04/2026</time>
  <p class="lotto-check__para lotto-check__para--half">
    <small class="lotto-check__item">รางวัลที่ 1</small>
    <b class="lotto__number lotto__number--three">309612</b>
  </p>
</article>
''';

http.Response _okHtml(String body) => http.Response.bytes(
      utf8.encode(body),
      200,
      headers: const {'content-type': 'text/html; charset=utf-8'},
    );

void main() {
  setUpAll(() {
    registerFallbackValue(_FakeUri());
  });

  group('SanookDataSource — error handling', () {
    test('throws FetchException on 404 (4xx — no retry)', () async {
      final client = _MockClient();
      var calls = 0;
      when(() => client.get(any(), headers: any(named: 'headers')))
          .thenAnswer((_) async {
        calls++;
        return http.Response('not found', 404);
      });
      final source = SanookDataSource(client: client);

      await expectLater(
        source.fetchLatest(),
        throwsA(
          isA<FetchException>().having((e) => e.statusCode, 'statusCode', 404),
        ),
      );
      expect(calls, 1, reason: '4xx must not be retried');
    });

    test('retries on 500 then succeeds', () async {
      final client = _MockClient();
      var calls = 0;
      when(() => client.get(any(), headers: any(named: 'headers')))
          .thenAnswer((_) async {
        calls++;
        if (calls < 2) return http.Response('boom', 500);
        return _okHtml(_validHtml);
      });
      final source = SanookDataSource(client: client);

      final draw = await source.fetchLatest();
      // 2 calls for home page (1 retry) + 1 call for per-draw page = 3 total.
      expect(calls, 3);
      expect(draw.winningNumbers[PrizeTier.first], ['309612']);
    });

    test('exhausts 3 retries on persistent 5xx', () async {
      final client = _MockClient();
      var calls = 0;
      when(() => client.get(any(), headers: any(named: 'headers')))
          .thenAnswer((_) async {
        calls++;
        return http.Response('boom', 503);
      });
      final source = SanookDataSource(client: client);

      await expectLater(
        source.fetchLatest(),
        throwsA(isA<FetchException>()),
      );
      expect(calls, 3);
    });

    test('treats network errors as retryable', () async {
      final client = _MockClient();
      var calls = 0;
      when(() => client.get(any(), headers: any(named: 'headers')))
          .thenAnswer((_) async {
        calls++;
        if (calls < 3) throw const _NetworkError('connection refused');
        return _okHtml(_validHtml);
      });
      final source = SanookDataSource(client: client);

      final draw = await source.fetchLatest();
      // 3 calls for home page (2 failures + success) + 1 per-draw = 4 total.
      expect(calls, 4);
      expect(draw.winningNumbers[PrizeTier.first], ['309612']);
    });

    test('does not return synchronously when underlying client hangs',
        () async {
      final client = _MockClient();
      when(() => client.get(any(), headers: any(named: 'headers'))).thenAnswer(
        (_) => Future<http.Response>.delayed(
          const Duration(seconds: 30),
          () => _okHtml(_validHtml),
        ),
      );
      final source = SanookDataSource(client: client);

      final outcome = await Future.any([
        source.fetchLatest().then<Object>(
              (_) => 'ok',
              onError: (Object e) => e,
            ),
        Future<Object>.delayed(
          const Duration(milliseconds: 200),
          () => 'pending',
        ),
      ]);
      expect(outcome, 'pending');
    });
  });

  group('SanookDataSource — close()', () {
    test('forwards close to the underlying client', () {
      final client = _MockClient();
      when(client.close).thenReturn(null);
      final source = SanookDataSource(client: client);
      source.close();
      verify(client.close).called(1);
    });
  });
}

class _NetworkError implements Exception {
  const _NetworkError(this.message);
  final String message;
  @override
  String toString() => 'NetworkError: $message';
}
