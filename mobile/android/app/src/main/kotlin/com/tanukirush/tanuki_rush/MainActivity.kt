package com.tanukirush.tanuki_rush

import android.os.Handler
import android.os.Looper
import android.util.Log
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

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
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

    override fun cleanUpFlutterEngine(flutterEngine: FlutterEngine) {
        databaseChannel?.setMethodCallHandler(null)
        databaseChannel = null
        super.cleanUpFlutterEngine(flutterEngine)
    }

    override fun onDestroy() {
        // Finish queued transactions before closing the helper; the WebView's
        // pending journal is replayed on the next start if it never got an ack.
        databaseExecutor.execute { if (database.isInitialized()) database.value.close() }
        databaseExecutor.shutdown()
        super.onDestroy()
    }

    private fun parseJournal(value: Any?): LocalGameDatabase.Journal {
        val map = value as? Map<*, *> ?: throw IllegalArgumentException("Invalid journal")
        val revision = map["revision"] as? Number ?: throw IllegalArgumentException("Invalid revision")
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
}
