package com.tanukirush.tanuki_rush

/** What [MainActivity] should do after one watchdog poll. */
enum class WatchdogAction {
    /** Nothing has gone wrong yet (or the error is already on screen). */
    WAIT,

    /** Flutter has not painted a frame within the timeout: show the native error. */
    SHOW_ERROR,

    /** Flutter painted after the error was shown: take the error away. */
    CLEAR_ERROR,

    /** The watchdog is finished; stop polling. */
    STOP,
}

/**
 * Timing logic for the native boot watchdog.
 *
 * Why this exists: 1.0.5 gave every *Dart* startup wait a timeout, a visible
 * error and a retry button. That cannot help when the app hangs **before Dart
 * paints a single frame**, which is exactly what the 1.0.5 field report
 * (Pixel 8 Pro, Android 17) and the CI boot test on API 36/37 emulators show.
 * The Dart isolate never gets that far, so the only thing on screen is the
 * Android window background — an empty blue rectangle with a dead back button.
 *
 * The watchdog is therefore native: [MainActivity] polls Flutter's own
 * "is a frame on screen" flag and, if it stays false, draws a plain Android
 * view over the window with the device details and a retry button.
 *
 * This file has no Android imports on purpose, so the timing rules run in an
 * ordinary JVM unit test instead of needing Robolectric.
 */
class BootWatchdog(
    private val timeoutMs: Long = DEFAULT_TIMEOUT_MS,
    private val pollMs: Long = DEFAULT_POLL_MS,
) {
    companion object {
        /**
         * A cold start on a slow device includes engine init, the loopback asset
         * server and the first WebGL frame. 12 s is well past a normal start
         * (usually 1–3 s) and still short enough that the screen is not dead for
         * long.
         */
        const val DEFAULT_TIMEOUT_MS = 12_000L

        const val DEFAULT_POLL_MS = 500L

        const val LOG_TAG = "TanukiBoot"

        /**
         * Text shown over a window that never received a Flutter frame.
         *
         * The device block matters: the failure is OS-dependent, so a photo of
         * this screen is the field report the project needs.
         */
        fun diagnosticText(model: String, androidRelease: String, sdkInt: Int, waitedMs: Long): String {
            val seconds = (waitedMs / 1000L).coerceAtLeast(0L)
            return "Mchezo haukuanza. Bonyeza Jaribu tena.\n" +
                "The game did not start. Tap Retry.\n\n" +
                "Device: $model\n" +
                "Android: $androidRelease (API $sdkInt)\n" +
                "No first frame in ${seconds}s / hakuna fremu kwa ${seconds}s"
        }
    }

    private var startedAtMs = -1L
    private var errorVisible = false

    /** True while the watchdog is still polling. */
    val isRunning: Boolean
        get() = startedAtMs >= 0L

    /** Must be called once, when the activity has attached its Flutter engine. */
    fun start(nowMs: Long) {
        startedAtMs = nowMs
        errorVisible = false
    }

    /** How long the app has been waiting for its first frame. */
    fun waitedMs(nowMs: Long): Long {
        val started = startedAtMs
        if (started < 0L) return 0L
        return (nowMs - started).coerceAtLeast(0L)
    }

    /**
     * Called every [pollMs] with Flutter's `isDisplayingFlutterUi` value.
     *
     * Deliberately never gives up on its own: a poll is one boolean read, and
     * staying armed is what guarantees a late first frame still removes the
     * error view instead of trapping a working game behind it.
     */
    fun onPoll(nowMs: Long, uiVisible: Boolean): WatchdogAction {
        val started = startedAtMs
        if (started < 0L) return WatchdogAction.STOP
        if (uiVisible) {
            startedAtMs = -1L
            val wasVisible = errorVisible
            errorVisible = false
            return if (wasVisible) WatchdogAction.CLEAR_ERROR else WatchdogAction.STOP
        }
        if (!errorVisible && nowMs - started >= timeoutMs) {
            errorVisible = true
            return WatchdogAction.SHOW_ERROR
        }
        return WatchdogAction.WAIT
    }

    /** Next poll delay, exposed so the activity and the defaults cannot drift. */
    fun pollDelayMs(): Long = pollMs
}
