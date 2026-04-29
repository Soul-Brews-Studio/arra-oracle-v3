@Tags(['golden'])
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:golden_toolkit/golden_toolkit.dart';
import 'package:lotto_checker/features/home/presentation/home_screen.dart';

import '../helpers/golden_config.dart';

void main() {
  group('HomeScreen golden', () {
    testGoldens('renders consistently across iPhone 14 + Pixel 7', (
      tester,
    ) async {
      final builder = buildStandardDevices(
        const HomeScreen(),
        name: 'home_screen',
      );

      await tester.pumpDeviceBuilder(
        builder,
        wrapper: (child) => ProviderScope(
          child: MaterialApp(home: child),
        ),
      );

      await screenMatchesGolden(tester, 'home_screen');
    });
  });
}
