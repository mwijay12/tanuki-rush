import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:timezone/data/latest.dart' as tz;
import 'package:timezone/timezone.dart' as tz;

/// Local daily-streak reminder. No server, no account: the app schedules a
/// single notification ~20 hours out whenever a run starts, so if the player
/// goes quiet they get one nudge to keep the streak alive.
///
/// This is deliberately dependency-light and defensive — if the platform
/// denies permission or the plugin fails, the game carries on unaffected.
class NotificationService {
  NotificationService._();
  static final NotificationService instance = NotificationService._();

  final FlutterLocalNotificationsPlugin _plugin = FlutterLocalNotificationsPlugin();
  bool _ready = false;

  static const int _streakId = 1001;
  static const AndroidNotificationDetails _android = AndroidNotificationDetails(
    'streak',
    'Streak reminders',
    channelDescription: 'A daily nudge to keep your Tanuki Rush streak alive',
    importance: Importance.defaultImportance,
    priority: Priority.defaultPriority,
  );

  Future<void> _ensureInit() async {
    if (_ready) return;
    tz.initializeTimeZones();
    const init = InitializationSettings(
      android: AndroidInitializationSettings('@mipmap/ic_launcher'),
    );
    await _plugin.initialize(init);
    _ready = true;
  }

  /// Ask for POST_NOTIFICATIONS (Android 13+). Returns true if granted.
  Future<bool> requestPermission() async {
    try {
      await _ensureInit();
      final android = _plugin.resolvePlatformSpecificImplementation<
          AndroidFlutterLocalNotificationsPlugin>();
      final granted = await android?.requestNotificationsPermission();
      return granted ?? true;
    } catch (e) {
      debugPrint('[notif] permission request failed: $e');
      return false;
    }
  }

  /// (Re)schedule the single streak reminder for ~20 hours from now.
  Future<void> scheduleStreakReminder(int streak) async {
    try {
      await _ensureInit();
      await _plugin.cancel(_streakId);
      final when = tz.TZDateTime.now(tz.local).add(const Duration(hours: 20));
      final body = streak > 1
          ? 'Your $streak-day streak is waiting. One run keeps it alive!'
          : 'The hill is calling. Come back for a run!';
      await _plugin.zonedSchedule(
        _streakId,
        'Tanuki Rush',
        body,
        when,
        const NotificationDetails(android: _android),
        androidScheduleMode: AndroidScheduleMode.inexactAllowWhileIdle,
        matchDateTimeComponents: null,
      );
    } catch (e) {
      debugPrint('[notif] schedule failed: $e');
    }
  }
}
