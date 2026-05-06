import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../../../shared/models/draw.dart';
import '../../../../shared/models/prize.dart';

class DrawCard extends StatelessWidget {
  const DrawCard({required this.draw, super.key});

  final Draw draw;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final firstPrize = draw.winningNumbers[PrizeTier.first]?.firstOrNull ?? '—';

    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      child: ExpansionTile(
        key: PageStorageKey(draw.drawDate),
        leading: DateChip(date: draw.drawDate),
        title: Text(
          'รางวัลที่ 1',
          style: theme.textTheme.labelMedium?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
        subtitle: Text(
          _spaced(firstPrize),
          style: theme.textTheme.titleLarge?.copyWith(
            fontWeight: FontWeight.w800,
            letterSpacing: 4,
            color: theme.colorScheme.primary,
          ),
        ),
        childrenPadding:
            const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        expandedCrossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Divider(height: 1),
          const SizedBox(height: 8),
          for (final tier in PrizeTier.values)
            if (draw.winningNumbers.containsKey(tier))
              TierRow(tier: tier, numbers: draw.winningNumbers[tier]!),
        ],
      ),
    );
  }

  String _spaced(String n) => n.split('').join(' ');
}

class DateChip extends StatelessWidget {
  const DateChip({required this.date, super.key});

  final DateTime date;
  static final _shortFmt = DateFormat('d MMM\nyyyy', 'th');

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: theme.colorScheme.secondaryContainer,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        _shortFmt.format(date),
        textAlign: TextAlign.center,
        style: theme.textTheme.labelSmall?.copyWith(
          color: theme.colorScheme.onSecondaryContainer,
          fontWeight: FontWeight.w600,
          height: 1.4,
        ),
      ),
    );
  }
}

class TierRow extends StatelessWidget {
  const TierRow({required this.tier, required this.numbers, super.key});

  final PrizeTier tier;
  final List<String> numbers;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 140,
            child: Text(
              tier.label,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ),
          Expanded(
            child: Wrap(
              spacing: 8,
              runSpacing: 4,
              children: numbers
                  .map(
                    (n) => Text(
                      n,
                      style: theme.textTheme.bodyMedium?.copyWith(
                        fontWeight: FontWeight.w600,
                        fontFeatures: const [FontFeature.tabularFigures()],
                      ),
                    ),
                  )
                  .toList(),
            ),
          ),
        ],
      ),
    );
  }
}
