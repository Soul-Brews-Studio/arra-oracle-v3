import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/services/notification_service.dart';

final _pluginProvider = Provider<FlutterLocalNotificationsPlugin>(
  (_) => FlutterLocalNotificationsPlugin(),
);

/// Singleton [NotificationService] wired to the shared plugin instance.
final notificationServiceProvider = Provider<NotificationService>((ref) {
  return NotificationService(ref.watch(_pluginProvider));
});

/// Whether draw-day reminders are currently enabled.
///
/// Toggling to `false` cancels the scheduled alarms;
/// toggling back to `true` requests permission and reschedules them.
final drawRemindersEnabledProvider = StateProvider<bool>((_) => true);
