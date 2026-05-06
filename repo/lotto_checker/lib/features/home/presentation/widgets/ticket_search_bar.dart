import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/search_query_provider.dart';

/// Material 3 [SearchBar] with 300 ms debounced commit to
/// [searchQueryProvider]. Shows a clear button while a query is active.
class TicketSearchBar extends ConsumerStatefulWidget {
  const TicketSearchBar({super.key});

  @override
  ConsumerState<TicketSearchBar> createState() => _TicketSearchBarState();
}

class _TicketSearchBarState extends ConsumerState<TicketSearchBar> {
  final _controller = TextEditingController();
  Timer? _debounce;

  @override
  void dispose() {
    _debounce?.cancel();
    _controller.dispose();
    super.dispose();
  }

  void _onChanged(String value) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 300), () {
      if (!mounted) return;
      ref.read(searchQueryProvider.notifier).state = value.trim();
    });
  }

  void _clear() {
    _debounce?.cancel();
    _controller.clear();
    ref.read(searchQueryProvider.notifier).state = '';
  }

  @override
  Widget build(BuildContext context) {
    final query = ref.watch(searchQueryProvider);
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 6, 12, 6),
      child: SearchBar(
        controller: _controller,
        leading: const Icon(Icons.search),
        hintText: 'ค้นหาเลขตั๋ว',
        keyboardType: TextInputType.number,
        onChanged: _onChanged,
        trailing: query.isEmpty
            ? null
            : [
                IconButton(
                  icon: const Icon(Icons.close),
                  tooltip: 'ล้างคำค้นหา',
                  onPressed: _clear,
                ),
              ],
      ),
    );
  }
}
