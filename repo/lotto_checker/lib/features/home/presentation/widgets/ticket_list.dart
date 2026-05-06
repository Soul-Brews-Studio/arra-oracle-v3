import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../shared/models/ticket.dart';
import '../../../results/application/providers.dart';
import '../../../results/domain/match_result.dart';
import '../../../tickets/data/providers.dart';
import 'ticket_list_tile.dart';

/// Date-grouped, swipe-to-delete ticket list with match badges.
class HomeTicketList extends ConsumerWidget {
  const HomeTicketList({super.key, required this.tickets});

  final List<Ticket> tickets;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final matches = ref.watch(allTicketMatchesProvider).maybeWhen(
          data: (m) => m,
          orElse: () => const <String, MatchResult>{},
        );

    if (tickets.isEmpty) {
      return const _EmptyResults();
    }

    final items = _buildItems(tickets);
    return ListView.builder(
      itemCount: items.length,
      itemBuilder: (context, i) {
        final item = items[i];
        if (item is _DateHeader) {
          return TicketDateHeader(drawDate: item.date);
        }
        final ticket = (item as _TicketItem).ticket;
        return _DismissibleTile(ticket: ticket, match: matches[ticket.id]);
      },
    );
  }

  List<_ListItem> _buildItems(List<Ticket> tickets) {
    final items = <_ListItem>[];
    DateTime? lastDate;
    for (final t in tickets) {
      final date = DateTime(t.drawDate.year, t.drawDate.month, t.drawDate.day);
      if (lastDate == null || !_sameDay(lastDate, date)) {
        items.add(_DateHeader(date));
        lastDate = date;
      }
      items.add(_TicketItem(t));
    }
    return items;
  }

  static bool _sameDay(DateTime a, DateTime b) =>
      a.year == b.year && a.month == b.month && a.day == b.day;
}

class _DismissibleTile extends ConsumerWidget {
  const _DismissibleTile({required this.ticket, this.match});

  final Ticket ticket;
  final MatchResult? match;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Dismissible(
      key: ValueKey(ticket.id),
      direction: DismissDirection.endToStart,
      background: Container(
        alignment: Alignment.centerRight,
        padding: const EdgeInsets.only(right: 20),
        color: Theme.of(context).colorScheme.errorContainer,
        child: Icon(
          Icons.delete_outline,
          color: Theme.of(context).colorScheme.onErrorContainer,
        ),
      ),
      confirmDismiss: (_) => _confirmDelete(context),
      onDismissed: (_) {
        ref.read(ticketRepositoryProvider).delete(ticket.id);
        ScaffoldMessenger.of(context)
          ..hideCurrentSnackBar()
          ..showSnackBar(
            SnackBar(
              content: const Text('ลบตั๋วแล้ว'),
              action: SnackBarAction(
                label: 'ปิด',
                onPressed: () =>
                    ScaffoldMessenger.of(context).hideCurrentSnackBar(),
              ),
            ),
          );
      },
      child: TicketListTile(
        ticket: ticket,
        match: match,
        onEdit: () => context.go('/tickets/${ticket.id}/edit'),
      ),
    );
  }

  Future<bool?> _confirmDelete(BuildContext context) {
    return showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('ลบตั๋ว?'),
        content: Text('ตั๋ว ${ticket.numbers} จะถูกลบออก'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('ยกเลิก'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('ลบ'),
          ),
        ],
      ),
    );
  }
}

class _EmptyResults extends StatelessWidget {
  const _EmptyResults();

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
              Icons.search_off,
              size: 56,
              color: theme.colorScheme.outline,
            ),
            const SizedBox(height: 12),
            Text(
              'ไม่เจอตั๋วที่ค้นหา',
              style: theme.textTheme.titleMedium
                  ?.copyWith(color: theme.colorScheme.outline),
            ),
          ],
        ),
      ),
    );
  }
}

sealed class _ListItem {}

final class _DateHeader extends _ListItem {
  _DateHeader(this.date);
  final DateTime date;
}

final class _TicketItem extends _ListItem {
  _TicketItem(this.ticket);
  final Ticket ticket;
}
