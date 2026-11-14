# Mwongozo — Tanuki Rush kwenye simu

## Kucheza

Fungua mchezo; unaweza kucheza simu ikiwa wima au mlalo. Weka dole gumba kwenye nusu ya kushoto ya skrini, **shikilia na buruta** kushoto au kulia kuendesha, kisha achia kusimamisha kugeuza. Tumia dole jingine: **JUMP** ni kuruka, **BOOST** ni kuongeza kasi, na **II** ni pause. Unaweza kubadili **STEER SENSITIVITY** kwenye Settings. Kusanya majani kujaza boost. Kwenye kompyuta tumia mishale/A–D, Space/J na Shift/K.

Ukigonga kizuizi au kuanguka, utaona **GAME OVER**. Chagua **REVIVE FREE** mara moja kwa kila run ili kuendelea kutoka checkpoint ya mwisho bila kupoteza score na majani, au **RETRY FROM START** kuanza upya. Revive ni bure kabisa; hakuna matangazo au internet inayohitajika. Majani hayakingi ajali tena, lakini BOOST bado inaweza kuvunja vizuizi.

Preview 1.0.3 imepunguza na kurahisisha sauti ya BOOST na bado inajaribu kurejesha sauti ikinyamaza. Tatizo la Pixel halijaigwa kwenye majaribio ya browser, kwa hiyo suluhisho bado linahitaji kuthibitishwa kwenye simu. Ikiwa sauti bado haisikiki, bonyeza **Pause → Settings → Restore Audio → Reset**, kisha Resume. Hakikisha pia SOUND iko ON na sauti ya simu imewashwa.

Kila siku kuna **daily missions tatu**. Maliza run upate leaf tokens, na maliza missions upate bonus. Fungua **TRAILS** kwenye mwanzo kutumia tokens kwa rangi tofauti za boost; haziongezi nguvu wala kasi. Rekodi, tokens na settings vinahifadhiwa offline kwenye SQLite ya simu. Fungua **Settings → Device storage → Details** kuona hali; ikiwa kuhifadhi kumeshindikana, utaona onyo na **Retry**. Hakuna sync au backup ya app; ukifuta app data au ku-uninstall unaweza kupoteza progress.

## APK ya majaribio

Pakua APK ya **pre-release** mpya kwenye [GitHub Releases](https://github.com/mwijay12/tanuki-rush/releases). Preview 1.0.1 imebadilisha setting ya Android WebView iliyokuwa inazuia kuburuta kuendesha. Chagua `tanuki-rush-android-preview.apk`, ifungue na ruhusu “Install unknown apps” ikiwa Android itauliza. Android inaweza kuonya kwa sababu haitoki Play Store.

**Muhimu:** APK ya preview inasainiwa kwa debug key, si key ya production. Builds tofauti zinaweza kuwa na signatures tofauti; Android inaweza kukataa update na kutaka u-uninstall ya zamani, jambo linaloweza kufuta progress. **Usi-uninstall ikiwa progress hiyo ni muhimu.** Kuhamisha progress ya zamani kwenda SQLite kunafanya kazi tu ukiweza ku-update bila kufuta data na ikiwa ilikuwa kwenye origin ile ile. Ijaribu kwenye simu halisi kabla ya kusambaza; Play Store inahitaji signing key ya kudumu iliyohifadhiwa salama.

### Skrini tupu ya bluu

Toleo la 1.0.4 na 1.0.5 lilikuwa na hitilafu: app ilikaa kwenye **skrini ya bluu bila chochote** na kitufe cha kurudi hakifanyi kazi. Sababu ni kwamba injini ya Flutter ilishindwa kuchora fremu ya kwanza, kwa hiyo hakuna ujumbe wa Dart ulioweza kuonekana — bluu uliokuwa unaonekana ni background ya window ya Android. Jaribio la CI sasa linaweza kuiga tatizo hili: APK ile ile hufaulu kwenye Android 14 (API 34) na kushindwa kwenye Android 16/17 (API 36/37), hivyo si download mbaya wala installation iliyoharibika.

Toleo la **1.0.6** linaongeza *watchdog* ya native: ikiwa hakuna fremu ndani ya sekunde 12, skrini itaonyesha maelezo — model ya simu, toleo la Android, API level na muda uliosubiriwa — pamoja na **Jaribu tena / Retry** na **Funga / Close**. **Hitilafu yenyewe bado haijatatuliwa.** Ukiona skrini hiyo, piga picha na uripoti maneno yaliyoandikwa; maelezo hayo ndiyo yanahitajika kutengeneza fix.

Kwa sasa, njia salama zaidi ya kucheza ni **toleo la browser**: fungua `tanuki-rush/` kwenye seva ya local au tovuti iliyotumwa, na ucheze kwenye Chrome ya simu. Hakuna WebView shell, hakuna bluu screen.

Kwa kujenga mwenyewe unahitaji Flutter 3.47.9, Java 17, Android SDK, Node 22 na Python 3:

```bash
python3 tools/build_web_assets.py
cd mobile
flutter pub get
flutter analyze --no-pub
flutter test --no-pub
dart run tool/verify_asset_server.dart
flutter build apk --release --no-pub --target-platform android-arm,android-arm64
```

APK inayotengenezwa inakuwa `mobile/build/app/outputs/flutter-apk/app-release.apk`. Kuwa na njia hiyo kwenye mwongozo hakumaanishi tayari imejengwa kwenye kompyuta yako.

## Database

Kwa sasa Android ina **database ya SQLite ndani ya simu**, na browser hutumia localStorage. Kwa leaderboard na kusync baadaye, **Supabase** inapendekezwa, lakini bado haijaunganishwa. Mchezo wa 3D bado unaendeshwa ndani ya WebView; si native 3D engine. Maelezo yako kwenye [DATABASE.md](DATABASE.md).

## Hati miliki

Mchezo wa asili ni wa **tanuu5 (たぬ)**, leseni MIT. Endelea kuweka copyright notice na credit yake unaposambaza. Android shell na mabadiliko ya toleo hili ni kazi ya project hii; angalia [NOTICE.md](../NOTICE.md).
