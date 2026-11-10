import 'package:flutter/foundation.dart' show ValueListenable;
import 'package:flutter/material.dart';

import 'app_theme.dart';

String localStorageStatusText(String status) => switch (status) {
      'saved' => 'Imehifadhiwa kwenye simu / Saved on this device',
      'saving' => 'Inahifadhi... / Saving on this device...',
      'error' => 'Baadhi ya mabadiliko hayajahifadhiwa / Some changes are not saved',
      _ => 'Inafungua hifadhi... / Opening device storage...',
    };

/// A persistent native warning, shown only when a write has failed.
class LocalStorageWarning extends StatelessWidget {
  const LocalStorageWarning({super.key, required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => SafeArea(
        child: Align(
          alignment: Alignment.topCenter,
          child: Padding(
            padding: const EdgeInsets.all(8),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 610),
              child: Material(
                color: const Color(0xff6b2020),
                elevation: 6,
                borderRadius: BorderRadius.circular(12),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.error_outline, color: Colors.white, size: 22),
                      const SizedBox(width: 10),
                      const Expanded(
                        child: Text(
                          'Hifadhi imeshindikana / Save failed. Progress may be lost.',
                          style: TextStyle(color: Colors.white, fontSize: 12),
                        ),
                      ),
                      TextButton(
                        onPressed: onRetry,
                        child: const Text('RETRY', style: TextStyle(color: Colors.white)),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      );
}

/// A genuinely native status surface; it does not expose or delete save data.
Future<void> showLocalStorageDetails(
  BuildContext context, {
  required ValueListenable<String> status,
  required VoidCallback onRetry,
}) =>
    showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Hifadhi ya simu / Device storage'),
        content: SizedBox(
          width: 390,
          child: SingleChildScrollView(
            child: ValueListenableBuilder<String>(
              valueListenable: status,
              builder: (_, value, __) => Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(localStorageStatusText(value),
                      style: const TextStyle(fontWeight: FontWeight.w700, color: GameColors.leaf)),
                  const SizedBox(height: 12),
                  const Text(
                    'Maendeleo yanahifadhiwa kwenye SQLite ya simu hii, bila intaneti.\n\n'
                    'Progress is stored in this device’s offline SQLite database. '
                    'There is no account or cloud sync. Uninstalling the app can erase the save.',
                  ),
                ],
              ),
            ),
          ),
        ),
        actions: [
          ValueListenableBuilder<String>(
            valueListenable: status,
            builder: (_, value, __) => value == 'error'
                ? TextButton(onPressed: onRetry, child: const Text('RETRY'))
                : const SizedBox.shrink(),
          ),
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Funga / Close'),
          ),
        ],
      ),
    );

/// Do not silently quit while progress is still being written or has failed.
Future<bool> confirmExitWithUnsavedChanges(BuildContext context, {required VoidCallback onRetry}) async {
  return await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: const Text('Hifadhi haijakamilika / Save not complete'),
          content: const Text('Mabadiliko ya mwisho yanaweza kupotea.\nRecent progress may be lost if you exit now.'),
          actions: [
            TextButton(
              onPressed: () {
                Navigator.of(dialogContext).pop(false);
                onRetry();
              },
              child: const Text('Kaa na ujaribu tena / Stay and retry'),
            ),
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(true),
              child: const Text('Toka / Exit anyway'),
            ),
          ],
        ),
      ) ??
      false;
}
