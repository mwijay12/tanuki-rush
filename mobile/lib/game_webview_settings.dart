import 'package:flutter/foundation.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';

/// How Flutter presents the WebView's surface on Android.
///
/// A Pixel 8 Pro (Android 17, Mali-G715) plays the game with no picture: the
/// page's own audio is audible, Flutter draws its own widgets on the same screen
/// (the "press back again" SnackBar appears over the navy), and the navy is not
/// the page - `hud.css` sets `html, body { background: #000 }`, so `#0A1A44` is
/// Flutter's Scaffold or the Android window background. The page is therefore
/// alive and *not being presented*, which puts the fault in the platform-view
/// path rather than in the game, the driver or startup timing.
///
/// That path has exactly two implementations, so both are reachable at runtime
/// and the back button can switch between them on the affected device. Neither
/// is a guess: `useHybridComposition` is documented in
/// `flutter_inappwebview_platform_interface/lib/src/in_app_webview/in_app_webview_settings.dart`
/// as "Set to `false` to disable Flutter Hybrid Composition", defaulting to
/// `true`.
enum GameCompositionMode {
  /// The default. Android composites the WebView's own surface into the window,
  /// which is what every shipped build so far has used.
  hybrid('HYBRID'),

  /// `useHybridComposition: false`. Flutter draws the WebView into its own
  /// layer tree instead, so the pixels travel the same path as every other
  /// Flutter widget - a path this device demonstrably renders.
  texture('TEXTURE');

  const GameCompositionMode(this.label);

  /// Short label for on-screen display; the screen is a game, not a console.
  final String label;
}

/// Settings shared by the game screen and the touch-regression tests.
///
/// [mode] only changes how the surface is presented. The drag-axis flags below
/// are what govern touch, and they stay false in every mode.
InAppWebViewSettings createGameWebViewSettings({
  GameCompositionMode mode = GameCompositionMode.hybrid,
}) => InAppWebViewSettings(
  javaScriptEnabled: true,
  domStorageEnabled: true,
  databaseEnabled: true,
  mediaPlaybackRequiresUserGesture: false,
  transparentBackground: false,
  useHybridComposition: mode == GameCompositionMode.hybrid,
  hardwareAcceleration: true,

  // IMPORTANT: flutter_inappwebview_android 1.1.3 consumes every Android
  // ACTION_MOVE when BOTH disable*Scroll flags are true. With either one true,
  // it rewrites that axis of the MotionEvent. Keep both flags false so the
  // game receives unmodified drag gestures even inside the Android app.
  // The game's CSS uses
  // overflow:hidden and touch-action:none, and overscroll/zoom stay disabled.
  disableVerticalScroll: false,
  disableHorizontalScroll: false,
  overScrollMode: OverScrollMode.NEVER,
  supportZoom: false,
  builtInZoomControls: false,
  displayZoomControls: false,
  verticalScrollBarEnabled: false,
  horizontalScrollBarEnabled: false,
  disableContextMenu: true,
  supportMultipleWindows: false,
  allowFileAccess: false,
  allowContentAccess: false,
  cacheEnabled: true,
  useShouldOverrideUrlLoading: true,
  isInspectable: kDebugMode,
);
