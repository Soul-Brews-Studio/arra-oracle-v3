import '../../../shared/models/draw.dart';
import 'draw_repository.dart';
import 'sources/lottery_data_source.dart';

class DrawSyncService {
  DrawSyncService({
    required LotteryDataSource source,
    required DrawRepository repository,
  }) : _source = source,
       _repository = repository;

  final LotteryDataSource _source;
  final DrawRepository _repository;

  Future<Draw> refreshLatest() async {
    final draw = await _source.fetchLatest();
    await _repository.save(draw);
    return draw;
  }

  Future<Draw?> getOrFetch(DateTime drawDate) async {
    final cached = await _repository.getByDate(drawDate);
    if (cached != null) return cached;
    final fetched = await _source.fetchByDate(drawDate);
    if (fetched != null) {
      await _repository.save(fetched);
    }
    return fetched;
  }
}
