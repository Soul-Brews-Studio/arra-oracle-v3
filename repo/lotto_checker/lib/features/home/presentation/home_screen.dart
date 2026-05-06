import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'widgets/home_empty_state.dart';
import 'widgets/next_draw_banner.dart';
import 'widgets/stats_hero.dart';
import 'widgets/ticket_list.dart';
import 'widgets/ticket_search_bar.dart';
import '../../tickets/data/providers.dart';

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
            icon: const Icon(Icons.history),
            tooltip: 'ประวัติผล',
            onPressed: () => context.go('/draws'),
          ),
          IconButton(
            icon: const Icon(Icons.assignment_turned_in_outlined),
            tooltip: 'ดูผล',
            onPressed: () => context.go('/results'),
          ),
          IconButton(
            icon: const Icon(Icons.settings_outlined),
            tooltip: 'ตั้งค่า',
            onPressed: () => context.go('/settings'),
          ),
        ],
      ),
      body: ticketsAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('เกิดข้อผิดพลาด: $e')),
        data: (tickets) => tickets.isEmpty
            ? HomeEmptyState(onAdd: () => context.go('/tickets/new'))
            : Column(
                children: [
                  const NextDrawBanner(),
                  const StatsHero(),
                  const TicketSearchBar(),
                  Expanded(child: HomeTicketList(tickets: tickets)),
                ],
              ),
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
