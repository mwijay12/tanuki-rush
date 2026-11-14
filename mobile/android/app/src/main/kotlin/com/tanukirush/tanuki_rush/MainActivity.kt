package com.tanukirush.tanuki_rush

import android.graphics.Color
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.util.concurrent.Executors

class MainActivity : FlutterActivity() {
    private val database = lazy { LocalGameDatabase(applicationContext) }
    // Database work is ordered and kept off Android's UI/rendering thread.
    private val databaseExecutor = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())
    private var databaseChannel: MethodChannel? = null

    // Boot watchdog: the app has hung *before Dart painted a frame* on Android
    // 17 devices, where no Dart-side timeout or error UI can ever run. These
    // fields let the native side notice and say so out loud.
    private var engine: FlutterEngine? = null
    private val watchdog = BootWatchdog()
    private var watchdogPoll: Runnable? = null
    private var bootErrorView: View? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        engine = flutterEngine
        databaseChannel = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "tanuki_rush/local_database")
        databaseChannel?.setMethodCallHandler { call, result ->
            if (call.method != "bootstrap" && call.method != "write") {
                result.notImplemented()
                return@setMethodCallHandler
            }
            databaseExecutor.execute {
                try {
                    val args = call.arguments as? Map<*, *> ?: throw IllegalArgumentException("Missing arguments")
                    val response = when (call.method) {
                        "bootstrap" -> {
                            val legacy = args["legacy"] as? Map<*, *> ?: throw IllegalArgumentException("Missing legacy data")
                            val valid = legacy["valid"] as? Boolean ?: throw IllegalArgumentException("Missing legacy validation")
                            val pending = args["pending"]?.let(::parseJournal)
                            val snapshot = database.value.bootstrap(stringMap(legacy["entries"]), valid, pending)
                            mapOf("revision" to snapshot.revision, "entries" to snapshot.entries)
                        }
                        else -> mapOf("revision" to database.value.write(parseJournal(args)))
                    }
                    mainHandler.post { result.success(response) }
                } catch (error: Exception) {
                    // Do not leak save contents into logs or to the WebView.
                    Log.e("TanukiStorage", "Local database operation failed: ${error.javaClass.simpleName}")
                    mainHandler.post { result.error("local_database_error", "Local database operation failed", null) }
                }
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // super.onCreate() has already attached the engine, so the renderer's
        // "is a frame on screen" flag is available from here.
        startBootWatchdog()
    }

    override fun cleanUpFlutterEngine(flutterEngine: FlutterEngine) {
        databaseChannel?.setMethodCallHandler(null)
        databaseChannel = null
        engine = null
        super.cleanUpFlutterEngine(flutterEngine)
    }

    override fun onDestroy() {
        watchdogPoll?.let(mainHandler::removeCallbacks)
        watchdogPoll = null
        // Finish queued transactions before closing the helper; the WebView's
        // pending journal is replayed on the next start if it never got an ack.
        databaseExecutor.execute { if (database.isInitialized()) database.value.close() }
        databaseExecutor.shutdown()
        super.onDestroy()
    }

    // ---------------------------------------------------------------------
    // Boot watchdog
    // ---------------------------------------------------------------------

    /**
     * Polls Flutter's own first-frame flag on the Android UI thread. When the
     * flag never becomes true, a plain Android view (no Flutter, no resources
     * beyond this file) covers the empty window background so the user gets an
     * explanation, the device details and a retry instead of a dead blue screen.
     *
     * It also writes a `native-watchdog` line to logcat, which is what tells the
     * CI boot test apart from a crashed or never-started process.
     */
    private fun startBootWatchdog() {
        val renderer = engine?.renderer
        if (renderer == null) {
            Log.w(BootWatchdog.LOG_TAG, "native-watchdog: no Flutter engine, nothing to watch")
            return
        }
        Log.i(BootWatchdog.LOG_TAG, "native-watchdog: armed")
        watchdog.start(SystemClock.uptimeMillis())
        val poll = object : Runnable {
            override fun run() {
                val displayingUi = try {
                    renderer.isDisplayingFlutterUi()
                } catch (error: RuntimeException) {
                    Log.w(BootWatchdog.LOG_TAG, "native-watchdog: stopped (${error.javaClass.simpleName})")
                    watchdogPoll = null
                    return
                }
                val now = SystemClock.uptimeMillis()
                when (watchdog.onPoll(now, displayingUi)) {
                    WatchdogAction.SHOW_ERROR -> {
                        Log.e(
                            BootWatchdog.LOG_TAG,
                            "native-watchdog: no first frame after ${watchdog.waitedMs(now)}ms on " +
                                "${Build.MODEL} / Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})",
                        )
                        showBootError(now)
                    }
                    WatchdogAction.CLEAR_ERROR -> {
                        Log.i(BootWatchdog.LOG_TAG, "native-watchdog: first frame arrived, clearing the error")
                        hideBootError()
                    }
                    WatchdogAction.STOP -> {
                        Log.i(BootWatchdog.LOG_TAG, "native-watchdog: first frame painted")
                        hideBootError()
                        watchdogPoll = null
                        return
                    }
                    WatchdogAction.WAIT -> Unit
                }
                mainHandler.postDelayed(this, watchdog.pollDelayMs())
            }
        }
        watchdogPoll = poll
        mainHandler.postDelayed(poll, watchdog.pollDelayMs())
    }

    private fun showBootError(nowMs: Long) {
        if (bootErrorView != null) return
        val content = findViewById<ViewGroup>(android.R.id.content)
        val view = buildBootErrorView(nowMs)
        // Added as a sibling of the FlutterView, never a replacement: if Flutter
        // does paint later the overlay is removed and nothing was destroyed.
        content.addView(
            view,
            ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            ),
        )
        bootErrorView = view
    }

    private fun hideBootError() {
        val view = bootErrorView ?: return
        bootErrorView = null
        (view.parent as? ViewGroup)?.removeView(view)
    }

    private fun buildBootErrorView(nowMs: Long): View {
        val details = BootWatchdog.diagnosticText(
            model = Build.MODEL ?: "unknown",
            androidRelease = Build.VERSION.RELEASE ?: "unknown",
            sdkInt = Build.VERSION.SDK_INT,
            waitedMs = watchdog.waitedMs(nowMs),
        )

        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            // fillViewport stretches this column to the screen, so CENTER keeps
            // the text and buttons in the middle of a landscape phone.
            gravity = Gravity.CENTER
            setPadding(dp(32), dp(20), dp(32), dp(20))
        }

        val title = TextView(this).apply {
            text = "TANUKI RUSH"
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
            setTypeface(typeface, Typeface.BOLD)
            letterSpacing = 0.2f
            gravity = Gravity.CENTER
        }

        val heading = TextView(this).apply {
            text = "Mchezo haukufunguka / Could not start the game"
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
            setTypeface(typeface, Typeface.BOLD)
            gravity = Gravity.CENTER
        }

        val message = TextView(this).apply {
            text = details
            setTextColor(HAZE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            setLineSpacing(0f, 1.35f)
            gravity = Gravity.CENTER
        }

        val retry = Button(this).apply {
            text = "Jaribu tena / Retry"
            setOnClickListener {
                hideBootError()
                recreate()
            }
        }

        val close = Button(this).apply {
            text = "Funga / Close"
            setOnClickListener { finishAndRemoveTask() }
        }

        addCentered(column, title, 0)
        addCentered(column, heading, 20)
        addCentered(column, message, 14)
        addCentered(column, retry, 24)
        addCentered(column, close, 10)

        return ScrollView(this).apply {
            setBackgroundColor(NIGHT)
            isFillViewport = true
            addView(
                column,
                ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                ),
            )
        }
    }

    private fun addCentered(parent: LinearLayout, child: View, topDp: Int) {
        parent.addView(
            child,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT,
            ).apply {
                topMargin = dp(topDp)
                gravity = Gravity.CENTER_HORIZONTAL
            },
        )
    }

    private fun dp(value: Int): Int =
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), resources.displayMetrics).toInt()

    // ---------------------------------------------------------------------
    // Local save database bridge
    // ---------------------------------------------------------------------

    private fun parseJournal(value: Any?): LocalGameDatabase.Journal {
        val map = value as? Map<*, *> ?: throw IllegalArgumentException("Invalid journal")
        val revision = map["revision"] as? Number ?: throw IllegalArgumentException("Missing revision")
        val longRevision = revision.toLong()
        require(revision.toDouble() == longRevision.toDouble()) { "Invalid revision" }
        return LocalGameDatabase.Journal(longRevision, stringMap(map["entries"]))
    }

    private fun stringMap(value: Any?): Map<String, String> {
        val input = value as? Map<*, *> ?: throw IllegalArgumentException("Invalid entries")
        val output = linkedMapOf<String, String>()
        for ((key, item) in input) {
            require(key is String && item is String) { "Invalid save entry" }
            output[key] = item
        }
        return output
    }

    private companion object {
        /** Mirrors GameColors in app_theme.dart so the overlay matches the app. */
        val NIGHT: Int = Color.parseColor("#0A1A44")
        val HAZE: Int = Color.parseColor("#9FB0D0")
    }
}
