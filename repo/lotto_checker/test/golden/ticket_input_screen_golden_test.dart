@Tags(['golden'])
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:golden_toolkit/golden_toolkit.dart';
import 'package:lotto_checker/features/tickets/data/providers.dart';
import 'package:lotto_checker/features/tickets/data/ticket_repository.dart';
import 'package:lotto_checker/features/tickets/presentation/controllers/ticket_input_controller.dart';
import 'package:lotto_checker/features/tickets/presentation/ticket_input_screen.dart';
import 'package:mocktail/mocktail.dart';

import '../helpers/golden_config.dart';

class _MockTicketRepository extends Mock implements TicketRepository {}

/// Sub-class that pins the initial draw date so the rendered "Draw date:"
/// label is deterministic across days. The real controller computes the
/// default from `DateTime.now()`, which would make the golden flap.
class _FixedDateController extends TicketInputController {
  _FixedDateController(super.ref) {
    state = state.copyWith(drawDate: DateTime.utc(2026, 5, 1));
  }
}

void main() {
  group('TicketInputScreen golden', () {
    testGoldens('renders consistently across iPhone 14 + Pixel 7',
        (tester) async {
      final repo = _MockTicketRepository();
      final builder = buildStandardDevices(
        const TicketInputScreen(),
        name: 'ticket_input_screen',
      );
      await tester.pumpDeviceBuilder(
        builder,
        wrapper: (child) => ProviderScope(
          overrides: [
            ticketRepositoryProvider.overrideWithValue(repo),
            ticketInputControllerProvider
                .overrideWith((ref) => _FixedDateController(ref)),
          ],
          child: MaterialApp(home: child),
        ),
      );
      await screenMatchesGolden(tester, 'ticket_input_screen');
    });
  });
}
