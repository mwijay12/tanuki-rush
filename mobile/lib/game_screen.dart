import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';

import 'app_theme.dart';
import 'game_webview_settings.dart';
import 'local_database.dart';
import 'local_storage_ui.dart';
import 'notification_service.dart';

/// Hosts the game. The WebView only ever talks to the loopback server this app
/// started, so every navigation to another origin is blocked.
class GameScreen extends StatefulWidget {
  const GameScreen({super.key, required this.gameUri, required this.onQuit});

  final Uri gameUri;
  final VoidCallback onQuit;

  @override
  State<GameScreen> createState() => _GameScreenState();
}

class _GameScreenState extends State<GameScreen> with WidgetsBindingObserver {
  InAppWebViewController? _controller;
  final LocalDatabase _localDatabase = const LocalDatabase();
  final ValueNotifier<String> _storageStatus = ValueNotifier('loading');
  bool _firstFramePainted = false;
  String? _fatalError;
  DateTime? _lastBackPress;
  Timer? _bootPollTimer;
  String _lastBootLine = '';
  int _bootPolls = 0;

  /// Which platform-view presentation the WebView is using right now, and the
  /// key that forces it to be recreated when that changes. Both are needed: an
  /// [InAppWebView] reads its settings once, so switching presentation means
  /// rebuilding the view from scratch.
  GameCompositionMode _mode = GameCompositionMode.hybrid;
  int _webViewEpoch = 0;
  Timer? _hintTimer;
  bool _showModeHint = true;

  /// What the WebView says it is showing. The page is audible but invisible on
  /// the affected device, so "did it even load" is a separate open question, and
  /// this is answered by the plugin rather than by the page.
  String _pageLabel = 'loading…';

