import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'app_theme.dart';
import 'game_bootstrap.dart';
import 'game_screen.dart';
import 'web_asset_server.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // A downhill runner is played in landscape; locking it also avoids a
  // rebuild of the WebGL canvas during rotation mid-run.
  await SystemChrome.setPreferredOrientations(const [
    DeviceOrientation.landscapeLeft,
    DeviceOrientation.landscapeRight,
  ]);
  await SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);

  runApp(const TanukiRushApp());
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
      final server = await startGameServer();
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
