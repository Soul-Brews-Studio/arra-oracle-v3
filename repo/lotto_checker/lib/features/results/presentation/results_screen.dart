import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../shared/models/ticket.dart';
import '../../tickets/data/providers.dart';
import '../application/providers.dart';
import '../domain/match_result.dart';
import 'widgets/ticket_match_card.dart';

class ResultsScreen extends ConsumerWidget {
  const ResultsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ticketsAsync = ref.watch(allTicketsProvider);
    final matchesAsync = ref.watch(allTicketMatchesProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('ผลการตรวจ'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          tooltip: 'กลับ',
          onPressed: () {
            if (context.canPop()) {
              context.pop();
            } else {
              context.go('/');
            }
          },
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            tooltip: 'รีเฟรช',
            onPressed: () => ref.invalidate(allTicketMatchesProvider),
          ),
        ],
      ),
      body: ticketsAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, _) => _ErrorView(
          message: 'โหลดตั๋วไม่สำเร็จ: $err',
          onRetry: () => ref.invalidate(allTicketsProvider),
        ),
        data: (tickets) {
          if (tickets.isEmpty) return const _EmptyView();
          return RefreshIndicator(
            onRefresh: () async {
              ref.invalidate(allTicketMatchesProvider);
              await ref.read(allTicketMatchesProvider.future);
            },
            child: _TicketList(tickets: tickets, matchesAsync: matchesAsync),
          );
        },
      ),
    );
  }
}

class _TicketList extends StatelessWidget {
  const _TicketList({required this.tickets, required this.matchesAsync});

  final List<Ticket> tickets;
  final AsyncValue<Map<String, MatchResult>> matchesAsync;

  @override
  Widget build(BuildContext context) {
    final isLoading = matchesAsync.isLoading;
    final hasError = matchesAsync.hasError;
    final matches = matchesAsync.valueOrNull ?? const <String, MatchResult>{};

    return ListView.builder(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.symmetric(vertical: 8),
      itemCount: tickets.length,
      itemBuilder: (context, index) {
        final ticket = tickets[index];
        final match = matches[ticket.id];
        return TicketMatchCard(
          ticket: ticket,
          match: match,
          isLoading: isLoading && match == null,
          hasError: hasError && match == null,
        );
      },
    );
  }
}

class _EmptyView extends StatelessWidget {
  const _EmptyView();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.confirmation_number_outlined,
              size: 64,
              color: theme.colorScheme.onSurfaceVariant,
            ),
            const SizedBox(height: 16),
            Text(
              'ยังไม่มีตั๋ว',
              style: theme.textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            Text(
              'เพิ่มตั๋วแรกของคุณเพื่อตรวจผล',
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ],
        ),
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
