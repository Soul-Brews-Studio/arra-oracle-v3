import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../features/home/presentation/home_screen.dart';
import '../features/results/presentation/draw_history_screen.dart';
import '../features/results/presentation/results_screen.dart';
import '../features/tickets/presentation/ticket_input_screen.dart';

final routerProvider = Provider<GoRouter>((ref) {
  return GoRouter(
    initialLocation: '/',
    routes: <RouteBase>[
      GoRoute(
        path: '/',
        name: 'home',
        builder: (context, state) => const HomeScreen(),
      ),
      GoRoute(
        path: '/tickets/new',
        name: 'ticket-new',
        builder: (context, state) => const TicketInputScreen(),
      ),
      GoRoute(
        path: '/tickets/:id/edit',
        name: 'ticket-edit',
        builder: (context, state) => TicketInputScreen(
          ticketId: state.pathParameters['id'],
        ),
      ),
      GoRoute(
        path: '/results',
        name: 'results',
        builder: (context, state) => const ResultsScreen(),
      ),
      GoRoute(
        path: '/draws',
        name: 'draws',
        builder: (context, state) => const DrawHistoryScreen(),
      ),
    ],
  );
});
