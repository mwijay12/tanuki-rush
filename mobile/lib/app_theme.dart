import 'package:flutter/material.dart';

/// Palette lifted from the game UI so the native shell does not flash a
/// mismatched colour while the WebView warms up.
abstract final class GameColors {
  static const Color night = Color(0xFF0A1A44);
  static const Color deep = Color(0xFF0C1633);
  static const Color leaf = Color(0xFFFFC629);
  static const Color haze = Color(0xFF9FB0D0);
}

ThemeData buildAppTheme() {
  final base = ThemeData.dark(useMaterial3: true);
  return base.copyWith(
    scaffoldBackgroundColor: GameColors.night,
    colorScheme: base.colorScheme.copyWith(
      primary: GameColors.leaf,
      secondary: GameColors.leaf,
      surface: GameColors.deep,
    ),
    textTheme: base.textTheme.apply(
      bodyColor: Colors.white,
      displayColor: Colors.white,
    ),
  );
}
