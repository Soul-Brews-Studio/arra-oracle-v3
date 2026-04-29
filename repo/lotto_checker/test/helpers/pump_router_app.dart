import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

/// Pumps a widget tree backed by [MaterialApp.router] driven by [router],
/// wrapped in a [ProviderScope] so Riverpod overrides apply.
///
/// Use when the screen under test relies on go_router context APIs
/// (`context.pop`, `canPop`, `go`) — a plain `MaterialApp(home: ...)` has no
/// GoRouter ancestor and those calls throw.
extension PumpRouterApp on WidgetTester {
  Future<void> pumpRouterApp({
    required GoRouter router,
    List<Override> overrides = const [],
  }) {
    return pumpWidget(
      ProviderScope(
        overrides: overrides,
        child: MaterialApp.router(routerConfig: router),
      ),
    );
  }
}
