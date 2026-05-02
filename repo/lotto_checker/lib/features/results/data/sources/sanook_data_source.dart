import 'package:http/http.dart' as http;

import '../../../../shared/models/draw.dart';
import 'lottery_data_source.dart';
import 'sanook_html_parser.dart';
import 'sanook_per_draw_html_parser.dart';

/// Fetches Thai lottery results from news.sanook.com.
///
/// Strategy (Phase 5):
///   1. Fetch the home page to discover the latest draw date.
///   2. Fetch the per-draw page (DDMMYYYY with Buddhist-Era year) which
///      carries all 9 prize tiers.
///   3. Fall back to the home-page 4-tier parse if the per-draw fetch fails.
class SanookDataSource implements LotteryDataSource {
  SanookDataSource({
    http.Client? client,
    String? baseUrl,
    String? perDrawBaseUrl,
  })  : _client = client ?? http.Client(),
        _baseUrl = baseUrl ?? _defaultBaseUrl,
        _perDrawBaseUrl = perDrawBaseUrl ?? _defaultPerDrawBase;

  static const String _defaultBaseUrl = 'https://news.sanook.com/lotto/';
  static const String _defaultPerDrawBase =
      'https://news.sanook.com/lotto/check/';
  static const String _userAgent = 'LottoChecker/0.1 (personal-use)';
  static const Duration _timeout = Duration(seconds: 10);
  static const int _maxRetries = 3;
  static const Duration _initialBackoff = Duration(milliseconds: 250);

  final http.Client _client;
  final String _baseUrl;
  final String _perDrawBaseUrl;

  @override
  Future<Draw> fetchLatest() async {
    // Step 1: discover draw date from home page.
    final homeBody = await _get(_baseUrl);
    final date = parseSanookLatestDate(homeBody) ?? _today();

    // Step 2: fetch per-draw page for all 9 tiers.
    return await _fetchPerDraw(date) ?? parseSanookHtml(homeBody, date);
  }

  @override
  Future<Draw?> fetchByDate(DateTime drawDate) async {
    // Try per-draw page directly — it's date-addressed.
    final draw = await _fetchPerDraw(drawDate);
    if (draw != null) return draw;

    // Fall back: check home page for the same draw date (4 tiers only).
    final homeBody = await _get(_baseUrl);
    final latest = parseSanookLatestDate(homeBody);
    if (latest == null || !_sameDay(latest, drawDate)) return null;
    try {
      return parseSanookHtml(homeBody, drawDate);
    } on ParseException {
      return null;
    }
  }

  void close() => _client.close();

  // ── private helpers ─────────────────────────────────────────────────────────

  /// Fetches the per-draw page for [date] and parses all 9 tiers.
  /// Returns `null` on any fetch or parse failure (caller decides fallback).
  Future<Draw?> _fetchPerDraw(DateTime date) async {
    final url = sanookPerDrawUrl(date, base: _perDrawBaseUrl);
    try {
      final body = await _get(url);
      return parseSanookPerDrawHtml(body, date);
    } catch (_) {
      return null;
    }
  }

  Future<String> _get(String url) async {
    Object? lastError;
    for (var attempt = 0; attempt < _maxRetries; attempt++) {
      if (attempt > 0) {
        await Future<void>.delayed(_initialBackoff * (1 << (attempt - 1)));
      }
      try {
        final res = await _client
            .get(Uri.parse(url), headers: const {'User-Agent': _userAgent})
            .timeout(_timeout);
        if (res.statusCode == 200) return res.body;
        if (res.statusCode < 500) {
          throw FetchException('non-200 response', statusCode: res.statusCode);
        }
        lastError = FetchException('server error', statusCode: res.statusCode);
      } on FetchException catch (e) {
        if (e.statusCode != null && e.statusCode! < 500) rethrow;
        lastError = e;
      } catch (e) {
        lastError = e;
      }
    }
    throw FetchException('exhausted retries', cause: lastError);
  }

  static bool _sameDay(DateTime a, DateTime b) =>
      a.year == b.year && a.month == b.month && a.day == b.day;

  DateTime _today() {
    final now = DateTime.now();
    return DateTime(now.year, now.month, now.day);
  }
}
