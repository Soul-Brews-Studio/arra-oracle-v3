import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../shared/models/draw.dart';
import '../../tickets/data/providers.dart';
import 'draw_repository.dart';
import 'sources/glo_data_source.dart';
import 'sources/lottery_data_source.dart';
import 'sources/sanook_data_source.dart';
import 'sync_service.dart';

final lotteryDataSourceProvider = Provider<LotteryDataSource>((ref) {
  final source = SanookDataSource();
  ref.onDispose(source.close);
  return source;
});

final gloDataSourceProvider = Provider<GloDataSource>((ref) {
  final source = GloDataSource();
  ref.onDispose(source.close);
  return source;
});

final drawRepositoryProvider = Provider<DrawRepository>((ref) {
  final db = ref.watch(appDatabaseProvider);
  return DriftDrawRepository(db);
});

final drawSyncServiceProvider = Provider<DrawSyncService>((ref) {
  return DrawSyncService(
    source: ref.watch(lotteryDataSourceProvider),
    repository: ref.watch(drawRepositoryProvider),
  );
});

final latestDrawProvider = FutureProvider<Draw>((ref) {
  return ref.watch(drawSyncServiceProvider).refreshLatest();
});

/// All cached draws, newest first. Backed by Drift so updates live.
final allDrawsProvider = StreamProvider<List<Draw>>((ref) {
  return ref.watch(drawRepositoryProvider).watchAll();
});

/// Client-side filter applied to [allDrawsProvider]. `source` filtering is not
/// modelled yet (Draw has no source field) — date range only for Phase 11 F2.
class DrawFilter {
  const DrawFilter({this.startDate, this.endDate});

  final DateTime? startDate;
  final DateTime? endDate;

  bool get isActive => startDate != null || endDate != null;

  DrawFilter copyWith({
    DateTime? startDate,
    DateTime? endDate,
    bool clearDateRange = false,
  }) {
    if (clearDateRange) return const DrawFilter();
    return DrawFilter(
      startDate: startDate ?? this.startDate,
      endDate: endDate ?? this.endDate,
    );
  }

  @override
  bool operator ==(Object other) =>
      other is DrawFilter &&
      other.startDate == startDate &&
      other.endDate == endDate;

  @override
  int get hashCode => Object.hash(startDate, endDate);
}

final drawFilterProvider = StateProvider<DrawFilter>(
  (ref) => const DrawFilter(),
);

/// [allDrawsProvider] filtered by [drawFilterProvider]. Date comparison is
/// day-precise — time-of-day on the picked range is ignored.
final filteredDrawsProvider = Provider<AsyncValue<List<Draw>>>((ref) {
  final drawsAsync = ref.watch(allDrawsProvider);
  final filter = ref.watch(drawFilterProvider);
  return drawsAsync.whenData((draws) {
    if (!filter.isActive) return draws;
    return draws.where((d) => _matchesDateRange(d.drawDate, filter)).toList();
  });
});

bool _matchesDateRange(DateTime drawDate, DrawFilter filter) {
  final d = DateTime(drawDate.year, drawDate.month, drawDate.day);
  final start = filter.startDate;
  if (start != null) {
    final s = DateTime(start.year, start.month, start.day);
    if (d.isBefore(s)) return false;
  }
  final end = filter.endDate;
  if (end != null) {
    final e = DateTime(end.year, end.month, end.day);
    if (d.isAfter(e)) return false;
  }
  return true;
}
