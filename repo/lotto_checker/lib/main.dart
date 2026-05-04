import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/date_symbol_data_local.dart';

import 'app/app.dart';
import 'features/settings/data/providers.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await initializeDateFormatting('th');

  // Boot a container early so we can initialise notifications before runApp.
  final container = ProviderContainer();
  final notifications = container.read(notificationServiceProvider);
  await notifications.initialize();
  await notifications.scheduleDrawReminders();

  runApp(
    UncontrolledProviderScope(
      container: container,
      child: const MyApp(),
    ),
  );
}
