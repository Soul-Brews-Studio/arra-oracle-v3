import 'package:flutter/animation.dart';

/// Single source of truth for animation durations and curves.
///
/// Use [emphasized] for hero/page transitions, [standard] for everyday
/// state changes (chips, switches, theme), [emphasizedDecel] when something
/// arrives on screen, and [emphasizedAccel] when something leaves.
class AppMotion {
  const AppMotion._();

  // Durations — Material 3 expressive defaults.
  static const Duration short = Duration(milliseconds: 200);
  static const Duration medium = Duration(milliseconds: 300);
  static const Duration long = Duration(milliseconds: 500);

  // Curves — Material 3 expressive set.
  static const Curve standard = Curves.easeInOutCubic;
  static const Curve emphasized = Curves.easeInOutCubicEmphasized;
  static const Curve emphasizedDecel = Curves.fastOutSlowIn;
  static const Curve emphasizedAccel = Curves.easeInCubic;
}
