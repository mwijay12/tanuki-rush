import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter/services.dart';

import 'app_theme.dart';
import 'game_bootstrap.dart';
import 'game_screen.dart';
import 'web_asset_server.dart';

/// How long the boot path waits for the OS before giving up with a visible
/// error instead of hanging forever.
const Duration _bootTimeout = Duration(seconds: 20);

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  final defaultErrorHandler = FlutterError.onError;
  FlutterError.onError = (details) {
    defaultErrorHandler?.call(details);
    // ignore: avoid_print — logcat breadcrumb; debugPrint is dropped in release.
    print('[tanuki] flutter-error: ${details.exception}');
  };

  // Paint the first frame before touching any platform channel. Awaiting
  // system UI before runApp() can wedge startup forever on some devices,
  // leaving only the (empty, blue) Android window background with no message.
  // The manifest already forces sensorLandscape at the activity level, so
  // configuring orientation after runApp causes no visible rotation flash.
  runZonedGuarded(() {
    runApp(const TanukiRushApp());
    unawaited(_configureSystemUI());
  }, (error, stack) {
    debugPrint('[tanuki] uncaught async error: $error\n$stack');
    // ignore: avoid_print — logcat breadcrumb; debugPrint is dropped in release.
    print('[tanuki] uncaught-async-error: $error');
  });
}

/// A downhill runner is played in landscape; locking it also avoids a
/// rebuild of the WebGL canvas during rotation mid-run. Never blocks startup:
/// each call either applies within [_bootTimeout] or is logged and skipped.
Future<void> _configureSystemUI() async {
  try {
    await SystemChrome.setPreferredOrientations(const [
      DeviceOrientation.landscapeLeft,
      DeviceOrientation.landscapeRight,
    ]).timeout(_bootTimeout);
  } catch (error) {
    debugPrint('[tanuki] orientation lock failed, continuing unlocked: $error');
  }
  try {
    await SystemChrome.setEnabledSystemUIMode(
      SystemUiMode.immersiveSticky,
    ).timeout(_bootTimeout);
  } catch (error) {
    debugPrint('[tanuki] immersive mode failed, continuing: $error');
  }
}

class TanukiRushApp extends StatelessWidget {
  const TanukiRushApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Tanuki Rush',
      debugShowCheckedModeBanner: false,
      theme: buildAppTheme(),
      home: const _GameGate(),
    );
  }
}

/// Starts the asset server, then hands the WebView a live URL.
/// The server lifetime is tied to this widget, which outlives the game screen.
class _GameGate extends StatefulWidget {
  const _GameGate();

  @override
  State<_GameGate> createState() => _GameGateState();
}

class _GameGateState extends State<_GameGate> {
  WebAssetServer? _server;
  String? _error;
  bool _starting = true;

  @override
  void initState() {
    super.initState();
    // Grep-friendly boot marker for the CI emulator smoke test: if this line
    // never reaches logcat, the app hung before its first Flutter frame.
    SchedulerBinding.instance.addPostFrameCallback((_) {
      // ignore: avoid_print — debugPrint is dropped in release builds.
      print('[tanuki] first-frame-painted');
    });
    _start();
  }

  @override
  void dispose() {
    _server?.stop();
    super.dispose();
  }

  Future<void> _start() async {
    setState(() {
      _starting = true;
      _error = null;
    });
    try {
      // Fail visibly (with retry) instead of spinning forever if the loopback
      // server cannot bind on this device.
      final server = await startGameServer().timeout(
        _bootTimeout,
        onTimeout: () =>
            throw TimeoutException('Asset server did not start in time', _bootTimeout),
      );
      if (!mounted) {
        await server.stop();
        return;
      }
      setState(() {
        _server = server;
        _starting = false;
      });
    } catch (error, stack) {
      debugPrint('[gate] failed to start asset server: $error\n$stack');
      if (!mounted) return;
      setState(() {
        _error = '$error';
        _starting = false;
      });
    }
  }

  Future<void> _quit() async {
    await _server?.stop();
    await SystemNavigator.pop();
  }

  @override
  Widget build(BuildContext context) {
    if (_starting) {
      return const Scaffold(
        backgroundColor: GameColors.night,
        body: Center(
          child: SizedBox(
            width: 32,
            height: 32,
            child: CircularProgressIndicator(
              strokeWidth: 2.5,
              valueColor: AlwaysStoppedAnimation<Color>(GameColors.leaf),
            ),
          ),
        ),
      );
    }

    final server = _server;
    if (server == null) {
      return Scaffold(
        backgroundColor: GameColors.night,
        body: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                'Imeshindikana kufungua mchezo.\nCould not start the game.',
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 8),
              Text(
                _error ?? 'unknown error',
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 12, color: GameColors.haze),
              ),
              const SizedBox(height: 20),
              FilledButton(onPressed: _start, child: const Text('Jaribu tena / Retry')),
            ],
          ),
        ),
      );
    }

    return GameScreen(gameUri: server.gameUri, onQuit: _quit);
  }
}
