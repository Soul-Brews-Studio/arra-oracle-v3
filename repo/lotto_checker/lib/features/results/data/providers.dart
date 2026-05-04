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
