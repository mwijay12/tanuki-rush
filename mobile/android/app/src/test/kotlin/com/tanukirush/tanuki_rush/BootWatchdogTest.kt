package com.tanukirush.tanuki_rush

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Plain JVM test: the watchdog's timing rules must not need Robolectric, because
 * the failure they cover is a real device hanging before Flutter paints.
 */
class BootWatchdogTest {
    private val timeout = 12_000L
    private val watchdog = BootWatchdog(timeoutMs = timeout, pollMs = 500L)

    @Test
    fun stopsBeforeItIsStarted() {
        assertEquals(WatchdogAction.STOP, watchdog.onPoll(1_000L, uiVisible = false))
        assertFalse(watchdog.isRunning)
    }

    @Test
    fun waitsSilentlyUntilTheTimeoutElapses() {
        watchdog.start(0L)
        assertTrue(watchdog.isRunning)
        assertEquals(WatchdogAction.WAIT, watchdog.onPoll(500L, uiVisible = false))
        assertEquals(WatchdogAction.WAIT, watchdog.onPoll(timeout - 1L, uiVisible = false))
        assertEquals(WatchdogAction.SHOW_ERROR, watchdog.onPoll(timeout, uiVisible = false))
        assertEquals(timeout, watchdog.waitedMs(timeout))
    }

    @Test
    fun aPaintedFirstFrameStopsTheWatchdogWithoutAnError() {
        watchdog.start(0L)
        assertEquals(WatchdogAction.WAIT, watchdog.onPoll(1_000L, uiVisible = false))
        assertEquals(WatchdogAction.STOP, watchdog.onPoll(1_500L, uiVisible = true))
        assertFalse(watchdog.isRunning)
    }

    @Test
    fun theErrorIsShownOnceAndNeverRepeatsWhileStillStuck() {
        watchdog.start(0L)
        assertEquals(WatchdogAction.SHOW_ERROR, watchdog.onPoll(timeout, uiVisible = false))
        assertEquals(WatchdogAction.WAIT, watchdog.onPoll(timeout + 500L, uiVisible = false))
        assertEquals(WatchdogAction.WAIT, watchdog.onPoll(timeout + 60_000L, uiVisible = false))
    }

    @Test
    fun aLateFirstFrameClearsTheErrorInsteadOfTrappingTheGame() {
        watchdog.start(0L)
        assertEquals(WatchdogAction.SHOW_ERROR, watchdog.onPoll(timeout, uiVisible = false))
        // A very slow device paints 40 s in: the overlay must go away.
        assertEquals(WatchdogAction.CLEAR_ERROR, watchdog.onPoll(40_000L, uiVisible = true))
        assertFalse(watchdog.isRunning)
        assertEquals(WatchdogAction.STOP, watchdog.onPoll(40_500L, uiVisible = true))
    }

    @Test
    fun restartReArmsAfterAClear() {
        watchdog.start(0L)
        assertEquals(WatchdogAction.SHOW_ERROR, watchdog.onPoll(timeout, uiVisible = false))
        assertEquals(WatchdogAction.CLEAR_ERROR, watchdog.onPoll(timeout + 1L, uiVisible = true))
        watchdog.start(50_000L)
        assertTrue(watchdog.isRunning)
        assertEquals(0L, watchdog.waitedMs(50_000L))
        assertEquals(WatchdogAction.WAIT, watchdog.onPoll(50_000L + timeout - 1L, uiVisible = false))
        assertEquals(WatchdogAction.SHOW_ERROR, watchdog.onPoll(50_000L + timeout, uiVisible = false))
    }

    @Test
    fun theDiagnosticNamesTheDeviceAndTheWait() {
        val text = BootWatchdog.diagnosticText(
            model = "Pixel 8 Pro",
            androidRelease = "17",
            sdkInt = 36,
            waitedMs = 12_345L,
        )
        assertTrue(text.contains("Pixel 8 Pro"))
        assertTrue(text.contains("Android: 17 (API 36)"))
        assertTrue(text.contains("12s"))
        // Both languages, because the shipped UI is bilingual.
        assertTrue(text.contains("Jaribu tena"))
        assertTrue(text.contains("Retry"))
    }

    @Test
    fun aNegativeClockJumpCannotReportANegativeWait() {
        watchdog.start(10_000L)
        assertEquals(0L, watchdog.waitedMs(5_000L))
        assertEquals(WatchdogAction.WAIT, watchdog.onPoll(5_000L, uiVisible = false))
    }

    @Test
    fun pollDelayMatchesTheConfiguredValue() {
        assertEquals(500L, watchdog.pollDelayMs())
        assertEquals(250L, BootWatchdog(pollMs = 250L).pollDelayMs())
    }
}
