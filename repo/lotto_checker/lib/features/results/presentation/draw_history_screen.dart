import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../data/providers.dart';
import 'widgets/draw_card.dart';
import 'widgets/draw_history_states.dart';

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
        error: (e, _) => ErrorView(
          message: 'โหลดข้อมูลไม่สำเร็จ: $e',
          onRetry: () => ref.invalidate(allDrawsProvider),
        ),
        data: (draws) {
          if (draws.isEmpty) return const EmptyView();
          return RefreshIndicator(
            onRefresh: () async {
              ref.invalidate(allDrawsProvider);
              await ref.read(allDrawsProvider.future);
            },
            child: ListView.builder(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.symmetric(vertical: 8),
              itemCount: draws.length,
              itemBuilder: (context, i) => DrawCard(draw: draws[i]),
            ),
          );
        },
      ),
    );
  }
}
