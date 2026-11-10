import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tanuki_rush/local_database.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('test/local_database');
  const database = LocalDatabase(channel: channel);
  final messenger = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;

  tearDown(() => messenger.setMockMethodCallHandler(channel, null));

  test('bootstrap and writes forward the exact local data and revision', () async {
    final calls = <MethodCall>[];
    messenger.setMockMethodCallHandler(channel, (call) async {
      calls.add(call);
      return call.method == 'bootstrap'
          ? {'revision': 4, 'entries': {'tanuki_haptics': '0'}}
          : {'revision': 5};
    });
    final legacy = {
      'legacy': {'entries': {'tanuki_haptics': '0'}, 'valid': true},
      'pending': null,
    };
    final opened = await database.bootstrap(legacy);
    expect(opened, {'ok': true, 'revision': 4, 'entries': {'tanuki_haptics': '0'}});
    final batch = {'revision': 5, 'entries': {'tanuki_haptics': '1'}};
    expect(await database.write(batch), {'ok': true, 'revision': 5});
    expect(calls.map((call) => call.method), ['bootstrap', 'write']);
    expect(calls.first.arguments, legacy);
    expect(calls.last.arguments, batch);
  });

  test('missing or failed native responses do not turn into empty saves', () async {
    messenger.setMockMethodCallHandler(channel, (_) async => null);
    await expectLater(database.bootstrap({}), throwsFormatException);
    await expectLater(database.write(null), throwsFormatException);
    messenger.setMockMethodCallHandler(channel, (_) async {
      throw PlatformException(code: 'local_database_error');
    });
    await expectLater(database.bootstrap({}), throwsA(isA<PlatformException>()));
  });
}
