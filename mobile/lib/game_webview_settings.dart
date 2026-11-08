import 'package:flutter/foundation.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';

/// Settings shared by the game screen and the touch-regression tests.
InAppWebViewSettings createGameWebViewSettings() => InAppWebViewSettings(
  javaScriptEnabled: true,
  domStorageEnabled: true,
  databaseEnabled: true,
  mediaPlaybackRequiresUserGesture: false,
  transparentBackground: false,
  useHybridComposition: true,
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
