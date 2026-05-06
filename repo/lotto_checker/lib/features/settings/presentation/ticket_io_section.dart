import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import '../../tickets/data/ticket_io_service.dart';

/// Settings section for exporting/importing tickets as JSON.
class TicketIoSection extends ConsumerWidget {
  const TicketIoSection({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    return Column(
      children: [
        ListTile(
          leading: Icon(
            Icons.upload_file_outlined,
            color: theme.colorScheme.primary,
          ),
          title: const Text('ส่งออก JSON'),
          subtitle: const Text('แชร์ไฟล์สำรองตั๋วทั้งหมด'),
          onTap: () => _onExport(context, ref),
        ),
        ListTile(
          leading: Icon(
            Icons.download_outlined,
            color: theme.colorScheme.primary,
          ),
          title: const Text('นำเข้า JSON'),
          subtitle: const Text('เลือกไฟล์ที่เคยส่งออก'),
          onTap: () => _onImport(context, ref),
        ),
      ],
    );
  }

  Future<void> _onExport(BuildContext context, WidgetRef ref) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      final io = ref.read(ticketIoServiceProvider);
      final json = await io.exportJsonString();
      final dir = await getTemporaryDirectory();
      final stamp = DateTime.now()
          .toIso8601String()
          .replaceAll(':', '-')
          .split('.')
          .first;
      final file = File('${dir.path}/lotto-tickets-$stamp.json');
      await file.writeAsString(json);
      await Share.shareXFiles(
        [XFile(file.path, mimeType: 'application/json')],
        subject: 'Lotto Checker — ส่งออกตั๋ว',
      );
      messenger.showSnackBar(
        const SnackBar(content: Text('ส่งออกตั๋วเรียบร้อย')),
      );
    } catch (e, st) {
      debugPrintStack(stackTrace: st, label: 'export');
      messenger.showSnackBar(
        SnackBar(content: Text('ส่งออกล้มเหลว: $e')),
      );
    }
  }

  Future<void> _onImport(BuildContext context, WidgetRef ref) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      final picked = await FilePicker.platform.pickFiles(
        type: FileType.custom,
        allowedExtensions: ['json'],
        withData: true,
      );
      if (picked == null || picked.files.isEmpty) return;
      final pickedFile = picked.files.first;
      final raw = await _readPickedFile(pickedFile);
      if (raw == null) {
        messenger.showSnackBar(
          const SnackBar(content: Text('อ่านไฟล์ไม่ได้')),
        );
        return;
      }

      final tickets = TicketIoService.decode(raw);
      if (!context.mounted) return;
      final confirmed = await _confirmImport(context, tickets.length);
      if (confirmed != true) return;

      final io = ref.read(ticketIoServiceProvider);
      final result = await io.importJsonString(raw);
      messenger.showSnackBar(
        SnackBar(content: Text('นำเข้า ${result.imported} ตั๋วเรียบร้อย')),
      );
    } on TicketImportFormatException catch (e) {
      messenger.showSnackBar(
        SnackBar(content: Text('ไฟล์ไม่ถูกต้อง: ${e.message}')),
      );
    } catch (e, st) {
      debugPrintStack(stackTrace: st, label: 'import');
      messenger.showSnackBar(
        SnackBar(content: Text('นำเข้าล้มเหลว: $e')),
      );
    }
  }

  Future<String?> _readPickedFile(PlatformFile picked) async {
    if (picked.bytes != null) {
      return String.fromCharCodes(picked.bytes!);
    }
    final path = picked.path;
    if (path == null) return null;
    return File(path).readAsString();
  }

  Future<bool?> _confirmImport(BuildContext context, int count) {
    return showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('ยืนยันการนำเข้า'),
        content: Text(
          'นำเข้า $count ตั๋ว — ตั๋วที่มี id ซ้ำจะถูกเขียนทับ',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('ยกเลิก'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('นำเข้า'),
          ),
        ],
      ),
    );
  }
}
