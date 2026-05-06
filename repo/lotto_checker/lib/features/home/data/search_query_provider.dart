import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Current home-screen ticket search query (digits-only substring).
///
/// Updated by [TicketSearchBar] after a 300 ms debounce so the list does
/// not rebuild on every keystroke.
final searchQueryProvider = StateProvider<String>((ref) => '');
