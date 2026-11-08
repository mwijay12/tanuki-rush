# Mwongozo — Tanuki Rush kwenye simu

## Kucheza

Fungua mchezo na geuza simu mlalo. Buruta kidole upande wa kushoto kusogea; **JUMP** ni kuruka, **BOOST** ni kuongeza kasi, na **II** ni pause. Kusanya majani kujaza boost. Kwenye kompyuta tumia mishale/A–D, Space/J na Shift/K.

Kila siku kuna **daily missions tatu**. Maliza run upate leaf tokens, na maliza missions upate bonus. Fungua **TRAILS** kwenye mwanzo kutumia tokens kwa rangi tofauti za boost; haziongezi nguvu wala kasi. Rekodi, tokens na settings vinahifadhiwa kwenye kifaa tu, bila internet. Ukifuta app data au uninstall, progress inapotea.

## APK ya majaribio

Pakua APK kwenye [Android preview release](https://github.com/mwijay12/tanuki-rush/releases/tag/preview-d662b6729f) au angalia [GitHub Releases](https://github.com/mwijay12/tanuki-rush/releases) kwa matoleo mapya. Chagua `tanuki-rush-android-preview.apk`, ifungue na ruhusu “Install unknown apps” ikiwa Android itauliza. Android inaweza kuonya kwa sababu haitoki Play Store.

**Muhimu:** APK ya preview inasainiwa kwa debug key, si key ya production. Builds tofauti zinaweza kuwa na signatures tofauti; unaweza kulazimika ku-uninstall ya zamani kabla ya kusakinisha mpya, na progress itapotea. Ijaribu kwenye simu halisi kabla ya kuisambaza kama release kamili. Play Store inahitaji signing key ya kudumu iliyohifadhiwa salama, pamoja na majaribio.

Kwa kujenga mwenyewe unahitaji Flutter 3.47.9, Java 17, Android SDK, Node 22 na Python 3:

```bash
python3 tools/build_web_assets.py
cd mobile
flutter pub get
flutter analyze --no-pub
dart run tool/verify_asset_server.dart
flutter build apk --release --no-pub --target-platform android-arm,android-arm64
```

APK inayotengenezwa inakuwa `mobile/build/app/outputs/flutter-apk/app-release.apk`. Kuwa na njia hiyo kwenye mwongozo hakumaanishi tayari imejengwa kwenye kompyuta yako.

## Database

Kwa leaderboard na kusync baadaye, **Supabase** inapendekezwa: Postgres pamoja na authentication, API na security rules kwenye huduma moja. Kwa sasa mchezo unahifadhi offline tu; hakuna database iliyounganishwa. Maelezo na mambo ya usalama yako kwenye [DATABASE.md](DATABASE.md).

## Hati miliki

Mchezo wa asili ni wa **tanuu5 (たぬ)**, leseni MIT. Endelea kuweka copyright notice na credit yake unaposambaza. Android shell na mabadiliko ya toleo hili ni kazi ya project hii; angalia [NOTICE.md](../NOTICE.md).