  // The query selects the native backend without changing the stable origin.
  Uri get _gameUri => widget.gameUri.replace(queryParameters: {
        ...widget.gameUri.queryParameters,
        'native': '1',
      });

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _enterImmersiveMode();
    // Long enough to cover the whole boot on a slow device, short enough that
    // it is gone before anyone is playing.
    _showModeHintFor(const Duration(seconds: 45));
  }

  @override
  void dispose() {
    _bootPollTimer?.cancel();
    _hintTimer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    _storageStatus.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Immersive mode is dropped by the system after a dialog, rotation, or
    // app switch; re-apply it and let the game check its Web Audio context.
    if (state == AppLifecycleState.resumed) {
      _enterImmersiveMode();
      unawaited(_notifyGameResumed());
    }
  }

  /// Asks the page where its boot sequence is, once a second, and writes the
  /// answer to logcat.
  ///
  /// The loading screen now prints its own stage, but a report from the field
  /// also needs a trace that survives the screen: the reported symptom is a flat
  /// navy surface with the process alive, which cannot distinguish "the page is
  /// stuck inside a named call" from "the page stopped being drawn". The sample
  /// counter settles it - a counter that keeps climbing while the screen stays
  /// flat means the page is alive and not being presented, and a counter that
  /// stops means the page hung, and the last stage says where.
  void _startPageBootPolling() {
    _bootPollTimer?.cancel();
    _bootPollTimer = Timer.periodic(const Duration(seconds: 1), (_) => _pollPageBoot());
    unawaited(_pollPageBoot());
  }

  Future<void> _pollPageBoot() async {
    final controller = _controller;
    if (controller == null) return;
    try {
      final result = await controller.evaluateJavascript(
        source: 'window.__tanukiBoot ? JSON.stringify(window.__tanukiBoot()) : null',
      );
      if (!mounted) return;
      final raw = result is String ? result : result?.toString();
      if (raw == null || raw.isEmpty || raw == 'null') {
        _bootLine('"boot hook not present yet"');
        return;
      }
      _bootLine(raw);
    } catch (_) {
      // The page can be mid-navigation or the view mid-teardown; a failed poll
      // is uninteresting and must never surface as an error.
    }
  }

  /// Writes one page-boot breadcrumb. The poller stops as soon as the page says
  /// it reached `ready`, and in any case after [maxBootPolls]: `totalMs` changes
  /// every second, so an unconditional poll would print once a second for the
  /// whole session and bury the lines that matter.
  static const int maxBootPolls = 180;

  void _bootLine(String payload) {
    _bootPolls += 1;
    final reachedReady = payload.contains('"stage":"ready"');
    if (_bootPolls >= maxBootPolls || reachedReady) _bootPollTimer?.cancel();
    if (payload == _lastBootLine) return;
    _lastBootLine = payload;
    // ignore: avoid_print — logcat breadcrumb; debugPrint is dropped in release.
    print('[tanuki] page-boot: $payload');
  }

  Future<void> _notifyGameResumed() async {
    try {
      await _controller?.evaluateJavascript(
        source: "window.dispatchEvent(new Event('tanuki:app-resumed'));",
      );
    } catch (error) {
      debugPrint('[game] audio resume notification failed: $error');
    }
  }

  void _enterImmersiveMode() {
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
  }

  Future<void> _handleBack() async {
    final now = DateTime.now();
    final previous = _lastBackPress;
    _lastBackPress = now;

    // First press: pause the game (it listens for Escape) and warn.
    if (previous == null || now.difference(previous) > const Duration(seconds: 2)) {
      unawaited(_sendPauseKey());
      if (!mounted) return;
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(
          const SnackBar(
            // Two seconds is too short to read three lines, and the second
            // press no longer exits: it switches how the WebView is presented.
            // The message has to say so or it is a lie on the screen.
            duration: Duration(seconds: 5),
            backgroundColor: GameColors.deep,
            content: Text(
              'Bonyeza tena: badilisha njia ya kuchora (picha ikikosekana)\n'
              'Bonyeza mara ya 3: ondoka\n'
              'Back again: switch render mode if the picture is missing · 3rd: exit',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 13, height: 1.5),
            ),
          ),
        );
      return;
    }

    // Second press inside two seconds: switch how the WebView is presented.
    // On the reporting device the page is audible but not visible, so nothing
    // the page draws can offer this choice - the back button and Flutter's own
    // widgets are the only controls that provably reach the screen. Exiting
    // becomes a third press, which is still reachable and still says so.
    if (_fatalError == null) {
      _switchCompositionMode();
      return;
    }

    if (_storageStatus.value == 'saving' || _storageStatus.value == 'error') {
      final leave = await confirmExitWithUnsavedChanges(
        context,
        onRetry: () => unawaited(_retryStorage()),
      );
      if (!leave || !mounted) return;
    }
    widget.onQuit();
  }

  Future<void> _retryStorage() async {
    try {
      await _controller?.evaluateJavascript(
        source: "window.dispatchEvent(new Event('tanuki:storage-retry'));",
      );
    } catch (error) {
      debugPrint('[game] storage retry notification failed: $error');
    }
  }

  /// The game pauses on `Esc` / `P`; synthesising the key keeps pause semantics
  /// owned by the game instead of duplicating its state machine natively.
  Future<void> _sendPauseKey() async {
    const script = '''
      (function () {
        ['keydown', 'keyup'].forEach(function (type) {
          window.dispatchEvent(new KeyboardEvent(type, {
            key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true
          }));
        });
      })();
    ''';
    try {
      await _controller?.evaluateJavascript(source: script);
    } catch (error) {
      debugPrint('[game] pause key failed: $error');
    }
  }

  /// Exposes native capabilities to the game via
  /// `window.flutter_inappwebview.callHandler(name, ...)`. The web build calls
  /// these through src/platform.js and falls back to Web APIs when absent.
  void _registerBridge(InAppWebViewController controller) {
    controller.addJavaScriptHandler(
      handlerName: 'localStoreBootstrap',
      callback: (args) async {
        try {
          return await _localDatabase.bootstrap(args.isEmpty ? null : args.first);
        } catch (error) {
          debugPrint('[storage] could not open local database: ${error.runtimeType}');
          return {'ok': false};
        }
      },
    );
    controller.addJavaScriptHandler(
      handlerName: 'localStoreWrite',
      callback: (args) async {
        if (mounted) _storageStatus.value = 'saving';
        try {
          return await _localDatabase.write(args.isEmpty ? null : args.first);
        } catch (error) {
          if (mounted) _storageStatus.value = 'error';
          debugPrint('[storage] local database write failed: ${error.runtimeType}');
          return {'ok': false};
        }
      },
    );
    controller.addJavaScriptHandler(
      handlerName: 'localStoreStatus',
      callback: (args) {
        final data = args.isNotEmpty && args.first is Map ? args.first as Map : const {};
        final value = data['status'];
        if (mounted && value is String && {'saving', 'saved', 'error'}.contains(value)) {
          _storageStatus.value = value;
        }
        return null;
      },
    );
    controller.addJavaScriptHandler(
      handlerName: 'localStoreStartupError',
      callback: (_) {
        if (mounted) {
          setState(() {
            _fatalError = 'Hifadhi ya simu haikufunguka. Maendeleo hayajafutwa. '
                'Angalia nafasi na ujaribu tena.\n\n'
                'Could not open device storage. Saved data was not deleted. '
                'Check free space and retry.';
          });
        }
        return null;
      },
    );
    controller.addJavaScriptHandler(
      handlerName: 'showStorageInfo',
      callback: (_) async {
        if (mounted) {
          await showLocalStorageDetails(
            context,
            status: _storageStatus,
            onRetry: () => unawaited(_retryStorage()),
          );
        }
        return null;
      },
    );

    controller.addJavaScriptHandler(
      handlerName: 'haptic',
      callback: (args) {
        final type = args.isNotEmpty ? '${args.first}' : 'light';
        switch (type) {
          case 'heavy':
          case 'error':
            HapticFeedback.heavyImpact();
            break;
          case 'medium':
          case 'success':
            HapticFeedback.mediumImpact();
            break;
          case 'select':
            HapticFeedback.selectionClick();
            break;
          default:
            HapticFeedback.lightImpact();
        }
        return null;
      },
    );

    controller.addJavaScriptHandler(
      handlerName: 'requestNotifications',
      callback: (args) => NotificationService.instance.requestPermission(),
    );

    controller.addJavaScriptHandler(
      handlerName: 'scheduleStreakReminder',
      callback: (args) async {
        final map = args.isNotEmpty && args.first is Map ? args.first as Map : const {};
        final streak = (map['streak'] as num?)?.toInt() ?? 0;
        await NotificationService.instance.scheduleStreakReminder(streak);
        return null;
      },
    );

    controller.addJavaScriptHandler(
      handlerName: 'cancelStreakReminder',
      callback: (args) => NotificationService.instance.cancelStreakReminder(),
    );
  }

  Future<void> _reload() async {
    setState(() {
      _fatalError = null;
      _firstFramePainted = false;
    });
    _storageStatus.value = 'loading';
    await _controller?.loadUrl(urlRequest: URLRequest(url: WebUri(_gameUri.toString())));
  }

  @override
  Widget build(BuildContext context) {
    final error = _fatalError;

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (didPop) return;
        _handleBack();
      },
      child: Scaffold(
        backgroundColor: GameColors.night,
        body: Stack(
          children: [
            Positioned.fill(
              child: InAppWebView(
                key: ValueKey<int>(_webViewEpoch),
                initialUrlRequest: URLRequest(url: WebUri(_gameUri.toString())),
                initialSettings: _settings,
                onWebViewCreated: (controller) {
                  _controller = controller;
                  _registerBridge(controller);
                  _startPageBootPolling();
                },
                onLoadStop: (_, loadedUrl) async {
                  if (!mounted) return;
                  setState(() => _firstFramePainted = true);
                  _enterImmersiveMode();
                  // The badge is Flutter's own widget, so it is visible on
                  // screens where nothing the WebView draws is visible. Putting
                  // the loaded URL and the document's own readiness there
                  // answers whether the page arrived at all, without a PC and
                  // without trusting a plugin API this file has not used
                  // before: evaluateJavascript is already called three times
                  // here, so its shape is known.
                  String title = '';
                  try {
                    final probed = await _controller?.evaluateJavascript(
                      source: "document.readyState + ' / ' + document.title",
                    );
                    title = probed?.toString().trim() ?? '';
                  } catch (_) {
                    title = '';
                  }
                  if (!mounted) return;
                  setState(() {
                    _pageLabel = 'page: ${loadedUrl ?? '?'} · '
                        '${title.isEmpty ? 'no title' : title}';
                  });
                },
                onReceivedError: (_, request, error) {
                  if (request.isForMainFrame != true) return;
                  setState(() {
                    _fatalError = error.description;
                    // error.type is a plain class in flutter_inappwebview, not
                    // a Dart enum, so it has no `name` getter - the same trap
                    // ConsoleMessageLevel set one build earlier. toString() is
                    // what the plugin overrides.
                    _pageLabel = 'page error: ${error.type} ${error.description}';
                  });
                },
                onReceivedHttpError: (_, request, response) {
                  if (request.isForMainFrame != true) return;
                  setState(() => _fatalError = 'HTTP ${response.statusCode}');
                },
                shouldOverrideUrlLoading: (_, action) async {
                  final target = action.request.url;
                  // The origin includes scheme and port, not just the host.
                  if (target == null ||
                      target.scheme != widget.gameUri.scheme ||
                      target.host != widget.gameUri.host ||
                      target.port != widget.gameUri.port) {
                    return NavigationActionPolicy.CANCEL;
                  }
                  return NavigationActionPolicy.ALLOW;
                },
                onConsoleMessage: (_, message) {
                  if (kDebugMode) {
                    debugPrint('[web ${message.messageLevel}] ${message.message}');
                  }
                  // Errors and warnings also go to logcat in a release build,
                  // where debugPrint is dropped. The page's own boot breadcrumbs
                  // are useless if they only exist in a build the field cannot
                  // run, and a 240-character cap keeps logcat readable.
                  final level = message.messageLevel;
                  if (level == ConsoleMessageLevel.ERROR ||
                      level == ConsoleMessageLevel.WARNING) {
                    final text = message.message;
                    final clipped =
                        text.length > 240 ? '${text.substring(0, 240)}…' : text;
                    // ConsoleMessageLevel is a plain class in
                    // flutter_inappwebview, not a Dart enum, so it has no `name`
                    // getter; toString() is what the package overrides.
                    // ignore: avoid_print — logcat breadcrumb; debugPrint is dropped in release.
                    print('[tanuki-web] $level: $clipped');
                  }
                },
              ),
            ),
            if (!_firstFramePainted && error == null) const _LoadingOverlay(),
            if (error != null) _ErrorOverlay(message: error, onRetry: _reload),
            if (_showModeHint)
              _CompositionModeBadge(label: _mode.label, page: _pageLabel),
            if (error == null)
              ValueListenableBuilder<String>(
                valueListenable: _storageStatus,
                builder: (_, status, __) => status == 'error'
                    ? LocalStorageWarning(onRetry: () => unawaited(_retryStorage()))
                    : const SizedBox.shrink(),
              ),
          ],
        ),
      ),
    );
  }

  InAppWebViewSettings get _settings => createGameWebViewSettings(mode: _mode);

  /// Switches how Flutter presents the WebView and reloads the page into it.
  ///
  /// This exists because the affected device gives no other way in: the page is
  /// audible but invisible, so anything the page could show is invisible too.
  /// The back button, the SnackBar and this badge are Flutter's own widgets and
  /// they *are* visible on that screen, which makes them the only usable
  /// controls. Pressing back twice therefore switches presentation instead of
  /// only offering to exit.
  void _switchCompositionMode() {
    setState(() {
      _mode = _mode == GameCompositionMode.hybrid
          ? GameCompositionMode.texture
          : GameCompositionMode.hybrid;
      _webViewEpoch += 1;
      _firstFramePainted = false;
      _fatalError = null;
      _bootPolls = 0;
      _lastBootLine = '';
      _pageLabel = 'loading…';
    });
    _bootPollTimer?.cancel();
    _showModeHintFor(const Duration(seconds: 12));
    // ignore: avoid_print — logcat breadcrumb; debugPrint is dropped in release.
    print('[tanuki] composition-mode: ${_mode.label} (view epoch $_webViewEpoch)');
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          duration: const Duration(seconds: 4),
          backgroundColor: GameColors.deep,
          content: Text(
            'Njia ya kuchora / render mode: ${_mode.label}\n'
            'Subiri sekunde chache. Picha ikija, njia hii ndiyo sahihi.\n'
            'Wait a few seconds. If the picture appears, this mode is the fix.\n'
            'Bonyeza tena kurudi ${_mode == GameCompositionMode.texture ? 'HYBRID' : 'TEXTURE'} · mara ya 3: ondoka',
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 13, height: 1.5),
          ),
        ),
      );
  }

  /// Keeps the on-screen mode badge visible for [duration]. It is shown during
  /// boot, when it is most likely to be needed, and hidden afterwards so it
  /// never sits on top of a playable game.
  void _showModeHintFor(Duration duration) {
    _hintTimer?.cancel();
    if (!mounted) return;
    setState(() => _showModeHint = true);
    _hintTimer = Timer(duration, () {
      if (mounted) setState(() => _showModeHint = false);
    });
  }
}

