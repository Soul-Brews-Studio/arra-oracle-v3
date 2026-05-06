import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../data/providers.dart';

class DrawFilterBar extends ConsumerWidget {
  const DrawFilterBar({super.key});

  static final _chipFmt = DateFormat('d MMM yy', 'th');

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final filter = ref.watch(drawFilterProvider);
    final theme = Theme.of(context);
    final hasRange = filter.startDate != null && filter.endDate != null;

    return Material(
      color: theme.colorScheme.surface,
      elevation: 0,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
        child: Row(
          children: [
            FilterChip(
              key: const Key('drawFilter.dateRangeChip'),
              label: Text(_dateLabel(filter)),
              avatar: Icon(
                Icons.calendar_today,
                size: 16,
                color: hasRange
                    ? theme.colorScheme.onSecondaryContainer
                    : theme.colorScheme.onSurfaceVariant,
              ),
              selected: hasRange,
              onSelected: (_) => _pickDateRange(context, ref, filter),
              showCheckmark: false,
              onDeleted: hasRange
                  ? () => ref.read(drawFilterProvider.notifier).state =
                      filter.copyWith(clearDateRange: true)
                  : null,
              deleteIcon: const Icon(Icons.close, size: 16),
              deleteButtonTooltipMessage: 'ล้างช่วงวันที่',
            ),
            const Spacer(),
            if (filter.isActive)
              TextButton.icon(
                key: const Key('drawFilter.resetButton'),
                onPressed: () => ref.read(drawFilterProvider.notifier).state =
                    const DrawFilter(),
                icon: const Icon(Icons.filter_alt_off, size: 18),
                label: const Text('ล้างตัวกรอง'),
              ),
          ],
        ),
      ),
    );
  }

  String _dateLabel(DrawFilter filter) {
    final start = filter.startDate;
    final end = filter.endDate;
    if (start == null || end == null) return 'ช่วงวันที่';
    if (start == end ||
        (start.year == end.year &&
            start.month == end.month &&
            start.day == end.day)) {
      return _chipFmt.format(start);
    }
    return '${_chipFmt.format(start)} – ${_chipFmt.format(end)}';
  }

  Future<void> _pickDateRange(
    BuildContext context,
    WidgetRef ref,
    DrawFilter current,
  ) async {
    final now = DateTime.now();
    final picked = await showDateRangePicker(
      context: context,
      firstDate: DateTime(now.year - 5),
      lastDate: DateTime(now.year + 1, 12, 31),
      initialDateRange: (current.startDate != null && current.endDate != null)
          ? DateTimeRange(start: current.startDate!, end: current.endDate!)
          : null,
      helpText: 'เลือกช่วงวันที่',
      cancelText: 'ยกเลิก',
      confirmText: 'ตกลง',
      saveText: 'บันทึก',
    );
    if (picked == null) return;
    ref.read(drawFilterProvider.notifier).state = current.copyWith(
      startDate: picked.start,
      endDate: picked.end,
    );
  }
}
