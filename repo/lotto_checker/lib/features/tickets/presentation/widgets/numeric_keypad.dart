import 'package:flutter/material.dart';

class NumericKeypad extends StatelessWidget {
  const NumericKeypad({
    super.key,
    required this.onDigit,
    required this.onBackspace,
  });

  final ValueChanged<String> onDigit;
  final VoidCallback onBackspace;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        return Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            _row(['1', '2', '3']),
            _row(['4', '5', '6']),
            _row(['7', '8', '9']),
            Row(
              children: [
                const Expanded(child: SizedBox.shrink()),
                Expanded(child: _digit('0')),
                Expanded(
                  child: _KeyButton(
                    label: '⌫',
                    onPressed: onBackspace,
                    semanticLabel: 'Backspace',
                  ),
                ),
              ],
            ),
          ],
        );
      },
    );
  }

  Widget _row(List<String> digits) {
    return Row(
      children: digits.map((d) => Expanded(child: _digit(d))).toList(),
    );
  }

  Widget _digit(String d) =>
      _KeyButton(label: d, onPressed: () => onDigit(d), semanticLabel: d);
}

class _KeyButton extends StatelessWidget {
  const _KeyButton({
    required this.label,
    required this.onPressed,
    required this.semanticLabel,
  });

  final String label;
  final VoidCallback onPressed;
  final String semanticLabel;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.all(6),
      child: SizedBox(
        height: 64,
        child: FilledButton.tonal(
          onPressed: onPressed,
          style: FilledButton.styleFrom(
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
            ),
            textStyle: theme.textTheme.headlineSmall,
          ),
          child: Semantics(
            label: semanticLabel,
            button: true,
            child: Text(label),
          ),
        ),
      ),
    );
  }
}
