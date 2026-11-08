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
