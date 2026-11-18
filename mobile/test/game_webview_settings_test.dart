import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tanuki_rush/game_webview_settings.dart';

void main() {
  test('WebView settings do not intercept either drag axis', () {
    final settings = createGameWebViewSettings();

    // In flutter_inappwebview_android 1.1.3 these flags do more than hide
    // scrollbars: they swallow ACTION_MOVE or rewrite its coordinates.
    expect(settings.disableHorizontalScroll, isFalse);
    expect(settings.disableVerticalScroll, isFalse);
    // Check the values passed over the platform channel as well as the fields.
    final nativeSettings = settings.toMap();
    expect(nativeSettings['disableHorizontalScroll'], isFalse);
    expect(nativeSettings['disableVerticalScroll'], isFalse);
  });

  test('the presentation mode reaches the platform channel, and only that', () {
    // A Pixel 8 Pro plays the game with audio but no picture, and Flutter's own
    // widgets do appear on that screen, so the fault is in how the platform view
    // is presented. Both presentations must be reachable at runtime and they must
    // differ in exactly one field.
    final hybrid = createGameWebViewSettings();
    final texture = createGameWebViewSettings(mode: GameCompositionMode.texture);

    expect(hybrid.useHybridComposition, isTrue);
    expect(hybrid.toMap()['useHybridComposition'], isTrue);
    expect(texture.useHybridComposition, isFalse);
    expect(texture.toMap()['useHybridComposition'], isFalse);

    // Switching presentation must not become a way to lose touch input: the
    // drag-axis flags are what flutter_inappwebview_android rewrites events for.
    for (final settings in [hybrid, texture]) {
      expect(settings.disableHorizontalScroll, isFalse);
      expect(settings.disableVerticalScroll, isFalse);
      expect(settings.hardwareAcceleration, isTrue);
      expect(settings.transparentBackground, isFalse);
      expect(settings.javaScriptEnabled, isTrue);
      expect(settings.mediaPlaybackRequiresUserGesture, isFalse);
    }
  });

  test('overscroll and zoom remain disabled without blocking touch moves', () {
    final settings = createGameWebViewSettings();
    expect(settings.overScrollMode, OverScrollMode.NEVER);
    expect(settings.supportZoom, isFalse);
    expect(settings.builtInZoomControls, isFalse);
    expect(settings.displayZoomControls, isFalse);
    expect(settings.verticalScrollBarEnabled, isFalse);
    expect(settings.horizontalScrollBarEnabled, isFalse);
    expect(settings.javaScriptEnabled, isTrue);
    expect(settings.domStorageEnabled, isTrue);
  });
}