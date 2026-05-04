import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../data/providers.dart';

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final enabled = ref.watch(drawRemindersEnabledProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('ตั้งค่า'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          tooltip: 'กลับ',
          onPressed: () =>
              context.canPop() ? context.pop() : context.go('/'),
        ),
      ),
      body: ListView(
        children: [
          _SectionHeader(label: 'การแจ้งเตือน'),
          _DrawReminderTile(enabled: enabled, ref: ref),
          const Divider(height: 1),
        ],
      ),
    );
  }
}

// ── draw reminder tile ────────────────────────────────────────────────────────

class _DrawReminderTile extends ConsumerWidget {
  const _DrawReminderTile({required this.enabled, required this.ref});

  final bool enabled;
  // ignore: unused_field — needed to pass ref into onChanged closure
  final WidgetRef ref;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final service = ref.read(notificationServiceProvider);

    return SwitchListTile(
      secondary: Icon(
        Icons.notifications_outlined,
        color: theme.colorScheme.primary,
      ),
      title: const Text('แจ้งเตือนวันผลรางวัล'),
      subtitle: const Text('ทุกวันที่ 1 และ 16 เวลา 09:00 น.'),
      value: enabled,
      onChanged: (on) async {
        if (on) {
          final granted = await service.requestPermission();
          if (!granted) return; // Permission denied — keep switch off.
          await service.scheduleDrawReminders();
        } else {
          await service.cancelDrawReminders();
        }
        ref.read(drawRemindersEnabledProvider.notifier).state = on;
      },
    );
  }
}

// ── section header ────────────────────────────────────────────────────────────

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 20, 16, 8),
      child: Text(
        label,
        style: theme.textTheme.labelMedium?.copyWith(
          color: theme.colorScheme.primary,
          fontWeight: FontWeight.w600,
          letterSpacing: 0.5,
        ),
      ),
    );
  }
}
