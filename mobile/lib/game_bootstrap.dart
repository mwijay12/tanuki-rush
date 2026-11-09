import 'dart:convert';

import 'package:flutter/services.dart';

import 'web_asset_server.dart';

/// Directory (inside the Flutter asset bundle) that holds the compiled game.
const String webAssetDir = 'assets/web/';

/// Part of the WebView origin. Do not change after shipping: localStorage
/// (records, settings, missions and purchases) is scoped to this exact port.
const int gameStoragePort = 43853;

/// Boots the loopback HTTP server that serves the compiled web build.
///
/// The asset list is produced at build time (`asset_index.json`) instead of
/// relying on Flutter's internal `AssetManifest`, which is an implementation
/// detail and changed format between Flutter versions.
Future<WebAssetServer> startGameServer() async {
  final rawIndex = await rootBundle.loadString('${webAssetDir}asset_index.json');
  final keys = (json.decode(rawIndex) as List<dynamic>).cast<String>();
  final known = keys.toSet();

  final server = WebAssetServer(
    listenPort: gameStoragePort,
    assetKeys: keys,
    loadAsset: (key) async {
      if (!known.contains(key)) return null;
      final data = await rootBundle.load(key);
      return data.buffer.asUint8List(data.offsetInBytes, data.lengthInBytes);
    },
  );

  await server.start();
  return server;
}
