import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../../../shared/models/ticket.dart';
import '../../domain/match_result.dart';
import 'match_badge.dart';

class TicketMatchCard extends StatelessWidget {
  const TicketMatchCard({
    super.key,
    required this.ticket,
    required this.match,
    this.isLoading = false,
    this.hasError = false,
  });

  final Ticket ticket;
  final MatchResult? match;
  final bool isLoading;
  final bool hasError;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _NumberRow(numbers: ticket.numbers, match: match),
            const SizedBox(height: 12),
            Row(
              children: [
                Icon(
                  Icons.calendar_today,
                  size: 16,
                  color: theme.colorScheme.onSurfaceVariant,
                ),
                const SizedBox(width: 6),
                Text(
                  _formatDate(ticket.drawDate),
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
                const Spacer(),
                _badge(),
              ],
            ),
            if (ticket.note != null && ticket.note!.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(
                ticket.note!,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _badge() {
    if (isLoading) return const MatchBadge.loading();
    if (hasError || match == null) return const MatchBadge.error();
    return MatchBadge.result(match!);
  }

  String _formatDate(DateTime date) {
    return DateFormat.yMMMd('th').format(date);
  }
}

class _NumberRow extends StatelessWidget {
  const _NumberRow({required this.numbers, required this.match});

  final String numbers;
  final MatchResult? match;

  @override
  Widget build(BuildContext context) {
    final highlight = _highlightIndices();
    final highlightColor = Theme.of(context).colorScheme.primary;
    return Center(
      child: RichText(
        text: TextSpan(
          style: const TextStyle(
            fontSize: 32,
            fontFeatures: [FontFeature.tabularFigures()],
            letterSpacing: 4,
            color: Colors.black87,
            fontWeight: FontWeight.w600,
          ),
          children: [
            for (var i = 0; i < numbers.length; i++)
              TextSpan(
                text: numbers[i],
                style: highlight.contains(i)
                    ? TextStyle(
                        color: highlightColor,
                        fontWeight: FontWeight.w900,
                      )
                    : null,
              ),
          ],
        ),
      ),
    );
  }

  Set<int> _highlightIndices() {
    final m = match;
    if (m is! Match) return const {};
    final digits = m.matchedDigits;
    if (digits.isEmpty || digits.length > numbers.length) return const {};
    if (numbers.endsWith(digits)) {
      final start = numbers.length - digits.length;
      return {for (var i = start; i < numbers.length; i++) i};
    }
    if (numbers.startsWith(digits)) {
      return {for (var i = 0; i < digits.length; i++) i};
    }
    return const {};
  }
}
