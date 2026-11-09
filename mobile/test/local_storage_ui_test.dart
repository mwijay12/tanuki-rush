import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tanuki_rush/local_storage_ui.dart';

void useSmallLandscape(WidgetTester tester) {
  tester.view.physicalSize = const Size(640, 360);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

void main() {
  testWidgets('native warning exposes retry on a small landscape screen', (tester) async {
    useSmallLandscape(tester);
    var retries = 0;
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(body: LocalStorageWarning(onRetry: () => retries++)),
    ));
    expect(find.textContaining('Save failed'), findsOneWidget);
    await tester.tap(find.text('RETRY'));
    expect(retries, 1);
    expect(tester.takeException(), isNull);
  });

  testWidgets('device storage dialog updates live and can retry', (tester) async {
    useSmallLandscape(tester);
    final status = ValueNotifier('saved');
    addTearDown(status.dispose);
    var retries = 0;
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(body: Builder(builder: (context) => ElevatedButton(
        onPressed: () => showLocalStorageDetails(context, status: status, onRetry: () => retries++),
        child: const Text('Open'),
      ))),
    ));
    await tester.tap(find.text('Open'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Saved on this device'), findsOneWidget);
    expect(find.textContaining('offline SQLite database'), findsOneWidget);
    status.value = 'error';
    await tester.pumpAndSettle();
    expect(find.textContaining('Some changes are not saved'), findsOneWidget);
    await tester.tap(find.text('RETRY'));
    expect(retries, 1);
    await tester.tap(find.text('Funga / Close'));
    await tester.pumpAndSettle();
    expect(find.text('Hifadhi ya simu / Device storage'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('unsaved-exit dialog lets the player stay and retry', (tester) async {
    useSmallLandscape(tester);
    var retries = 0;
    bool? exited;
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(body: Builder(builder: (context) => ElevatedButton(
        onPressed: () async {
          exited = await confirmExitWithUnsavedChanges(context, onRetry: () => retries++);
        },
        child: const Text('Quit'),
      ))),
    ));
    await tester.tap(find.text('Quit'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Kaa na ujaribu tena / Stay and retry'));
    await tester.pumpAndSettle();
    expect(exited, false);
    expect(retries, 1);
    expect(tester.takeException(), isNull);
  });
}
