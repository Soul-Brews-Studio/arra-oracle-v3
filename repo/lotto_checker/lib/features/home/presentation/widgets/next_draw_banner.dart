import 'dart:async';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

/// Banner that counts down to the next Thai-government lottery draw.
///
/// Draws fall on the 1st and 16th of each month (Asia/Bangkok). Updates
/// every 60 s while mounted; the timer is cancelled on dispose.
class NextDrawBanner extends StatefulWidget {
  const NextDrawBanner({super.key, DateTime Function()? clock})
      : _clock = clock;

  final DateTime Function()? _clock;

  @override
  State<NextDrawBanner> createState() => _NextDrawBannerState();
}

class _NextDrawBannerState extends State<NextDrawBanner> {
  Timer? _ticker;
  late DateTime _now;

  DateTime _readClock() => (widget._clock ?? DateTime.now)();

  @override
  void initState() {
    super.initState();
    _now = _readClock();
    _ticker = Timer.periodic(const Duration(seconds: 60), (_) {
      if (!mounted) return;
      setState(() => _now = _readClock());
    });
  }

  @override
  void dispose() {
    _ticker?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final draw = nextDrawDate(_now);
    final remaining = draw.difference(_now);
    final days = remaining.inDays;
    final hours = remaining.inHours.remainder(24);
    final mins = remaining.inMinutes.remainder(60);
    final dateStr = DateFormat('d MMMM y', 'th').format(draw);
    final scheme = Theme.of(context).colorScheme;
    final theme = Theme.of(context);

    return Card(
      margin: const EdgeInsets.fromLTRB(12, 12, 12, 0),
      color: scheme.surfaceContainerHigh,
      elevation: 0,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        child: Row(
          children: [
            Icon(Icons.event_outlined, color: scheme.primary),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    'ออกผลครั้งถัดไป',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    dateStr,
                    style: theme.textTheme.titleMedium?.copyWith(
                      color: scheme.onSurface,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
            ),
            Text(
              _remainingLabel(days, hours, mins),
              style: theme.textTheme.bodyMedium?.copyWith(
                color: scheme.primary,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

String _remainingLabel(int days, int hours, int mins) {
  if (days < 0) return 'อีกไม่นาน';
  return 'อีก $days วัน $hours ชม. $mins นาที';
}

/// Returns the next Thai-lottery draw date strictly on or after [now].
///
/// Draws are the 1st and 16th of each calendar month. If today is itself a
/// draw day, today is returned (countdown shows hours/minutes left).
DateTime nextDrawDate(DateTime now) {
  final today = DateTime(now.year, now.month, now.day);
  if (today.day == 1 || today.day == 16) return today;
  if (today.day < 16) return DateTime(now.year, now.month, 16);
  if (now.month == 12) return DateTime(now.year + 1, 1, 1);
  return DateTime(now.year, now.month + 1, 1);
}
