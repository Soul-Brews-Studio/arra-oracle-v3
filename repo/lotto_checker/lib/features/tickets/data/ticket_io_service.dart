import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../shared/models/ticket.dart';
import 'providers.dart';
import 'ticket_repository.dart';

/// Top-level metadata shape for an exported ticket archive.
const String kTicketExportApp = 'lotto_checker';
const int kTicketExportVersion = 1;

/// Result of a successful import — count of tickets written.
class ImportResult {
  const ImportResult({required this.imported, required this.total});
  final int imported;
  final int total;
}

/// Thrown by [TicketIoService.decode] when JSON shape is wrong.
class TicketImportFormatException implements Exception {
  TicketImportFormatException(this.message);
  final String message;
  @override
  String toString() => 'TicketImportFormatException: $message';
}

/// Pure (filesystem-free) export/import logic for tickets.
///
/// The repository is the only side-effect. UI code wraps [encode]/[decode]
/// with `share_plus` and `file_picker` calls.
class TicketIoService {
  TicketIoService(this._repo);

  final TicketRepository _repo;

  /// Build the JSON archive string for every saved ticket.
  Future<String> exportJsonString({DateTime? now}) async {
    final tickets = await _repo.getAll();
    return encode(tickets, now: now);
  }

  /// Persist every ticket from [archiveJson]. Existing ids are overwritten
  /// because [TicketRepository.save] upserts.
  Future<ImportResult> importJsonString(String archiveJson) async {
    final tickets = decode(archiveJson);
    for (final t in tickets) {
      await _repo.save(t);
    }
    return ImportResult(imported: tickets.length, total: tickets.length);
  }

  /// Pure encoder — used directly by tests and by [exportJsonString].
  static String encode(List<Ticket> tickets, {DateTime? now}) {
    final stamp = (now ?? DateTime.now().toUtc()).toIso8601String();
    final payload = <String, dynamic>{
      'app': kTicketExportApp,
      'version': kTicketExportVersion,
      'exportedAt': stamp,
      'tickets': tickets.map((t) => t.toJson()).toList(),
    };
    return const JsonEncoder.withIndent('  ').convert(payload);
  }

  /// Pure decoder. Throws [TicketImportFormatException] on shape errors.
  static List<Ticket> decode(String raw) {
    final dynamic root;
    try {
      root = jsonDecode(raw);
    } on FormatException catch (e) {
      throw TicketImportFormatException('ไฟล์ไม่ใช่ JSON ที่ถูกต้อง: ${e.message}');
    }
    if (root is! Map<String, dynamic>) {
      throw TicketImportFormatException('โครงสร้างไม่ถูกต้อง: ต้องเป็น object');
    }
    if (root['app'] != kTicketExportApp) {
      throw TicketImportFormatException(
        'ไฟล์นี้ไม่ใช่ของ lotto_checker (app=${root['app']})',
      );
    }
    final version = root['version'];
    if (version is! int || version > kTicketExportVersion) {
      throw TicketImportFormatException('ไม่รองรับ version=$version');
    }
    final list = root['tickets'];
    if (list is! List) {
      throw TicketImportFormatException('"tickets" ต้องเป็น array');
    }
    final result = <Ticket>[];
    for (final item in list) {
      if (item is! Map<String, dynamic>) {
        throw TicketImportFormatException(
          'ticket entry ต้องเป็น object: $item',
        );
      }
      result.add(Ticket.fromJson(item));
    }
    return result;
  }
}

/// Riverpod-wired service. Tests can override [ticketRepositoryProvider]
/// to substitute an in-memory implementation.
final ticketIoServiceProvider = Provider<TicketIoService>((ref) {
  return TicketIoService(ref.watch(ticketRepositoryProvider));
});