class _LoadingOverlay extends StatelessWidget {
  const _LoadingOverlay();

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: GameColors.night,
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const _LeafMark(size: 64),
            const SizedBox(height: 28),
            SizedBox(
              width: 160,
              child: LinearProgressIndicator(
                minHeight: 3,
                backgroundColor: Colors.white12,
                valueColor: const AlwaysStoppedAnimation<Color>(GameColors.leaf),
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            const SizedBox(height: 18),
            const Text(
              'TANUKI RUSH',
              style: TextStyle(
                fontSize: 20,
                letterSpacing: 6,
                fontWeight: FontWeight.w900,
                color: Colors.white,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ErrorOverlay extends StatelessWidget {
  const _ErrorOverlay({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: GameColors.night,
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.videogame_asset_off_outlined, size: 48, color: GameColors.haze),
              const SizedBox(height: 16),
              const Text(
                'Mchezo haukufunguka / Could not start the game',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 8),
              Text(
                message,
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 12, color: GameColors.haze),
              ),
              const SizedBox(height: 20),
              FilledButton(
                onPressed: onRetry,
                child: const Text('Jaribu tena / Retry'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Simple leaf glyph echoing the game's icon, drawn in code (no asset needed).
class _LeafMark extends StatelessWidget {
  const _LeafMark({required this.size});

  final double size;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: size,
      height: size,
      child: CustomPaint(painter: _LeafPainter()),
    );
  }
}

class _LeafPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final path = Path()
      ..moveTo(size.width * 0.5, size.height * 0.05)
      ..cubicTo(size.width * 0.95, size.height * 0.28, size.width * 0.90,
          size.height * 0.70, size.width * 0.5, size.height * 0.95)
      ..cubicTo(size.width * 0.10, size.height * 0.70, size.width * 0.05,
          size.height * 0.28, size.width * 0.5, size.height * 0.05)
      ..close();

    canvas.drawPath(path, Paint()..color = GameColors.leaf);
    canvas.drawPath(
      path,
      Paint()
        ..color = GameColors.deep
        ..style = PaintingStyle.stroke
        ..strokeWidth = size.width * 0.07,
    );
    canvas.drawLine(
      Offset(size.width * 0.5, size.height * 0.22),
      Offset(size.width * 0.5, size.height * 0.82),
      Paint()
        ..color = GameColors.deep.withValues(alpha: 0.45)
        ..strokeWidth = size.width * 0.035,
    );
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

/// Names the current platform-view presentation, drawn by Flutter.
///
/// Deliberately a Flutter widget and not part of the page: on the device this
/// was written for, the page is running and audible while nothing it draws
/// reaches the display. Anything the WebView renders is therefore invisible
/// there, and a diagnostic the sufferer cannot see is not a diagnostic.
class _CompositionModeBadge extends StatelessWidget {
  const _CompositionModeBadge({required this.label, required this.page});

  final String label;
  final String page;

  @override
  Widget build(BuildContext context) {
    const style = TextStyle(
      color: Color(0xE6FFE14F),
      fontSize: 11,
      fontWeight: FontWeight.w800,
      letterSpacing: 0.4,
      shadows: [Shadow(color: Color(0xCC000000), blurRadius: 3)],
    );
    return Positioned(
      left: 0,
      right: 0,
      bottom: 6,
      child: IgnorePointer(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'MODE: $label  ·  BACK ×2 kubadilisha / to switch  ·  BACK ×3 kuondoka / to exit',
              textAlign: TextAlign.center,
              style: style,
            ),
            Text(page, textAlign: TextAlign.center, style: style),
          ],
        ),
      ),
    );
  }
}
