// Standalone check for WebAssetServer — no Flutter, no pub dependencies.
//
//   dart run tool/verify_asset_server.dart
//
// Verifies the behaviour the WebView depends on: correct MIME types (Chromium
// will not execute a module served as text/plain), index fallback, path
// traversal rejection, HEAD handling and method rejection.
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import '../lib/web_asset_server.dart';

int _failures = 0;

void _check(String name, bool condition, [String detail = '']) {
  if (condition) {
    stdout.writeln('  ok    $name');
  } else {
    _failures++;
    stdout.writeln('  FAIL  $name ${detail.isEmpty ? '' : '($detail)'}');
  }
}

/// Sends the request line verbatim so the server sees exactly what an attacker
/// would send (no client-side URI normalisation).
Future<int> rawGet(WebAssetServer server, String target) async {
  final socket = await Socket.connect(server.host, server.port);
  try {
    socket.write('GET $target HTTP/1.1\r\n'
        'Host: ${server.host}\r\n'
        'Connection: close\r\n\r\n');
    await socket.flush();
    final buffer = <int>[];
    await socket.forEach(buffer.addAll);
    final firstLine = latin1.decode(buffer, allowInvalid: true).split('\r\n').first;
    return int.tryParse(firstLine.split(' ').elementAt(1)) ?? -1;
  } finally {
    socket.destroy();
  }
}

Future<void> main() async {
  final files = <String, String>{
    'assets/web/index.html': '<!doctype html><html><body>game</body></html>',
    'assets/web/assets/index-abc.js': 'export const x = 1;',
    'assets/web/assets/ui.css': 'body{margin:0}',
    'assets/web/fonts.css': '@font-face{src:url(./fonts/a.woff2)}',
    'assets/web/asset_index.json': '["assets/web/index.html"]',
  };
  final binary = Uint8List.fromList(List<int>.generate(256, (i) => i));
  files['assets/web/fonts/a.woff2'] = 'binary-placeholder';
  files['assets/web/hero.jpg'] = 'binary-placeholder';

  final server = WebAssetServer(
    assetKeys: files.keys.toList(),
    loadAsset: (key) async {
      if (key == 'assets/web/fonts/a.woff2' || key == 'assets/web/hero.jpg') {
        return binary;
      }
      final body = files[key];
      return body == null ? null : Uint8List.fromList(utf8.encode(body));
    },
  );
  await server.start();
  stdout.writeln('server on ${server.baseUri}');

  final client = HttpClient();

  Future<HttpClientResponse> send(String method, String path) async {
    final request = await client.openUrl(
      method,
      server.baseUri.resolve(path.replaceFirst('/', '')),
    );
    return request.close();
  }

  try {
    var response = await send('GET', '/');
    var body = await utf8.decodeStream(response);
    _check('GET / serves index.html', response.statusCode == 200 && body.contains('game'));
    _check(
      'GET / content-type is text/html',
      response.headers.contentType?.mimeType == 'text/html',
      '${response.headers.contentType}',
    );

    response = await send('GET', '/index.html');
    await response.drain<void>();
    _check('GET /index.html', response.statusCode == 200);

    response = await send('GET', '/assets/index-abc.js');
    await response.drain<void>();
    _check(
      'GET /assets/index-abc.js is javascript',
      response.headers.contentType?.mimeType == 'text/javascript',
      '${response.headers.contentType}',
    );

    response = await send('GET', '/fonts.css');
    await response.drain<void>();
    _check(
      "GET /fonts.css is text/css (was it './fonts.css'?)",
      response.headers.contentType?.mimeType == 'text/css',
      '${response.headers.contentType}',
    );

    response = await send('GET', '/fonts/a.woff2');
    final fontBytes = await response.fold<int>(0, (sum, chunk) => sum + chunk.length);
    _check(
      'GET /fonts/a.woff2 is font/woff2',
      response.headers.contentType?.mimeType == 'font/woff2',
      '${response.headers.contentType}',
    );
    _check('woff2 body length preserved', fontBytes == 256, '$fontBytes bytes');

    response = await send('GET', '/hero.jpg');
    await response.drain<void>();
    _check(
      'GET /hero.jpg is image/jpeg',
      response.headers.contentType?.mimeType == 'image/jpeg',
      '${response.headers.contentType}',
    );

    response = await send('GET', '/missing.js');
    await response.drain<void>();
    _check('unknown asset is 404', response.statusCode == 404, '${response.statusCode}');

    // Dart's HttpServer collapses dot segments while parsing the request line,
    // so over HTTP a traversal attempt simply becomes an unknown asset. Both
    // 404 and 403 are safe outcomes; serving the file would not be.
    final plainTraversal = await rawGet(server, '/../secret.txt');
    _check(
      'plain traversal never serves a file',
      plainTraversal == 403 || plainTraversal == 404,
      'got $plainTraversal',
    );

    final encodedTraversal = await rawGet(server, '/%2e%2e/secret.txt');
    _check(
      'encoded traversal never serves a file',
      encodedTraversal == 403 || encodedTraversal == 404 || encodedTraversal == 400,
      'got $encodedTraversal',
    );

    // The path mapper itself is where the guard lives, so assert on it directly.
    _check(
      'assetKeyFor("/") maps to index.html',
      server.assetKeyFor('/') == 'assets/web/index.html',
      '${server.assetKeyFor('/')}',
    );
    _check(
      'assetKeyFor rejects ".."',
      server.assetKeyFor('/../secret.txt') == null,
      '${server.assetKeyFor('/../secret.txt')}',
    );
    _check(
      'assetKeyFor rejects nested ".."',
      server.assetKeyFor('/assets/../../secret.txt') == null,
      '${server.assetKeyFor('/assets/../../secret.txt')}',
    );

    response = await send('HEAD', '/index.html');
    final headBody = await response.fold<int>(0, (sum, chunk) => sum + chunk.length);
    _check(
      'HEAD returns headers but no body',
      response.statusCode == 200 && headBody == 0,
      '${response.statusCode}, $headBody bytes',
    );

    response = await send('POST', '/index.html');
    await response.drain<void>();
    _check('POST is 405', response.statusCode == 405, '${response.statusCode}');

    // A second server must get a different port so two app instances cannot clash.
    final second = WebAssetServer(assetKeys: const [], loadAsset: (_) async => null);
    await second.start();
    _check('second instance binds a different port', second.port != server.port);
    await second.stop();
  } finally {
    client.close(force: true);
    await server.stop();
  }

  stdout.writeln('');
  if (_failures == 0) {
    stdout.writeln('ALL CHECKS PASSED');
  } else {
    stdout.writeln('$_failures CHECK(S) FAILED');
    exitCode = 1;
  }
}
