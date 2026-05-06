import 'package:flutter/material.dart';

import 'app_typography.dart';

/// Material 3 expressive theme seeded from Thai-lottery red (#D32F2F).
///
/// Both `light` and `dark` share the same [ColorScheme.fromSeed] palette so
/// brand identity stays consistent across modes. Component shapes follow M3
/// defaults — no custom shadow, no gradient overrides.
class AppTheme {
  const AppTheme._();

  static const Color seedColor = Color(0xFFD32F2F); // Thai lottery red

  static ThemeData get light => _build(Brightness.light);
  static ThemeData get dark => _build(Brightness.dark);

  static ThemeData _build(Brightness brightness) {
    final scheme = ColorScheme.fromSeed(
      seedColor: seedColor,
      brightness: brightness,
    );
    final isLight = brightness == Brightness.light;
    final textTheme = isLight
        ? AppTypography.buildLightTextTheme()
        : AppTypography.buildDarkTextTheme();
    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: scheme,
      textTheme: textTheme,
      scaffoldBackgroundColor: scheme.surface,
      appBarTheme: AppBarTheme(
        backgroundColor: scheme.surface,
        foregroundColor: scheme.onSurface,
        elevation: 0,
        scrolledUnderElevation: 1,
        centerTitle: false,
      ),
      cardTheme: const CardTheme(
        clipBehavior: Clip.antiAlias,
        margin: EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          shape: const StadiumBorder(),
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
        ),
      ),
      chipTheme: ChipThemeData(
        side: BorderSide(color: scheme.outlineVariant),
        shape: const StadiumBorder(),
      ),
    );
  }
}
