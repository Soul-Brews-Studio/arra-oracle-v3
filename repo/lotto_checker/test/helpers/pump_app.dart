import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

/// Test helper that pumps a widget under [ProviderScope] + [MaterialApp].
///
/// Usage:
/// ```dart
/// await tester.pumpApp(const HomeScreen());
/// ```
extension PumpApp on WidgetTester {
  Future<void> pumpApp(
    Widget widget, {
    List<Override> overrides = const [],
  }) {
    return pumpWidget(
      ProviderScope(
        overrides: overrides,
        child: MaterialApp(home: widget),
      ),
    );
  }
}
