import 'dart:math';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../shared/models/ticket.dart';
import '../../data/providers.dart';

class TicketInputState {
  const TicketInputState({
    this.numbers = '',
    this.drawDate,
    this.note = '',
    this.saving = false,
    this.error,
  });

  final String numbers;
  final DateTime? drawDate;
  final String note;
  final bool saving;
  final String? error;

  bool get isValid => RegExp(r'^[0-9]{6}$').hasMatch(numbers);

  TicketInputState copyWith({
    String? numbers,
    DateTime? drawDate,
    bool clearDrawDate = false,
    String? note,
    bool? saving,
    String? error,
    bool clearError = false,
  }) {
    return TicketInputState(
      numbers: numbers ?? this.numbers,
      drawDate: clearDrawDate ? null : (drawDate ?? this.drawDate),
      note: note ?? this.note,
      saving: saving ?? this.saving,
      error: clearError ? null : (error ?? this.error),
    );
  }
}

class TicketInputController extends StateNotifier<TicketInputState> {
  TicketInputController(this._ref) : super(const TicketInputState());

  final Ref _ref;

  void appendDigit(String digit) {
    if (state.numbers.length >= 6) return;
    state = state.copyWith(numbers: state.numbers + digit, clearError: true);
  }

  void backspace() {
    if (state.numbers.isEmpty) return;
    state = state.copyWith(
      numbers: state.numbers.substring(0, state.numbers.length - 1),
      clearError: true,
    );
  }

  void setDrawDate(DateTime? date) {
    state = state.copyWith(drawDate: date, clearDrawDate: date == null);
  }

  void setNote(String value) {
    state = state.copyWith(note: value);
  }

  Future<bool> save() async {
    if (!state.isValid || state.saving) return false;
    state = state.copyWith(saving: true, clearError: true);
    try {
      final now = DateTime.now();
      final draw = state.drawDate ?? nextThaiDrawDate(now);
      final ticket = Ticket(
        id: _generateId(),
        numbers: state.numbers,
        drawDate: DateTime(draw.year, draw.month, draw.day),
        createdAt: now,
        note: state.note.trim().isEmpty ? null : state.note.trim(),
      );
      await _ref.read(ticketRepositoryProvider).save(ticket);
      state = const TicketInputState();
      return true;
    } catch (e) {
      state = state.copyWith(saving: false, error: e.toString());
      return false;
    }
  }

  String _generateId() {
    final ms = DateTime.now().millisecondsSinceEpoch;
    final rand = Random().nextInt(1 << 32).toRadixString(16);
    return '$ms-$rand';
  }
}

DateTime nextThaiDrawDate(DateTime from) {
  final candidates = <DateTime>[
    DateTime(from.year, from.month, 1),
    DateTime(from.year, from.month, 16),
    DateTime(from.year, from.month + 1, 1),
  ];
  for (final c in candidates) {
    if (!c.isBefore(DateTime(from.year, from.month, from.day))) return c;
  }
  return candidates.last;
}

final ticketInputControllerProvider =
    StateNotifierProvider.autoDispose<TicketInputController, TicketInputState>(
  TicketInputController.new,
);
