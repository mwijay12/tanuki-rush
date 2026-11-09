package com.tanukirush.tanuki_rush

import android.content.Context
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.SQLiteMode
import java.util.UUID

/** Runs against Robolectric's AOSP native SQLite, not an in-memory fake. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
@SQLiteMode(SQLiteMode.Mode.NATIVE)
class LocalGameDatabaseTest {
    private lateinit var context: Context
    private lateinit var name: String
    private lateinit var database: LocalGameDatabase
    private val progressKey = "tanuki-rush-v1"
    private fun progress(tokens: Int) = """{"tokens":$tokens,"ownedTrails":["sky"]}"""

    @Before
    fun setUp() {
        context = RuntimeEnvironment.getApplication()
        name = "test-${UUID.randomUUID()}.db"
        database = LocalGameDatabase(context, name)
    }

    @After
    fun tearDown() {
        database.close()
        context.deleteDatabase(name)
    }

    @Test
    fun migratesLegacyOnceAndPersistsAcrossReopen() {
        val legacy = mapOf(
            progressKey to progress(65),
            "tanuki_haptics" to "0",
            "tanuki_steerDiv" to "26",
            "tanuki_intro" to "1",
        )
        assertEquals(legacy, database.bootstrap(legacy, true, null).entries)
        assertEquals(1L, database.write(LocalGameDatabase.Journal(1, mapOf(progressKey to progress(100)))))
        database.close()
        database = LocalGameDatabase(context, name)
        // The old WebView backup can be stale or corrupt; after migration the
        // actual DB is authoritative and must still open without using it.
        val reopened = database.bootstrap(mapOf(progressKey to "{bad", "tanuki_haptics" to "1"), false, null)
        assertEquals(progress(100), reopened.entries[progressKey])
        assertEquals("0", reopened.entries["tanuki_haptics"])
        assertEquals("26", reopened.entries["tanuki_steerDiv"])
        assertEquals("1", reopened.entries["tanuki_intro"])
        assertEquals(1L, reopened.revision)
    }

    @Test
    fun badLegacyDoesNotMarkMigrationComplete() {
        assertThrows(IllegalArgumentException::class.java) {
            database.bootstrap(mapOf(progressKey to "{bad"), false, null)
        }
        val migrated = database.bootstrap(mapOf(progressKey to progress(7)), true, null)
        assertEquals(progress(7), migrated.entries[progressKey])
        assertEquals(0L, migrated.revision)
    }

    @Test
    fun migrationAndJournalReplayAreOneTransaction() {
        val invalidJournal = LocalGameDatabase.Journal(1, mapOf("unknown" to "bad"))
        assertThrows(IllegalArgumentException::class.java) {
            database.bootstrap(mapOf(progressKey to progress(10)), true, invalidJournal)
        }
        // If the first migration had committed before the invalid journal, this
        // new legacy value would be ignored; the rollback must allow it instead.
        val next = database.bootstrap(mapOf(progressKey to progress(20)), true, null)
        assertEquals(progress(20), next.entries[progressKey])
        assertEquals(0L, next.revision)
    }

    @Test
    fun pendingJournalReplaysAndOldOrDuplicateRevisionsCannotOverwriteNewerData() {
        val original = mapOf(progressKey to progress(10), "tanuki_intro" to "1")
        val replay = LocalGameDatabase.Journal(3, mapOf(progressKey to progress(30), "tanuki_haptics" to "0"))
        val snapshot = database.bootstrap(original, true, replay)
        assertEquals(3L, snapshot.revision)
        assertEquals(progress(30), snapshot.entries[progressKey])
        assertEquals("0", snapshot.entries["tanuki_haptics"])
        assertEquals("1", snapshot.entries["tanuki_intro"])
        assertEquals(3L, database.write(LocalGameDatabase.Journal(2, mapOf(progressKey to progress(2)))))
        assertEquals(3L, database.write(LocalGameDatabase.Journal(3, mapOf(progressKey to progress(3)))))
        database.close()
        database = LocalGameDatabase(context, name)
        val reopened = database.bootstrap(emptyMap(), true, replay)
        assertEquals(progress(30), reopened.entries[progressKey])
        assertEquals(3L, reopened.revision)
    }

    @Test
    fun validatesWholeBatchWithoutPartialWrites() {
        database.bootstrap(mapOf(progressKey to progress(1)), true, null)
        assertThrows(IllegalArgumentException::class.java) {
            database.write(LocalGameDatabase.Journal(1, linkedMapOf(progressKey to progress(2), "unknown" to "bad")))
        }
        assertThrows(IllegalArgumentException::class.java) {
            database.write(LocalGameDatabase.Journal(1, mapOf(progressKey to "[]")))
        }
        assertThrows(IllegalArgumentException::class.java) {
            database.write(LocalGameDatabase.Journal(1, mapOf("tanuki_intro" to "a".repeat(4097))))
        }
        val snapshot = database.bootstrap(emptyMap(), true, null)
        assertEquals(progress(1), snapshot.entries[progressKey])
        assertEquals(0L, snapshot.revision)
        assertFalse(snapshot.entries.containsKey("unknown"))
    }

    @Test
    fun corruptDatabaseIsNotDeletedOrSilentlyReplaced() {
        database.bootstrap(mapOf(progressKey to progress(12)), true, null)
        database.close()
        val file = context.getDatabasePath(name)
        file.writeBytes(ByteArray(512) { 0x7f })
        database = LocalGameDatabase(context, name)
        assertThrows(Exception::class.java) { database.bootstrap(emptyMap(), true, null) }
        assertTrue("A corrupt DB must be retained for recovery", file.exists() && file.length() > 0)
    }

    @Test
    fun writingBeforeBootstrapIsRejected() {
        assertThrows(IllegalStateException::class.java) {
            database.write(LocalGameDatabase.Journal(1, mapOf(progressKey to progress(9))))
        }
        assertEquals(emptyMap<String, String>(), database.bootstrap(emptyMap(), true, null).entries)
    }
}
