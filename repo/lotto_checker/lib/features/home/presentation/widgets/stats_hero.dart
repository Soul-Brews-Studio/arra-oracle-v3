import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../../shared/models/ticket.dart';
import '../../../results/application/providers.dart';
import '../../../results/domain/match_result.dart';
import '../../../tickets/data/providers.dart';

/// Gradient hero card summarising the user's tickets.
///
/// Shows three count-up metrics: total tickets, total wins, total prize.
/// Hidden when the user has zero tickets so the empty state stays clean.
class StatsHero extends ConsumerWidget {
  const StatsHero({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tickets = ref.watch(allTicketsProvider).maybeWhen<List<Ticket>>(
          data: (t) => t,
          orElse: () => const <Ticket>[],
        );
    if (tickets.isEmpty) return const SizedBox.shrink();

    final matches = ref.watch(allTicketMatchesProvider).maybeWhen(
          data: (m) => m,
          orElse: () => const <String, MatchResult>{},
        );

    var wins = 0;
    var prize = 0;
    for (final m in matches.values) {
      if (m is Match) {
        wins++;
        prize += m.prizeAmount;
      }
    }

    return _HeroCard(
      tickets: tickets.length,
      wins: wins,
      prize: prize,
    );
  }
}

class _HeroCard extends StatelessWidget {
  const _HeroCard({
    required this.tickets,
    required this.wins,
    required this.prize,
  });

  final int tickets;
  final int wins;
  final int prize;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      margin: const EdgeInsets.fromLTRB(12, 8, 12, 6),
      clipBehavior: Clip.antiAlias,
      elevation: 0,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 18, horizontal: 8),
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [scheme.primary, scheme.primaryContainer],
          ),
        ),
        child: Row(
          children: [
            Expanded(
              child: _StatTile(
                label: 'ตั๋วทั้งหมด',
                value: tickets,
                suffix: ' ใบ',
                color: scheme.onPrimary,
              ),
            ),
            _Divider(color: scheme.onPrimary),
            Expanded(
              child: _StatTile(
                label: 'ถูกรางวัล',
                value: wins,
                suffix: ' ใบ',
                color: scheme.onPrimary,
              ),
            ),
            _Divider(color: scheme.onPrimary),
            Expanded(
              child: _StatTile(
                label: 'ได้รวม',
                value: prize,
                suffix: ' ฿',
                color: scheme.onPrimary,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _StatTile extends StatelessWidget {
  const _StatTile({
    required this.label,
    required this.value,
    required this.suffix,
    required this.color,
  });

  final String label;
  final int value;
  final String suffix;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final fmt = NumberFormat.decimalPattern('th');
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: value.toDouble()),
      duration: const Duration(milliseconds: 800),
      curve: Curves.easeOutCubic,
      builder: (_, v, __) {
        return Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              '${fmt.format(v.round())}$suffix',
              style: theme.textTheme.titleLarge?.copyWith(
                color: color,
                fontWeight: FontWeight.w700,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            const SizedBox(height: 2),
            Text(
              label,
              style: theme.textTheme.bodySmall?.copyWith(
                color: color,
              ),
              maxLines: 1,
            ),
          ],
        );
      },
    );
  }
}

class _Divider extends StatelessWidget {
  const _Divider({required this.color});

  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 1,
      height: 32,
      color: color,
    );
  }
}
