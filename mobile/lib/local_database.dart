import 'package:flutter/services.dart';

/// Narrow bridge to Android's private SQLite database. The WebView never gets
/// raw SQL or filesystem access, only validated game-save operations.
class LocalDatabase {
  const LocalDatabase({MethodChannel? channel})
      : _channel = channel ?? const MethodChannel('tanuki_rush/local_database');

  final MethodChannel _channel;

  Future<Map<String, dynamic>> bootstrap(Object? arguments) =>
      _invoke('bootstrap', arguments);

  Future<Map<String, dynamic>> write(Object? arguments) =>
      _invoke('write', arguments);

  Future<Map<String, dynamic>> _invoke(String method, Object? arguments) async {
    if (arguments is! Map) {
      throw const FormatException('Invalid local database request');
    }
    final result = await _channel.invokeMapMethod<String, dynamic>(method, arguments);
    if (result == null) throw const FormatException('Empty local database response');
    // The Kotlin side validates both inputs and returned data. Do not silently
    // substitute an empty database if the platform channel is missing or fails.
    return {...result, 'ok': true};
  }
}
