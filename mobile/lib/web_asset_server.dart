import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

/// Reads a bundled asset by its Flutter asset key (e.g. `assets/web/index.html`).
/// Returns `null` when the key does not exist.
typedef WebAssetLoader = Future<Uint8List?> Function(String assetKey);

/// A tiny read-only HTTP server that serves the bundled web build to the
/// in-app WebView over `http://127.0.0.1:<port>/`.
///
/// Why not `file://`?
///   * Vite emits ES modules (`<script type="module">`) plus code-split chunks.
///     Chromium refuses to load module scripts from an opaque `file://` origin.
///   * `localStorage` (used for best times / records) is unreliable or blocked
///     on `file://`, but works normally on a loopback HTTP origin.
///
/// Binding to port 0 lets the OS pick a free ephemeral port, so two instances
/// (or a second app) never collide.
class WebAssetServer {
  WebAssetServer({
    required this.loadAsset,
    required this.assetKeys,
    this.assetPrefix = defaultAssetPrefix,
    this.host = '127.0.0.1',
    this.cacheControl = 'public, max-age=3600',
  }) : _knownKeys = assetKeys.toSet();

  static const String defaultAssetPrefix = 'assets/web/';

  final WebAssetLoader loadAsset;

  /// Every asset key under [assetPrefix]; used to reject unknown paths cheaply.
  final List<String> assetKeys;
  final Set<String> _knownKeys;
  final String assetPrefix;
  final String host;
  final String cacheControl;

  HttpServer? _server;
  StreamSubscription<HttpRequest>? _subscription;

  bool get isRunning => _server != null;

  int get port => _server?.port ?? 0;

  /// `http://127.0.0.1:<port>/` — only valid after [start].
  Uri get baseUri => Uri.parse('http://$host:$port/');

  /// Absolute URL of the game entry point — only valid after [start].
  Uri get gameUri => baseUri.resolve('index.html');

  Future<void> start() async {
    if (_server != null) return;
    final server = await HttpServer.bind(host, 0, shared: false);
    server.autoCompress = true;
    _server = server;
    _subscription = server.listen(
      _handle,
      onError: (Object error) {
        // A broken client connection must never take the server down.
        stderr.writeln('[web-asset-server] listener error: $error');
      },
      cancelOnError: false,
    );
  }

  Future<void> stop() async {
    await _subscription?.cancel();
    _subscription = null;
    final server = _server;
    _server = null;
    await server?.close(force: true);
  }

  Future<void> _handle(HttpRequest request) async {
    final response = request.response;
    try {
      if (request.method != 'GET' && request.method != 'HEAD') {
        response.statusCode = HttpStatus.methodNotAllowed;
        response.headers.set(HttpHeaders.allowHeader, 'GET, HEAD');
        await response.close();
        return;
      }

      final key = assetKeyFor(request.uri.path);
      if (key == null) {
        response.statusCode = HttpStatus.forbidden;
        await response.close();
        return;
      }

      final bytes = _knownKeys.contains(key) ? await loadAsset(key) : null;
      if (bytes == null) {
        response.statusCode = HttpStatus.notFound;
        response.headers.contentType =
            ContentType('text', 'plain', charset: 'utf-8');
        response.write('404 Not Found: ${request.uri.path}');
        await response.close();
        return;
      }

      response.statusCode = HttpStatus.ok;
      response.headers.contentType = contentTypeFor(key);
      response.headers.set(HttpHeaders.cacheControlHeader, cacheControl);
      response.headers.set('X-Content-Type-Options', 'nosniff');
      response.headers.contentLength = bytes.length;
      if (request.method == 'HEAD') {
        await response.close();
        return;
      }
      response.add(bytes);
      await response.close();
    } catch (error) {
      stderr.writeln('[web-asset-server] failed on ${request.uri.path}: $error');
      try {
        response.statusCode = HttpStatus.internalServerError;
        await response.close();
      } catch (_) {
        // Response already closed — nothing left to do.
      }
    }
  }

  /// Maps a URL path onto a Flutter asset key, or `null` for traversal attempts.
  ///
  /// `/` resolves to `index.html`; `..` segments are rejected rather than
  /// normalised, so nothing can escape [assetPrefix].
  ///
  /// Note: Dart's [HttpServer] already collapses dot segments while parsing the
  /// request line, so in practice this guard is defence in depth — the HTTP
  /// path is covered by the direct unit check in `tool/verify_asset_server.dart`.
  String? assetKeyFor(String rawPath) {
    final segments = <String>[];
    for (final segment in rawPath.split('/')) {
      if (segment.isEmpty || segment == '.') continue;
      if (segment == '..') return null;
      segments.add(segment);
    }
    if (segments.isEmpty) segments.add('index.html');
    return '$assetPrefix${segments.join('/')}';
  }
}

const Map<String, String> _mimeTypes = <String, String>{
  'html': 'text/html; charset=utf-8',
  'htm': 'text/html; charset=utf-8',
  'js': 'text/javascript; charset=utf-8',
  'mjs': 'text/javascript; charset=utf-8',
  'css': 'text/css; charset=utf-8',
  'json': 'application/json; charset=utf-8',
  'map': 'application/json; charset=utf-8',
  'svg': 'image/svg+xml',
  'png': 'image/png',
  'jpg': 'image/jpeg',
  'jpeg': 'image/jpeg',
  'webp': 'image/webp',
  'gif': 'image/gif',
  'ico': 'image/x-icon',
  'woff': 'font/woff',
  'woff2': 'font/woff2',
  'ttf': 'font/ttf',
  'otf': 'font/otf',
  'mp3': 'audio/mpeg',
  'ogg': 'audio/ogg',
  'wav': 'audio/wav',
  'webm': 'video/webm',
  'wasm': 'application/wasm',
  'txt': 'text/plain; charset=utf-8',
};

/// Correct `Content-Type` matters more than it looks: Chromium refuses to
/// execute a module script served as `text/plain`, and rejects a stylesheet
/// served with the wrong type.
ContentType contentTypeFor(String path) {
  final dot = path.lastIndexOf('.');
  final extension = dot == -1 ? '' : path.substring(dot + 1).toLowerCase();
  final mime = _mimeTypes[extension] ?? 'application/octet-stream';
  final parts = mime.split(';');
  final type = parts.first.split('/');
  final parameters = <String, String>{};
  for (final part in parts.skip(1)) {
    final trimmed = part.trim();
    final eq = trimmed.indexOf('=');
    if (eq > 0) parameters[trimmed.substring(0, eq)] = trimmed.substring(eq + 1);
  }
  return ContentType(type.first, type.length > 1 ? type[1] : 'octet-stream', charset: parameters['charset']);
}
