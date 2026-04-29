import '../../../../shared/models/draw.dart';
import 'lottery_data_source.dart';

class FixtureDataSource implements LotteryDataSource {
  FixtureDataSource({Map<DateTime, Draw>? draws})
      : _draws = {
          for (final entry in (draws ?? const <DateTime, Draw>{}).entries)
            _normalize(entry.key): entry.value,
        };

  final Map<DateTime, Draw> _draws;

  void put(Draw draw) {
    _draws[_normalize(draw.drawDate)] = draw;
  }

  void clear() => _draws.clear();

  int get count => _draws.length;

  @override
  Future<Draw> fetchLatest() async {
    if (_draws.isEmpty) {
      throw FetchException('no fixture draws available');
    }
    final keys = _draws.keys.toList()..sort((a, b) => b.compareTo(a));
    return _draws[keys.first]!;
  }

  @override
  Future<Draw?> fetchByDate(DateTime drawDate) async {
    return _draws[_normalize(drawDate)];
  }

  static DateTime _normalize(DateTime d) => DateTime(d.year, d.month, d.day);
}
