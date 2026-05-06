import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Sarabun — Thai-friendly Material 3 type scale.
///
/// Uses [GoogleFonts.sarabunTextTheme] to lay Sarabun over the M3 default
/// scale, keeping every size, line-height, and letter-spacing untouched. We
/// only nudge weights for `display`/`headline` to read with a bit more
/// authority on the lottery hero card.
class AppTypography {
  const AppTypography._();

  static TextTheme buildLightTextTheme() => _apply(ThemeData.light().textTheme);
  static TextTheme buildDarkTextTheme() => _apply(ThemeData.dark().textTheme);

  static TextTheme _apply(TextTheme base) {
    final sarabun = GoogleFonts.sarabunTextTheme(base);
    return sarabun.copyWith(
      displayLarge: sarabun.displayLarge?.copyWith(fontWeight: FontWeight.w700),
      displayMedium:
          sarabun.displayMedium?.copyWith(fontWeight: FontWeight.w700),
      displaySmall: sarabun.displaySmall?.copyWith(fontWeight: FontWeight.w700),
      headlineLarge:
          sarabun.headlineLarge?.copyWith(fontWeight: FontWeight.w600),
      headlineMedium:
          sarabun.headlineMedium?.copyWith(fontWeight: FontWeight.w600),
      titleLarge: sarabun.titleLarge?.copyWith(fontWeight: FontWeight.w600),
    );
  }
}
