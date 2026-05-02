import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:lotto_checker/features/results/data/sources/sanook_data_source.dart';
import 'package:lotto_checker/shared/models/prize.dart';
import 'package:mocktail/mocktail.dart';

class _MockClient extends Mock implements http.Client {}

class _FakeUri extends Fake implements Uri {}

/// Builds a 200 OK HTML response with a UTF-8 body. Plain
/// `http.Response(body, 200)` defaults to Latin-1 and chokes on the Thai
/// labels embedded in the sanook fixture.
http.Response _okHtml(String body) => http.Response.bytes(
      utf8.encode(body),
      200,
      headers: const {'content-type': 'text/html; charset=utf-8'},
    );

const String _validHtml = '''
<article class="lotto-check__article">
  <time datetime="2026-04-16 13:00" class="lotto-check__time">16/04/2026</time>
  <p class="lotto-check__para lotto-check__para--half">
    <small class="lotto-check__item">รางวัลที่ 1</small>
    <b class="lotto__number lotto__number--three">309612</b>
  </p>
  <p class="lotto-check__para">
    <small class="lotto-check__item">เลขหน้า 3 ตัว</small>
    <b class="lotto__number lotto__number--three">355</b>
    <b class="lotto__number lotto__number--three">108</b>
  </p>
  <p class="lotto-check__para">
    <small class="lotto-check__item">เลขท้าย 3 ตัว</small>
    <b class="lotto__number lotto__number--three">868</b>
    <b class="lotto__number lotto__number--three">424</b>
  </p>
  <p class="lotto-check__para lotto-check__para--half">
    <small class="lotto-check__item">เลขท้าย 2 ตัว</small>
    <b class="lotto__number lotto__number--three">77</b>
  </p>
</article>
''';

void main() {
  setUpAll(() {
    registerFallbackValue(_FakeUri());
  });

  group('SanookDataSource.fetchLatest — happy path', () {
    test('returns parsed Draw when 200 OK with valid HTML', () async {
      final client = _MockClient();
      when(() => client.get(any(), headers: any(named: 'headers')))
          .thenAnswer((_) async => _okHtml(_validHtml));
      final source = SanookDataSource(client: client);

      final draw = await source.fetchLatest();
      expect(draw.winningNumbers[PrizeTier.first], ['309612']);
      expect(draw.winningNumbers[PrizeTier.twoDigitBack], ['77']);
      expect(draw.winningNumbers[PrizeTier.threeDigitFront], ['355', '108']);
    });

    test('extracts drawDate from <time datetime="…"> on the page', () async {
      final client = _MockClient();
      when(() => client.get(any(), headers: any(named: 'headers')))
          .thenAnswer((_) async => _okHtml(_validHtml));
      final source = SanookDataSource(client: client);

      final draw = await source.fetchLatest();
      expect(draw.drawDate, DateTime(2026, 4, 16));
    });

    test('falls back to today when page exposes no datetime', () async {
      const noDateHtml = '<article class="lotto-check__article">'
          '<p class="lotto-check__para">'
          '<small class="lotto-check__item">รางวัลที่ 1</small>'
          '<b class="lotto__number">111111</b>'
          '</p>'
          '</article>';
      final client = _MockClient();
      when(() => client.get(any(), headers: any(named: 'headers')))
          .thenAnswer((_) async => _okHtml(noDateHtml));
      final source = SanookDataSource(client: client);

      final draw = await source.fetchLatest();
      final now = DateTime.now();
      expect(draw.drawDate.year, now.year);
      expect(draw.drawDate.month, now.month);
      expect(draw.drawDate.day, now.day);
    });

    test('sends LottoChecker User-Agent header', () async {
      final client = _MockClient();
      when(() => client.get(any(), headers: any(named: 'headers')))
          .thenAnswer((_) async => _okHtml(_validHtml));
      final source = SanookDataSource(client: client);

      await source.fetchLatest();
      // fetchLatest makes ≥2 calls (home page + per-draw). Check the first.
      final captured = verify(
        () => client.get(any(), headers: captureAny(named: 'headers')),
      ).captured.first as Map<String, String>;
      expect(captured['User-Agent'], 'LottoChecker/0.1 (personal-use)');
    });

    test('hits the configured baseUrl', () async {
      final client = _MockClient();
      when(() => client.get(any(), headers: any(named: 'headers')))
          .thenAnswer((_) async => _okHtml(_validHtml));
      final source = SanookDataSource(
        client: client,
        baseUrl: 'https://example.test/lotto/',
      );

      await source.fetchLatest();
      // First call is always the home page; per-draw follows.
      final captured =
          verify(() => client.get(captureAny(), headers: any(named: 'headers')))
              .captured
              .first as Uri;
      expect(captured.toString(), 'https://example.test/lotto/');
    });

    test('defaults to news.sanook.com/lotto/ when no baseUrl provided',
        () async {
      final client = _MockClient();
      when(() => client.get(any(), headers: any(named: 'headers')))
          .thenAnswer((_) async => _okHtml(_validHtml));
      final source = SanookDataSource(client: client);

      await source.fetchLatest();
      // First call is always the home page.
      final captured =
          verify(() => client.get(captureAny(), headers: any(named: 'headers')))
              .captured
              .first as Uri;
      expect(captured.toString(), 'https://news.sanook.com/lotto/');
    });
  });

  group('SanookDataSource.fetchByDate', () {
    test('returns parsed Draw when requested date matches latest article',
        () async {
      final client = _MockClient();
      when(() => client.get(any(), headers: any(named: 'headers')))
          .thenAnswer((_) async => _okHtml(_validHtml));
      final source = SanookDataSource(client: client);

      final draw = await source.fetchByDate(DateTime(2026, 4, 16));
      expect(draw, isNotNull);
      expect(draw!.drawDate, DateTime(2026, 4, 16));
      expect(draw.winningNumbers[PrizeTier.first], ['309612']);
    });

    test('returns null when requested date does not match latest article',
        () async {
      final client = _MockClient();
      when(() => client.get(any(), headers: any(named: 'headers')))
          .thenAnswer((_) async => _okHtml(_validHtml));
      final source = SanookDataSource(client: client);

      expect(await source.fetchByDate(DateTime(2026, 4, 1)), isNull);
    });

    test('returns null when html has no parseable article', () async {
      final client = _MockClient();
      when(() => client.get(any(), headers: any(named: 'headers')))
          .thenAnswer((_) async => http.Response('<html></html>', 200));
      final source = SanookDataSource(client: client);

      expect(await source.fetchByDate(DateTime(2026, 4, 16)), isNull);
    });
  });

}
