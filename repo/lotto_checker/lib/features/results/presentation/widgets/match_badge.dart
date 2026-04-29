import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../../../shared/models/prize.dart';
import '../../domain/match_result.dart';

enum MatchBadgeStatus { loading, error, result }

class MatchBadge extends StatelessWidget {
  const MatchBadge.loading({super.key})
      : status = MatchBadgeStatus.loading,
        result = null;

  const MatchBadge.error({super.key})
      : status = MatchBadgeStatus.error,
        result = null;

  const MatchBadge.result(this.result, {super.key})
      : status = MatchBadgeStatus.result;

  final MatchBadgeStatus status;
  final MatchResult? result;

  @override
  Widget build(BuildContext context) {
    final palette = _palette();
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: palette.background,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: palette.border),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (status == MatchBadgeStatus.loading) ...[
            SizedBox(
              width: 14,
              height: 14,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: palette.foreground,
              ),
            ),
            const SizedBox(width: 8),
          ] else ...[
            Icon(palette.icon, size: 16, color: palette.foreground),
            const SizedBox(width: 6),
          ],
          Flexible(
            child: Text(
              _label(),
              style: TextStyle(
                color: palette.foreground,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }

  String _label() {
    switch (status) {
      case MatchBadgeStatus.loading:
        return 'กำลังตรวจ...';
      case MatchBadgeStatus.error:
        return 'ตรวจไม่ได้';
      case MatchBadgeStatus.result:
        final r = result!;
        return switch (r) {
          NoMatch() => 'ไม่ถูก',
          Match(:final tier, :final prizeAmount) =>
            '${tier.label} ${_formatAmount(prizeAmount)} บาท',
        };
    }
  }

  _BadgePalette _palette() {
    switch (status) {
      case MatchBadgeStatus.loading:
      case MatchBadgeStatus.error:
        return const _BadgePalette(
          background: Color(0xFFEEEEEE),
          foreground: Color(0xFF555555),
          border: Color(0xFFCCCCCC),
          icon: Icons.help_outline,
        );
      case MatchBadgeStatus.result:
        final r = result!;
        return switch (r) {
          NoMatch() => const _BadgePalette(
              background: Color(0xFFEEEEEE),
              foreground: Color(0xFF555555),
              border: Color(0xFFCCCCCC),
              icon: Icons.cancel_outlined,
            ),
          Match(:final tier) when _isMajor(tier) => const _BadgePalette(
              background: Color(0xFFE6F4EA),
              foreground: Color(0xFF1B5E20),
              border: Color(0xFF66BB6A),
              icon: Icons.celebration,
            ),
          Match() => const _BadgePalette(
              background: Color(0xFFFFF8E1),
              foreground: Color(0xFF8D6E00),
              border: Color(0xFFFFD54F),
              icon: Icons.emoji_events_outlined,
            ),
        };
    }
  }
}

bool _isMajor(PrizeTier tier) => tier.amount >= 10000;

String _formatAmount(int amount) =>
    NumberFormat.decimalPattern('th').format(amount);

class _BadgePalette {
  const _BadgePalette({
    required this.background,
    required this.foreground,
    required this.border,
    required this.icon,
  });
  final Color background;
  final Color foreground;
  final Color border;
  final IconData icon;
}
