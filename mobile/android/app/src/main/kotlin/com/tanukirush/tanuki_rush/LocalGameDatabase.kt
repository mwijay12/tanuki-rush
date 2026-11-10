package com.tanukirush.tanuki_rush

import android.content.ContentValues
import android.content.Context
import android.database.DatabaseErrorHandler
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.util.Log
import org.json.JSONObject
import org.json.JSONTokener

/** Private, offline Android storage. No network or third-party database SDK. */
class LocalGameDatabase(context: Context, name: String = DATABASE_NAME) :
    SQLiteOpenHelper(context.applicationContext, name, null, SCHEMA_VERSION, DatabaseErrorHandler { _ ->
        // Android's default corruption handler deletes the DB. Preserve the
        // file for diagnosis/recovery and fail startup instead of resetting it.
        Log.e("TanukiStorage", "Database corruption detected; keeping the original file")
    }) {

    data class Journal(val revision: Long, val entries: Map<String, String>)
    data class Snapshot(val revision: Long, val entries: Map<String, String>)

    companion object {
        const val DATABASE_NAME = "tanuki_rush.db"
        const val SCHEMA_VERSION = 1
        private const val MAX_SAFE_REVISION = 9007199254740991L // JavaScript Number.MAX_SAFE_INTEGER
        private const val PROGRESS_KEY = "tanuki-rush-v1"
        private const val MAX_PROGRESS_BYTES = 1024 * 1024
        private const val MAX_SETTING_BYTES = 4096
        private val allowedKeys = setOf(PROGRESS_KEY, "tanuki_steerDiv", "tanuki_haptics", "tanuki_intro")
    }

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE game_data (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)")
        db.execSQL("CREATE TABLE metadata (key TEXT PRIMARY KEY NOT NULL, value INTEGER NOT NULL)")
        db.execSQL("INSERT INTO metadata (key, value) VALUES ('legacy_migrated', 0), ('revision', 0)")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        // Never silently drop saves. Future schema changes must add explicit,
        // tested, transactional migrations here before increasing the version.
        throw IllegalStateException("No local database migration from $oldVersion to $newVersion")
    }

    /** Migrate old WebView data only once, then replay any pending journal. */
    fun bootstrap(legacy: Map<String, String>, legacyValid: Boolean, pending: Journal?): Snapshot {
        val db = writableDatabase
        db.beginTransaction()
        try {
            if (metadata(db, "legacy_migrated") == 0L) {
                require(legacyValid) { "Legacy progress cannot be migrated safely" }
                validateEntries(legacy, allowEmpty = true)
                // Existing SQLite rows win if a future migration left any in place.
                for ((key, value) in legacy) put(db, key, value, SQLiteDatabase.CONFLICT_IGNORE)
                setMetadata(db, "legacy_migrated", 1)
            }
            if (pending != null) applyJournal(db, pending)
            val snapshot = snapshot(db)
            db.setTransactionSuccessful()
            return snapshot
        } finally {
            db.endTransaction()
        }
    }

    /** A committed revision never moves backwards, even after a delayed retry. */
    fun write(journal: Journal): Long {
        val db = writableDatabase
        db.beginTransaction()
        try {
            check(metadata(db, "legacy_migrated") == 1L) { "Database has not been initialized" }
            applyJournal(db, journal)
            val revision = metadata(db, "revision")
            db.setTransactionSuccessful()
            return revision
        } finally {
            db.endTransaction()
        }
    }

    private fun applyJournal(db: SQLiteDatabase, journal: Journal) {
        require(journal.revision in 1..MAX_SAFE_REVISION) { "Invalid local save revision" }
        validateEntries(journal.entries, allowEmpty = false)
        if (journal.revision <= metadata(db, "revision")) return // already applied or stale
        for ((key, value) in journal.entries) put(db, key, value, SQLiteDatabase.CONFLICT_REPLACE)
        setMetadata(db, "revision", journal.revision)
    }

    private fun validateEntries(entries: Map<String, String>, allowEmpty: Boolean) {
        require(allowEmpty || entries.isNotEmpty()) { "Empty save batch" }
        for ((key, value) in entries) {
            require(key in allowedKeys) { "Unknown local save key" }
            val limit = if (key == PROGRESS_KEY) MAX_PROGRESS_BYTES else MAX_SETTING_BYTES
            require(value.toByteArray(Charsets.UTF_8).size <= limit) { "Local save is too large" }
            if (key == PROGRESS_KEY) {
                val parser = JSONTokener(value)
                require(parser.nextValue() is JSONObject && parser.nextClean() == '\u0000') {
                    "Progress must be a JSON object"
                }
            }
        }
    }

    private fun snapshot(db: SQLiteDatabase): Snapshot {
        val entries = linkedMapOf<String, String>()
        db.rawQuery("SELECT key, value FROM game_data ORDER BY key", null).use { cursor ->
            while (cursor.moveToNext()) entries[cursor.getString(0)] = cursor.getString(1)
        }
        validateEntries(entries, allowEmpty = true)
        val revision = metadata(db, "revision")
        check(revision in 0..MAX_SAFE_REVISION) { "Invalid database revision" }
        return Snapshot(revision, entries)
    }

    private fun put(db: SQLiteDatabase, key: String, value: String, conflict: Int) {
        if (conflict == SQLiteDatabase.CONFLICT_IGNORE) {
            db.rawQuery("SELECT 1 FROM game_data WHERE key = ?", arrayOf(key)).use { cursor ->
                if (cursor.moveToFirst()) return
            }
        }
        val row = ContentValues().apply { put("key", key); put("value", value) }
        // Do not confuse a failed insert (e.g. disk full) with an ignored row.
        val result = db.insertWithOnConflict("game_data", null, row, SQLiteDatabase.CONFLICT_REPLACE)
        check(result != -1L) { "Could not save game data" }
    }

    private fun metadata(db: SQLiteDatabase, key: String): Long {
        db.rawQuery("SELECT value FROM metadata WHERE key = ?", arrayOf(key)).use { cursor ->
            check(cursor.moveToFirst()) { "Missing database metadata" }
            return cursor.getLong(0)
        }
    }

    private fun setMetadata(db: SQLiteDatabase, key: String, value: Long) {
        val row = ContentValues().apply { put("value", value) }
        check(db.update("metadata", row, "key = ?", arrayOf(key)) == 1) { "Could not update metadata" }
    }
}
