import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../controllers/ticket_input_controller.dart';
import 'numeric_keypad.dart';

class TicketForm extends ConsumerWidget {
  const TicketForm({super.key, required this.onSaved});

  final VoidCallback onSaved;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(ticketInputControllerProvider);
    final controller = ref.read(ticketInputControllerProvider.notifier);
    final defaultDraw = nextThaiDrawDate(DateTime.now());
    final draw = state.drawDate ?? defaultDraw;

    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _NumberDisplay(numbers: state.numbers),
          const SizedBox(height: 12),
          _DrawDatePicker(
            date: draw,
            isDefault: state.drawDate == null,
            onPick: () async {
              final picked = await showDatePicker(
                context: context,
                initialDate: draw,
                firstDate: DateTime.now().subtract(const Duration(days: 365)),
                lastDate: DateTime.now().add(const Duration(days: 365)),
              );
              if (picked != null) controller.setDrawDate(picked);
            },
            onClear: state.drawDate == null
                ? null
                : () => controller.setDrawDate(null),
          ),
          const SizedBox(height: 12),
          TextField(
            decoration: const InputDecoration(
              labelText: 'Note (optional)',
              border: OutlineInputBorder(),
            ),
            maxLength: 80,
            onChanged: controller.setNote,
          ),
          const SizedBox(height: 8),
          NumericKeypad(
            onDigit: controller.appendDigit,
            onBackspace: controller.backspace,
          ),
          if (state.error != null) ...[
            const SizedBox(height: 8),
            Text(
              state.error!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ],
          const SizedBox(height: 12),
          FilledButton.icon(
            onPressed: state.isValid && !state.saving
                ? () async {
                    final ok = await controller.save();
                    if (ok) onSaved();
                  }
                : null,
            icon: state.saving
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.save),
            label: const Text('Save ticket'),
          ),
        ],
      ),
    );
  }
}

class _NumberDisplay extends StatelessWidget {
  const _NumberDisplay({required this.numbers});

  final String numbers;

  @override
  Widget build(BuildContext context) {
    final padded = numbers.padRight(6, '_');
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 12),
      decoration: BoxDecoration(
        border: Border.all(color: Theme.of(context).colorScheme.outline),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Center(
        child: Text(
          padded.split('').join(' '),
          style: const TextStyle(
            fontSize: 36,
            fontFeatures: [FontFeature.tabularFigures()],
            letterSpacing: 4,
          ),
        ),
      ),
    );
  }
}

class _DrawDatePicker extends StatelessWidget {
  const _DrawDatePicker({
    required this.date,
    required this.isDefault,
    required this.onPick,
    required this.onClear,
  });

  final DateTime date;
  final bool isDefault;
  final VoidCallback onPick;
  final VoidCallback? onClear;

  @override
  Widget build(BuildContext context) {
    final label = '${date.year}-${_pad(date.month)}-${_pad(date.day)}';
    return Row(
      children: [
        Expanded(
          child: OutlinedButton.icon(
            onPressed: onPick,
            icon: const Icon(Icons.calendar_today),
            label: Text(
              isDefault ? 'Draw date: $label (default)' : 'Draw date: $label',
            ),
          ),
        ),
        if (onClear != null)
          IconButton(
            onPressed: onClear,
            icon: const Icon(Icons.close),
            tooltip: 'Use default draw date',
          ),
      ],
    );
  }

  String _pad(int n) => n.toString().padLeft(2, '0');
}
