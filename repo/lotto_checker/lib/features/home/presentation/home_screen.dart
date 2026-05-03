import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../shared/models/ticket.dart';
import '../../tickets/data/providers.dart';
import 'widgets/ticket_list_tile.dart';

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ticketsAsync = ref.watch(allTicketsProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('ตรวจหวย'),
        actions: [
          IconButton(
            icon: const Icon(Icons.assignment_turned_in_outlined),
            tooltip: 'ดูผล',
            onPressed: () => context.go('/results'),
          ),
        ],
      ),
      body: ticketsAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('เกิดข้อผิดพลาด: $e')),
        data: (tickets) => tickets.isEmpty
            ? _EmptyState(onAdd: () => context.go('/tickets/new'))
            : _TicketList(tickets: tickets),
      ),
      floatingActionButton: FloatingActionButton.extended(
        heroTag: 'home-add-ticket',
        onPressed: () => context.go('/tickets/new'),
        icon: const Icon(Icons.add),
        label: const Text('เพิ่มตั๋ว'),
      ),
    );
  }
}

// ── ticket list ───────────────────────────────────────────────────────────────

class _TicketList extends StatelessWidget {
  const _TicketList({required this.tickets});

  final List<Ticket> tickets;

  @override
  Widget build(BuildContext context) {
    // Build flat items: date header + ticket tiles, grouped by drawDate.
    final items = _buildItems(tickets);

    return ListView.builder(
      itemCount: items.length,
      itemBuilder: (context, i) {
        final item = items[i];
        if (item is _DateHeader) {
          return TicketDateHeader(drawDate: item.date);
        }
        final ticket = (item as _TicketItem).ticket;
        return _DismissibleTile(ticket: ticket);
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

// ── dismissible tile with delete + edit ──────────────────────────────────────

class _DismissibleTile extends ConsumerWidget {
  const _DismissibleTile({required this.ticket});

  final Ticket ticket;

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

// ── empty state ───────────────────────────────────────────────────────────────

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.onAdd});

  final VoidCallback onAdd;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.confirmation_number_outlined,
            size: 64,
            color: theme.colorScheme.outline,
          ),
          const SizedBox(height: 16),
          Text(
            'ยังไม่มีตั๋ว',
            style: theme.textTheme.titleMedium
                ?.copyWith(color: theme.colorScheme.outline),
          ),
          const SizedBox(height: 8),
          Text(
            'กด + เพื่อเพิ่มตั๋วสลาก',
            style: theme.textTheme.bodySmall
                ?.copyWith(color: theme.colorScheme.outline),
          ),
          const SizedBox(height: 24),
          FilledButton.icon(
            onPressed: onAdd,
            icon: const Icon(Icons.add),
            label: const Text('เพิ่มตั๋ว'),
          ),
        ],
      ),
    );
  }
}

// ── sealed item types ─────────────────────────────────────────────────────────

sealed class _ListItem {}

final class _DateHeader extends _ListItem {
  _DateHeader(this.date);
  final DateTime date;
}

final class _TicketItem extends _ListItem {
  _TicketItem(this.ticket);
  final Ticket ticket;
}
