import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:lotto_checker/core/services/notification_service.dart';
import 'package:lotto_checker/features/settings/data/providers.dart';
import 'package:lotto_checker/features/settings/presentation/settings_screen.dart';
import 'package:mocktail/mocktail.dart';

import '../../../helpers/pump_router_app.dart';

// ── mock ──────────────────────────────────────────────────────────────────────

class MockNotificationService extends Mock implements NotificationService {}

// ── router ────────────────────────────────────────────────────────────────────

GoRouter _router() => GoRouter(
      initialLocation: '/settings',
      routes: [
        GoRoute(
          path: '/settings',
          builder: (_, __) => const SettingsScreen(),
        ),
        GoRoute(
          path: '/',
          builder: (_, __) => const Scaffold(body: Text('HOME')),
        ),
      ],
    );

void main() {
  late MockNotificationService mockService;

  setUp(() {
    mockService = MockNotificationService();
    when(() => mockService.requestPermission()).thenAnswer((_) async => true);
    when(() => mockService.scheduleDrawReminders()).thenAnswer((_) async {});
    when(() => mockService.cancelDrawReminders()).thenAnswer((_) async {});
  });

  group('SettingsScreen', () {
    testWidgets('shows AppBar title "ตั้งค่า"', (tester) async {
      await tester.pumpRouterApp(
        router: _router(),
        overrides: [
          notificationServiceProvider.overrideWithValue(mockService),
        ],
      );
      await tester.pumpAndSettle();

      expect(find.text('ตั้งค่า'), findsOneWidget);
    });

    testWidgets('shows draw reminder switch tile', (tester) async {
      await tester.pumpRouterApp(
        router: _router(),
        overrides: [
          notificationServiceProvider.overrideWithValue(mockService),
        ],
      );
      await tester.pumpAndSettle();

      expect(find.text('แจ้งเตือนวันผลรางวัล'), findsOneWidget);
      expect(find.byType(SwitchListTile), findsOneWidget);
    });

    testWidgets('switch starts as ON (default enabled)', (tester) async {
      await tester.pumpRouterApp(
        router: _router(),
        overrides: [
          notificationServiceProvider.overrideWithValue(mockService),
          drawRemindersEnabledProvider.overrideWith((_) => true),
        ],
      );
      await tester.pumpAndSettle();

      final tile =
          tester.widget<SwitchListTile>(find.byType(SwitchListTile));
      expect(tile.value, isTrue);
    });

    testWidgets('turning OFF calls cancelDrawReminders', (tester) async {
      await tester.pumpRouterApp(
        router: _router(),
        overrides: [
          notificationServiceProvider.overrideWithValue(mockService),
          drawRemindersEnabledProvider.overrideWith((_) => true),
        ],
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byType(SwitchListTile));
      await tester.pumpAndSettle();

      verify(() => mockService.cancelDrawReminders()).called(1);
      verifyNever(() => mockService.scheduleDrawReminders());
    });

    testWidgets('turning ON requests permission then schedules', (tester) async {
      await tester.pumpRouterApp(
        router: _router(),
        overrides: [
          notificationServiceProvider.overrideWithValue(mockService),
          drawRemindersEnabledProvider.overrideWith((_) => false),
        ],
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byType(SwitchListTile));
      await tester.pumpAndSettle();

      verify(() => mockService.requestPermission()).called(1);
      verify(() => mockService.scheduleDrawReminders()).called(1);
    });

    testWidgets('shows subtitle with day 1, 16 and time', (tester) async {
      await tester.pumpRouterApp(
        router: _router(),
        overrides: [
          notificationServiceProvider.overrideWithValue(mockService),
        ],
      );
      await tester.pumpAndSettle();

      expect(
        find.textContaining('09:00'),
        findsOneWidget,
      );
    });
  });
}
