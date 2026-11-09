# Database plan — offline first, Supabase when social features arrive

**Recommendation:** Supabase is the most straightforward of the three for a small leaderboard and future account sync: Postgres handles ranking and filtering, and Auth, an API and row-level security are integrated. Firebase is also a good choice if the team prefers its mobile SDK and document database; it can be more natural for realtime-heavy mobile apps. Neon is a solid Postgres database, but authentication and an application API generally need to be added separately. Actual costs and free-tier limits vary and should be reviewed before choosing a plan.

## What exists today

Android has an **app-private SQLite database** (`tanuki_rush.db`) for progress and settings. The Three.js game still runs in a WebView; it talks to the Android database through a narrow Flutter/Kotlin bridge, not direct SQL. The browser edition continues to use browser `localStorage`. Neither version needs internet to play. The daily missions use the device's **local calendar date**; they are not a shared online competition.

On the first compatible in-place update, the Android app reads the old WebView save at the unchanged `http://127.0.0.1:43853` origin, then transactionally migrates progress, steering sensitivity, haptics and onboarding state. Original keys are left intact. After migration, SQLite is authoritative. Startup stops with a retry message if the database or legacy save cannot be safely opened rather than silently starting over. Saves from an older random origin are not discoverable by this migration.

Writes are ordered, revisioned and committed in SQLite transactions on a background thread. Until a write is acknowledged, a small WebView `localStorage` journal is retained and replayed at startup; it is a best-effort safeguard, not a guarantee against every crash, full disk or OS storage failure. A native warning and retry action appear if a save fails; the player is warned before exiting with unsaved changes. **Settings → Device storage → Details** shows the native storage status. Each stored progress record is limited to 1 MiB and each setting to 4 KiB; an oversized or invalid save stops migration instead of being discarded.

There is no account, remote database, leaderboard, app-managed backup or cross-device sync. Uninstalling, clearing app data, changing phone, or installing an APK signed with a different key may lose local data. Android/system backups are not an app-supported recovery method. In particular, debug-signed preview APKs from separate CI builds may not update in place; **do not uninstall an old build containing progress you need to keep**. A stable, securely backed-up production signing key and a tested export/backup plan are needed before release.

## Suggested next milestone

1. Create a Supabase project and document its region, plan, retention and backups. Do **not** put the service-role key, database password or private credentials in the app or Git.
2. Define a privacy policy and make online play/sync opt-in. Explain what is uploaded, how long it is retained, and how a player can delete it. Ask for a public nickname separately, with length limits and moderation safeguards.
3. Use anonymous authenticated players to avoid a compulsory sign-up screen. Guest auth alone is not durable across uninstall or device changes: offer account linking/export before promising recovery or cross-device sync.
4. Design schema and RLS so a player can modify only their own profile/submissions. Expose leaderboard data through a carefully limited public projection: no private identifiers, tokens or unnecessary user metadata. Test policies with two distinct players as well as signed-out users.
5. Submit finished runs through a trusted, rate-limited server function. Validate game/course version, time and score ranges, and handle duplicates. These checks deter obvious abuse, but a game controlled by the client cannot by itself guarantee cheat-proof scores.
6. Define shared competition periods in UTC and show the reset time. Do not call the existing local daily missions a fair shared daily course; all players need the same version and rules for comparable rankings.
7. Keep the local game playable during outages. Queue opt-in submissions safely, handle retries and conflicts, and show sync status. Test airplane mode, sign-out, reinstallation, and two real devices viewing the same board.

A Supabase **publishable/anon key** is intended for client use, but it grants whatever access the database policies allow. RLS, least-privilege grants and a tested server-side submission path matter more than hiding that key. No connection has been enabled in the current repository.
