import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lotto_checker/core/services/notification_service.dart';
import 'package:mocktail/mocktail.dart';
import 'package:timezone/data/latest.dart' as tzdata;
import 'package:timezone/timezone.dart' as tz;

// ── mocks + fakes ─────────────────────────────────────────────────────────────

class MockPlugin extends Mock implements FlutterLocalNotificationsPlugin {}

class _FakeNotificationDetails extends Fake implements NotificationDetails {}

// ── exact named-arg values used for every zonedSchedule call ─────────────────

const _kMode = AndroidScheduleMode.exactAllowWhileIdle;
const _kInterp = UILocalNotificationDateInterpretation.absoluteTime;
const _kComponents = DateTimeComponents.dayOfMonthAndTime;

// ── stub helper ───────────────────────────────────────────────────────────────

/// Stub [zonedSchedule] using exact enum values to avoid named-arg matcher leaks.
void _stubZonedSchedule(MockPlugin plugin) {
  when(
    () => plugin.zonedSchedule(
      any(),
      any(),
      any(),
      any(),
      any(),
      androidScheduleMode: _kMode,
      uiLocalNotificationDateInterpretation: _kInterp,
      matchDateTimeComponents: _kComponents,
    ),
  ).thenAnswer((_) async {});
}

void main() {
  late MockPlugin plugin;
  late NotificationService service;

  setUpAll(() {
    tzdata.initializeTimeZones();
    tz.setLocalLocation(tz.getLocation('Asia/Bangkok'));

    // Register fallbacks for custom positional-arg types only.
    registerFallbackValue(_FakeNotificationDetails());
    registerFallbackValue(tz.TZDateTime(tz.UTC, 2026));
  });

  setUp(() {
    plugin = MockPlugin();
    service = NotificationService(plugin);
  });

  group('NotificationService', () {
    group('scheduleDrawReminders', () {
      test('schedules notification for day 1 (id=1)', () async {
        _stubZonedSchedule(plugin);
        await service.scheduleDrawReminders();

        verify(
          () => plugin.zonedSchedule(
            1,
            any(),
            any(),
            any(),
            any(),
            androidScheduleMode: _kMode,
            uiLocalNotificationDateInterpretation: _kInterp,
            matchDateTimeComponents: _kComponents,
          ),
        ).called(1);
      });

      test('schedules notification for day 16 (id=16)', () async {
        _stubZonedSchedule(plugin);
        await service.scheduleDrawReminders();

        verify(
          () => plugin.zonedSchedule(
            16,
            any(),
            any(),
            any(),
            any(),
            androidScheduleMode: _kMode,
            uiLocalNotificationDateInterpretation: _kInterp,
            matchDateTimeComponents: _kComponents,
          ),
        ).called(1);
      });

      test('calls zonedSchedule exactly twice', () async {
        _stubZonedSchedule(plugin);
        await service.scheduleDrawReminders();

        verify(
          () => plugin.zonedSchedule(
            any(),
            any(),
            any(),
            any(),
            any(),
            androidScheduleMode: _kMode,
            uiLocalNotificationDateInterpretation: _kInterp,
            matchDateTimeComponents: _kComponents,
          ),
        ).called(2);
      });
    });

    group('cancelDrawReminders', () {
      setUp(() {
        when(() => plugin.cancel(any())).thenAnswer((_) async {});
      });

      test('cancels id 1', () async {
        await service.cancelDrawReminders();
        verify(() => plugin.cancel(1)).called(1);
      });

      test('cancels id 16', () async {
        await service.cancelDrawReminders();
        verify(() => plugin.cancel(16)).called(1);
      });
    });
  });
}
