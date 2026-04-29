import 'package:http/http.dart' as http;

import '../../../../shared/models/draw.dart';
import 'lottery_data_source.dart';
import 'sanook_html_parser.dart';

class SanookDataSource implements LotteryDataSource {
  SanookDataSource({http.Client? client, String? baseUrl})
      : _client = client ?? http.Client(),
        _baseUrl = baseUrl ?? _defaultBaseUrl;

  static const String _defaultBaseUrl = 'https://news.sanook.com/lotto/';
  static const String _userAgent = 'LottoChecker/0.1 (personal-use)';
  static const Duration _timeout = Duration(seconds: 10);
  static const int _maxRetries = 3;
  static const Duration _initialBackoff = Duration(milliseconds: 250);

  final http.Client _client;
  final String _baseUrl;

  @override
  Future<Draw> fetchLatest() async {
    final body = await _get(_baseUrl);
    final date = parseSanookLatestDate(body) ?? _today();
    return parseSanookHtml(body, date);
  }

  @override
  Future<Draw?> fetchByDate(DateTime drawDate) async {
    final body = await _get(_baseUrl);
    final latest = parseSanookLatestDate(body);
    if (latest == null) return null;
    if (!_sameDay(latest, drawDate)) return null;
    try {
      return parseSanookHtml(body, drawDate);
    } on ParseException {
      return null;
    }
  }

  void close() => _client.close();

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
        if (res.statusCode == 200) {
          return res.body;
        }
        if (res.statusCode < 500) {
          throw FetchException(
            'non-200 response',
            statusCode: res.statusCode,
          );
        }
        lastError =
            FetchException('server error', statusCode: res.statusCode);
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
