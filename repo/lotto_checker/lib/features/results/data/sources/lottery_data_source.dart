import '../../../../shared/models/draw.dart';

abstract class LotteryDataSource {
  Future<Draw> fetchLatest();

  Future<Draw?> fetchByDate(DateTime drawDate);
}

class ParseException implements Exception {
  ParseException(this.message, {this.cause});

  final String message;
  final Object? cause;

  @override
  String toString() =>
      cause == null ? 'ParseException: $message' : 'ParseException: $message (cause: $cause)';
}

class FetchException implements Exception {
  FetchException(this.message, {this.statusCode, this.cause});

  final String message;
  final int? statusCode;
  final Object? cause;

  @override
  String toString() {
    final code = statusCode == null ? '' : ' [HTTP $statusCode]';
    final c = cause == null ? '' : ' (cause: $cause)';
    return 'FetchException: $message$code$c';
  }
}
