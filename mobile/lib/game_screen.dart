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
  }

  @override
  void dispose() {
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
            duration: Duration(seconds: 2),
            backgroundColor: GameColors.deep,
            content: Text(
              'Bonyeza tena kuondoka\nPress back again to exit',
              textAlign: TextAlign.center,
            ),
          ),
        );
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
                initialUrlRequest: URLRequest(url: WebUri(_gameUri.toString())),
                initialSettings: _settings,
                onWebViewCreated: (controller) {
                  _controller = controller;
                  _registerBridge(controller);
                },
                onLoadStop: (_, __) {
                  if (!mounted) return;
                  setState(() => _firstFramePainted = true);
                  _enterImmersiveMode();
                },
                onReceivedError: (_, request, error) {
                  if (request.isForMainFrame != true) return;
                  setState(() => _fatalError = error.description);
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
                },
              ),
            ),
            if (!_firstFramePainted && error == null) const _LoadingOverlay(),
            if (error != null) _ErrorOverlay(message: error, onRetry: _reload),
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

  static final InAppWebViewSettings _settings = createGameWebViewSettings();
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
