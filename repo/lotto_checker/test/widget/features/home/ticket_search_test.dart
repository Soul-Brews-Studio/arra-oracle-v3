import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:lotto_checker/features/home/data/search_query_provider.dart';
import 'package:lotto_checker/features/home/presentation/home_screen.dart';
import 'package:lotto_checker/features/home/presentation/widgets/ticket_search_bar.dart';
import 'package:lotto_checker/features/results/application/providers.dart';
import 'package:lotto_checker/features/results/domain/match_result.dart';
import 'package:lotto_checker/features/tickets/data/providers.dart';
import 'package:lotto_checker/shared/models/ticket.dart';

import '../../../helpers/pump_app.dart';
import '../../../helpers/pump_router_app.dart';

final _t1 = Ticket(
  id: 't1',
  numbers: '111111',
  drawDate: DateTime(2026, 5, 1),
  createdAt: DateTime(2026, 4, 1),
);
final _t2 = Ticket(
  id: 't2',
  numbers: '222345',
  drawDate: DateTime(2026, 5, 1),
  createdAt: DateTime(2026, 4, 2),
);

GoRouter _router() => GoRouter(
      initialLocation: '/',
      routes: [
        GoRoute(
          path: '/',
          builder: (context, state) => const HomeScreen(),
        ),
      ],
    );

void main() {
  setUpAll(() => initializeDateFormatting('th'));

  group('TicketSearchBar widget', () {
    testWidgets('renders SearchBar with hint', (tester) async {
      await tester.pumpApp(
        const Scaffold(body: TicketSearchBar()),
      );
      await tester.pumpAndSettle();

      expect(find.byType(SearchBar), findsOneWidget);
      expect(find.text('ค้นหาเลขตั๋ว'), findsOneWidget);
      expect(find.byIcon(Icons.search), findsOneWidget);
    });

    testWidgets('debounced typing updates searchQueryProvider', (tester) async {
      late ProviderContainer container;
      await tester.pumpWidget(
        ProviderScope(
          child: Consumer(
            builder: (context, ref, _) {
              container = ProviderScope.containerOf(context);
              return const MaterialApp(
                home: Scaffold(body: TicketSearchBar()),
              );
            },
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.enterText(find.byType(TextField), '123');
      // Before debounce fires, the provider should still hold the empty value.
      expect(container.read(searchQueryProvider), '');
      // Wait past the 300 ms debounce.
      await tester.pump(const Duration(milliseconds: 350));
      expect(container.read(searchQueryProvider), '123');
    });
  });

  group('HomeTicketList — search filtering', () {
    testWidgets('shows all tickets when query is empty', (tester) async {
      await tester.pumpRouterApp(
        router: _router(),
        overrides: [
          allTicketsProvider.overrideWith((_) => Stream.value([_t1, _t2])),
          allTicketMatchesProvider.overrideWith(
            (_) => Stream.value(const <String, MatchResult>{
              't1': MatchResult.noMatch(),
              't2': MatchResult.noMatch(),
            }),
          ),
        ],
      );
      await tester.pumpAndSettle();

      expect(find.textContaining('1 1 1 1 1 1'), findsOneWidget);
      expect(find.textContaining('2 2 2 3 4 5'), findsOneWidget);
    });

    testWidgets('filters tickets by digit substring', (tester) async {
      await tester.pumpRouterApp(
        router: _router(),
        overrides: [
          searchQueryProvider.overrideWith((_) => '111'),
          allTicketsProvider.overrideWith((_) => Stream.value([_t1, _t2])),
          allTicketMatchesProvider.overrideWith(
            (_) => Stream.value(const <String, MatchResult>{
              't1': MatchResult.noMatch(),
              't2': MatchResult.noMatch(),
            }),
          ),
        ],
      );
      await tester.pumpAndSettle();

      expect(find.textContaining('1 1 1 1 1 1'), findsOneWidget);
      expect(find.textContaining('2 2 2 3 4 5'), findsNothing);
    });

    testWidgets('shows empty-search message when query has no hits',
        (tester) async {
      await tester.pumpRouterApp(
        router: _router(),
        overrides: [
          searchQueryProvider.overrideWith((_) => '999'),
          allTicketsProvider.overrideWith((_) => Stream.value([_t1, _t2])),
          allTicketMatchesProvider.overrideWith(
            (_) => Stream.value(const <String, MatchResult>{
              't1': MatchResult.noMatch(),
              't2': MatchResult.noMatch(),
            }),
          ),
        ],
      );
      await tester.pumpAndSettle();

      expect(find.text('ไม่เจอตั๋วที่ค้นหา'), findsOneWidget);
    });
  });
}
