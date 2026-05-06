import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../data/providers.dart';
import '../data/theme_mode_provider.dart';
import 'ticket_io_section.dart';

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
          const _SectionHeader(label: 'การแจ้งเตือน'),
          _DrawReminderTile(enabled: enabled, ref: ref),
          const Divider(height: 1),
          const _SectionHeader(label: 'ธีม'),
          const _ThemePreviewCard(),
          const _ThemeModeTiles(),
          const Divider(height: 1),
          const _SectionHeader(label: 'ข้อมูลตั๋ว'),
          const TicketIoSection(),
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

// ── theme mode tiles ──────────────────────────────────────────────────────────

class _ThemeModeTiles extends ConsumerWidget {
  const _ThemeModeTiles();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final mode = ref.watch(themeModeProvider);
    final controller = ref.read(themeModeProvider.notifier);

    return Column(
      children: [
        _ThemeRadio(
          mode: ThemeMode.system,
          groupValue: mode,
          onChanged: controller.set,
          icon: Icons.brightness_auto,
          label: 'ระบบ',
        ),
        _ThemeRadio(
          mode: ThemeMode.light,
          groupValue: mode,
          onChanged: controller.set,
          icon: Icons.light_mode,
          label: 'สว่าง',
        ),
        _ThemeRadio(
          mode: ThemeMode.dark,
          groupValue: mode,
          onChanged: controller.set,
          icon: Icons.dark_mode,
          label: 'มืด',
        ),
      ],
    );
  }
}

class _ThemeRadio extends StatelessWidget {
  const _ThemeRadio({
    required this.mode,
    required this.groupValue,
    required this.onChanged,
    required this.icon,
    required this.label,
  });

  final ThemeMode mode;
  final ThemeMode groupValue;
  final ValueChanged<ThemeMode> onChanged;
  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return RadioListTile<ThemeMode>(
      value: mode,
      groupValue: groupValue,
      onChanged: (v) {
        if (v != null) onChanged(v);
      },
      title: Row(
        children: [
          Icon(icon, color: theme.colorScheme.primary, size: 20),
          const SizedBox(width: 12),
          Text(label),
        ],
      ),
    );
  }
}

class _ThemePreviewCard extends StatelessWidget {
  const _ThemePreviewCard();

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
      child: SizedBox(
        height: 60,
        child: ClipRRect(
          borderRadius: BorderRadius.circular(12),
          child: Row(
            children: [
              Expanded(
                child: ColoredBox(
                  color: scheme.primary,
                  child: Center(
                    child: Text(
                      'Primary',
                      style: TextStyle(
                        color: scheme.onPrimary,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ),
              ),
              Expanded(
                child: ColoredBox(
                  color: scheme.primaryContainer,
                  child: Center(
                    child: Text(
                      'Container',
                      style: TextStyle(
                        color: scheme.onPrimaryContainer,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
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
