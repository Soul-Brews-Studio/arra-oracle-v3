import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../../../shared/models/ticket.dart';
import '../../../results/domain/match_result.dart';
import '../../../results/presentation/widgets/match_badge.dart';

/// A single row in the home-screen ticket list.
///
/// Shows the 6-digit ticket number, draw date, and optional note.
/// Provides an edit icon; swipe-to-delete is handled by the parent list.
class TicketListTile extends StatelessWidget {
  const TicketListTile({
    super.key,
    required this.ticket,
    required this.onEdit,
    this.match,
  });

  final Ticket ticket;
  final VoidCallback onEdit;

  /// null = matches still loading; provided = show badge/label.
  final MatchResult? match;

  static final _dateFmt = DateFormat('d MMM yyyy', 'th');

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      leading: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: colorScheme.primaryContainer,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Text(
          _spaced(ticket.numbers),
          style: TextStyle(
            fontSize: 17,
            fontWeight: FontWeight.bold,
            letterSpacing: 2,
            fontFeatures: const [FontFeature.tabularFigures()],
            color: colorScheme.onPrimaryContainer,
          ),
        ),
      ),
      title: Text(
        'งวด ${_dateFmt.format(ticket.drawDate)}',
        style: theme.textTheme.bodyMedium,
      ),
      subtitle: ticket.note != null && ticket.note!.isNotEmpty
          ? Text(
              ticket.note!,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: colorScheme.outline),
            )
          : null,
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          _buildBadge(context),
          IconButton(
            icon: const Icon(Icons.edit_outlined, size: 20),
            tooltip: 'แก้ไข',
            onPressed: onEdit,
            visualDensity: VisualDensity.compact,
          ),
        ],
      ),
    );
  }

  Widget _buildBadge(BuildContext context) {
    final m = match;
    if (m == null) {
      return const SizedBox(
        width: 14,
        height: 14,
        child: CircularProgressIndicator(strokeWidth: 2),
      );
    }
    return switch (m) {
      NoMatch() => Text(
          'ไม่ถูก',
          style: TextStyle(
            fontSize: 12,
            color: Theme.of(context).colorScheme.outline,
          ),
        ),
      Match() => MatchBadge.compact(m),
    };
  }

  String _spaced(String n) => n.split('').join(' ');
}

/// Sticky header showing the draw date for a group of tickets.
class TicketDateHeader extends StatelessWidget {
  const TicketDateHeader({super.key, required this.drawDate});

  final DateTime drawDate;

  static final _fmt = DateFormat('d MMMM yyyy', 'th');

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      color: theme.colorScheme.surfaceContainerHighest,
      child: Text(
        'งวด ${_fmt.format(drawDate)}',
        style: theme.textTheme.labelMedium?.copyWith(
          color: theme.colorScheme.onSurfaceVariant,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}
