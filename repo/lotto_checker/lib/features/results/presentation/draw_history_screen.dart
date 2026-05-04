import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../shared/models/draw.dart';
import '../../../shared/models/prize.dart';
import '../data/providers.dart';

class DrawHistoryScreen extends ConsumerWidget {
  const DrawHistoryScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final drawsAsync = ref.watch(allDrawsProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('ประวัติผลรางวัล'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          tooltip: 'กลับ',
          onPressed: () => context.canPop() ? context.pop() : context.go('/'),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            tooltip: 'รีเฟรช',
            onPressed: () => ref.invalidate(allDrawsProvider),
          ),
        ],
      ),
      body: drawsAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => _ErrorView(
          message: 'โหลดข้อมูลไม่สำเร็จ: $e',
          onRetry: () => ref.invalidate(allDrawsProvider),
        ),
        data: (draws) {
          if (draws.isEmpty) return const _EmptyView();
          return RefreshIndicator(
            onRefresh: () async {
              ref.invalidate(allDrawsProvider);
              await ref.read(allDrawsProvider.future);
            },
            child: ListView.builder(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.symmetric(vertical: 8),
              itemCount: draws.length,
              itemBuilder: (context, i) => _DrawCard(draw: draws[i]),
            ),
          );
        },
      ),
    );
  }
}

// ── draw card ─────────────────────────────────────────────────────────────────

class _DrawCard extends StatelessWidget {
  const _DrawCard({required this.draw});

  final Draw draw;

  static final _dateFmt = DateFormat('d MMMM yyyy', 'th');

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final firstPrize = draw.winningNumbers[PrizeTier.first]?.firstOrNull ?? '—';

    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      child: ExpansionTile(
        key: PageStorageKey(draw.drawDate),
        leading: _DateChip(date: draw.drawDate),
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
              _TierRow(tier: tier, numbers: draw.winningNumbers[tier]!),
        ],
      ),
    );
  }

  String _spaced(String n) => n.split('').join(' ');
}

// ── date chip ─────────────────────────────────────────────────────────────────

class _DateChip extends StatelessWidget {
  const _DateChip({required this.date});

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

// ── tier row ──────────────────────────────────────────────────────────────────

class _TierRow extends StatelessWidget {
  const _TierRow({required this.tier, required this.numbers});

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

// ── empty / error views ───────────────────────────────────────────────────────

class _EmptyView extends StatelessWidget {
  const _EmptyView();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.history_toggle_off_outlined,
            size: 64,
            color: theme.colorScheme.outline,
          ),
          const SizedBox(height: 16),
          Text(
            'ยังไม่มีข้อมูลผลรางวัล',
            style: theme.textTheme.titleMedium?.copyWith(
              color: theme.colorScheme.outline,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'ดูผลรางวัลเพื่อโหลดข้อมูล',
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.outline,
            ),
          ),
        ],
      ),
    );
  }
}

class _ErrorView extends StatelessWidget {
  const _ErrorView({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline, size: 48, color: Colors.redAccent),
            const SizedBox(height: 12),
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh),
              label: const Text('ลองใหม่'),
            ),
          ],
        ),
      ),
    );
  }
}
