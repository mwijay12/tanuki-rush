# Database plan — offline first, Supabase when social features arrive

**Recommendation:** Supabase is the most straightforward of the three for a small leaderboard and future account sync: Postgres handles ranking and filtering, and Auth, an API and row-level security are integrated. Firebase is also a good choice if the team prefers its mobile SDK and document database; it can be more natural for realtime-heavy mobile apps. Neon is a solid Postgres database, but authentication and an application API generally need to be added separately. Actual costs and free-tier limits vary and should be reviewed before choosing a plan.

## What exists today

No remote database, account, leaderboard or cloud sync is configured. Best records, three daily missions, tokens, owned trails and settings live in local WebView/browser storage. The game works offline. The on-device daily missions use the device's **local calendar date**; they are not a shared online competition.

## Suggested next milestone

1. Create a Supabase project and document its region, plan, retention and backups. Do **not** put the service-role key, database password or private credentials in the app or Git.
2. Define a privacy policy and make online play/sync opt-in. Explain what is uploaded, how long it is retained, and how a player can delete it. Ask for a public nickname separately, with length limits and moderation safeguards.
3. Use anonymous authenticated players to avoid a compulsory sign-up screen. Guest auth alone is not durable across uninstall or device changes: offer account linking/export before promising recovery or cross-device sync.
4. Design schema and RLS so a player can modify only their own profile/submissions. Expose leaderboard data through a carefully limited public projection: no private identifiers, tokens or unnecessary user metadata. Test policies with two distinct players as well as signed-out users.
5. Submit finished runs through a trusted, rate-limited server function. Validate game/course version, time and score ranges, and handle duplicates. These checks deter obvious abuse, but a game controlled by the client cannot by itself guarantee cheat-proof scores.
6. Define shared competition periods in UTC and show the reset time. Do not call the existing local daily missions a fair shared daily course; all players need the same version and rules for comparable rankings.
7. Keep the local game playable during outages. Queue opt-in submissions safely, handle retries and conflicts, and show sync status. Test airplane mode, sign-out, reinstallation, and two real devices viewing the same board.

A Supabase **publishable/anon key** is intended for client use, but it grants whatever access the database policies allow. RLS, least-privilege grants and a tested server-side submission path matter more than hiding that key. No connection has been enabled in the current repository.
