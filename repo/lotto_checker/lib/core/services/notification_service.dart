import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:timezone/data/latest.dart' as tz;
import 'package:timezone/timezone.dart' as tz;

/// Notification IDs for the two monthly draw-day reminders.
const _kDay1Id = 1;
const _kDay16Id = 16;

const _kChannelId = 'lotto_draw_reminders';
const _kChannelName = 'ผลรางวัลสลาก';
const _kChannelDesc = 'แจ้งเตือนวันที่ผลรางวัลออก (1 และ 16 ของทุกเดือน)';

/// Wraps [FlutterLocalNotificationsPlugin] with lottery-specific helpers.
///
/// Call [initialize] once at app start, then [scheduleDrawReminders] to arm
/// the two monthly alarms (1st and 16th at 09:00 Asia/Bangkok).
class NotificationService {
  NotificationService(this._plugin);

  final FlutterLocalNotificationsPlugin _plugin;

  // ── lifecycle ──────────────────────────────────────────────────────────────

  /// Initialise timezone data and the notifications plugin.
  Future<void> initialize() async {
    tz.initializeTimeZones();
    tz.setLocalLocation(tz.getLocation('Asia/Bangkok'));

    const android = AndroidInitializationSettings('@mipmap/ic_launcher');
    const ios = DarwinInitializationSettings(
      requestAlertPermission: false,
      requestBadgePermission: false,
      requestSoundPermission: false,
    );
    await _plugin.initialize(
      const InitializationSettings(android: android, iOS: ios),
    );
  }

  // ── permissions ────────────────────────────────────────────────────────────

  /// Request OS-level notification permission. Returns true if granted.
  Future<bool> requestPermission() async {
    final android = _plugin.resolvePlatformSpecificImplementation<
        AndroidFlutterLocalNotificationsPlugin>();
    if (android != null) {
      return await android.requestNotificationsPermission() ?? false;
    }

    final ios = _plugin.resolvePlatformSpecificImplementation<
        IOSFlutterLocalNotificationsPlugin>();
    if (ios != null) {
      return await ios.requestPermissions(
            alert: true,
            badge: true,
            sound: true,
          ) ??
          false;
    }
    return false;
  }

  // ── scheduling ─────────────────────────────────────────────────────────────

  /// Schedule monthly reminders on the 1st and 16th at 09:00.
  Future<void> scheduleDrawReminders() async {
    await _scheduleMonthly(id: _kDay1Id, day: 1, hour: 9, minute: 0);
    await _scheduleMonthly(id: _kDay16Id, day: 16, hour: 9, minute: 0);
  }

  /// Cancel both draw reminders.
  Future<void> cancelDrawReminders() async {
    await _plugin.cancel(_kDay1Id);
    await _plugin.cancel(_kDay16Id);
  }

  // ── private ────────────────────────────────────────────────────────────────

  Future<void> _scheduleMonthly({
    required int id,
    required int day,
    required int hour,
    required int minute,
  }) async {
    const androidDetails = AndroidNotificationDetails(
      _kChannelId,
      _kChannelName,
      channelDescription: _kChannelDesc,
      importance: Importance.high,
      priority: Priority.high,
    );
    const details = NotificationDetails(
      android: androidDetails,
      iOS: DarwinNotificationDetails(),
    );

    await _plugin.zonedSchedule(
      id,
      '🎫 ผลรางวัลสลากออกแล้ว!',
      'กดตรวจหวยได้เลย',
      _nextInstanceOf(day, hour, minute),
      details,
      androidScheduleMode: AndroidScheduleMode.exactAllowWhileIdle,
      uiLocalNotificationDateInterpretation:
          UILocalNotificationDateInterpretation.absoluteTime,
      matchDateTimeComponents: DateTimeComponents.dayOfMonthAndTime,
    );
  }

  /// Returns the next future [tz.TZDateTime] that falls on [day] of a month
  /// at [hour]:[minute] Bangkok time.
  tz.TZDateTime _nextInstanceOf(int day, int hour, int minute) {
    final now = tz.TZDateTime.now(tz.local);
    var scheduled =
        tz.TZDateTime(tz.local, now.year, now.month, day, hour, minute);
    if (!scheduled.isAfter(now)) {
      // Already passed this month — advance to next month.
      final next = DateTime(now.year, now.month + 1); // Dart normalises dec→jan
      scheduled =
          tz.TZDateTime(tz.local, next.year, next.month, day, hour, minute);
    }
    return scheduled;
  }
}
