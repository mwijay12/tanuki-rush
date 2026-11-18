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

Toleo la 1.0.4 na 1.0.5 lilikuwa na hitilafu: app ilikaa kwenye **skrini ya bluu bila chochote** na kitufe cha kurudi hakifanyi kazi. Sababu ni kwamba injini ya Flutter ilishindwa kuchora fremu ya kwanza, kwa hiyo hakuna ujumbe wa Dart ulioweza kuonekana — bluu uliokuwa unaonekana ni background ya window ya Android. Jaribio la CI liliweza kuiga tatizo hili mara moja: APK ile ile iliyochora fremu kwenye emulator ya Android 14 (API 34) haikuchora kabisa kwenye Android 16 (API 36). Kwa hiyo si download mbaya wala installation iliyoharibika. Baadaye tatizo hilo lilionekana pia kwenye emulator ya Android 14 (API 34) ambayo ilikuwa imepita mara tatu, kwa hiyo ni **hitilafu ya mara kwa mara (intermittent)**, si ya toleo moja la Android. Emulator ya Android 17 (API 37) **haiwezi kujaribiwa kwenye CI kabisa** — hakuna image inayoweza kuanzishwa kwenye runners, jambo ambalo sasa limethibitishwa kwa sababu script inaandika kila hatua ya kushindwa isipokuwa ile ya API 37. Badala yake tunajaribu Android 15 (API 35). Kwa hiyo ushahidi wa Android 17 unatokana na skrini ya watchdog kwenye simu yako pekee.

Toleo la **1.0.6** linaongeza *watchdog* ya native: ikiwa hakuna fremu ndani ya sekunde 12, skrini itaonyesha maelezo — model ya simu, toleo la Android, API level na muda uliosubiriwa — pamoja na **Jaribu tena / Retry** na **Funga / Close**. Kwenye CI, emulator ya API 36 imepita mara nne mfululizo kwa 1.0.6, lakini kwa kuwa hitilafu ni ya mara kwa mara, kupita mara nne hakuthibitishi chochote — **hitilafu bado haijathibitishwa kutatuliwa**. Ukiona skrini hiyo, piga picha na uripoti maneno yaliyoandikwa; maelezo hayo ndiyo yanahitajika kutengeneza fix.

### Ripoti ya kwanza kutoka simu (2026-11-17) — hitilafu si ile tuliyodhani

Kipimo cha kwanza cha `field_diag.ps1` kwenye **Pixel 8 Pro, Android 17 (API 37)**, Mali-G715, WebView 157.0.8103.38, toleo 1.0.7+8, kilibadilisha utambuzi kabisa:

- `am start -W` → `TotalTime: 1104`. `[tanuki] first-frame-painted` iko kwenye log. Watchdog iliandika `armed` kisha `first frame painted`. **Flutter inachora kwa sekunde ~1.1 — hakuna hang kabla ya fremu kwenye simu hii.** (Heartbeat 0 ni kawaida hapa: fremu ilifika kabla ya kipindi cha kwanza cha sekunde 5.)
- Seva ya ndani ya app ilijibu **HTTP 200** (bayti 1584 za `index.html`) kupitia bandari 43853 → upande wa Dart ni mzima.
- Skrini: bapa `#0A1A44` saa t=3/8/13/20, kisha **yenye maudhui** t=30 (rangi 13: `#0C1633` = `--hud-ink`, `#13192B`/`#121B34` = gradient ya `.loading` juu ya `og-image.jpg`, `#FFFFFF` 0.1% = maandishi "LOADING…"), kisha bapa `#0A1A44` tena t=45.
- Mchezo **ulikuwa unaendelea** wakati hakuna kinachoonekana: `chromium(11905) SyncReader::Read timed out, audio glitch count=10…80` — pid 11905 ni app yetu.
- Ufunguo: `hud.css` ina `html, body { background: #000 }`. Kwa hiyo skrini ya **bluu ya giza** si ukurasa wa web — ni rangi ya Flutter (`GameColors.night`) au ya window ya Android. **Maudhui ya WebView yameacha kufika kwenye skrini.**

Kwa kifupi: WebView ilikuwa inaonekana t=30 (overlay yake ya "LOADING…"), na baada ya `doneLoading()` kuiondoa — WebGL canvas ikabaki pekee — platform view ilikoma kuonyeshwa. Washukiwa sasa ni **Impeller** (rasterizer ya Flutter) na **hybrid composition** ya platform view kwenye Android 17 / Mali-G715.

Nadharia mbili za awali **zimekufa**: `dex2oat`/WebView ya mara ya kwanza (mistari ile ilikuwa ya app nyingine, pid 12115 — Snaptube; script sasa inachuja kwa pid yetu), na ANR (faili za `/data/anr` ni za 2026-11-14).

### Majaribio mawili ya simu (APK zilizochapishwa pamoja na preview)

Kila preview ina APK tatu. Mbili za ziwa ni za uchunguzi, zinatoka kwenye runner moja kwa hiyo **zina signature moja** — unaweza kubadilishana bila ku-uninstall:

| Faili | Madhumuni |
|---|---|
| `tanuki-rush-android-preview.apk` | toleo la kawaida (Impeller imezimwa HAPANA) |
| `tanuki-rush-arm64-release-impeller-off.apk` | **Impeller imezimwa.** Mchezo ukionekana → rasterizer ndiyo hatia. |
| `tanuki-rush-arm64-debug-inspectable.apk` | **debug build.** Fungua `chrome://inspect` kwenye PC → unaweza kusoma console ya WebView na kuangalia hali ya canvas moja kwa moja. |

Kumbuka: kuhamia kutoka preview ya zamani kwenda hizi kunahitaji **uninstall moja** (signature ya runner tofauti), na hiyo inafuta progress. Kwa kuwa mchezo haujafunguka kamwe kwenye simu hii, hakuna cha kupoteza.

**Jaribio la bila APK mpya (sekunde 30):** wakati app inaendelea (hata kwenye skrini ya bluu), fungua **Chrome ya simu** na elekea `http://127.0.0.1:43853/index.html`. Seva ile ile inayoisha ndani ya app inahudumia mchezo.

- Mchezo ukicheza Chrome ya simu → GPU na bundle ni safi; hatia ni **WebView/Flutter composition**.
- Chrome ya simu pia ikawa bluu/weusi → tatizo ni **WebGL/GPU** ya simu yenyewe.

### Kupima skrini ya bluu kwenye simu yako (Windows + PowerShell)

Kuna script moja inayokusanya ushahidi wote kwa mara moja: `tools/field_diag.ps1`. Inahitaji kompyuta ya Windows, kebo ya USB, na simu iliyo katika developer mode.

**1. Weka adb kwenye kompyuta**

- Pakua `https://dl.google.com/android/repository/platform-tools-latest-windows.zip` (faili rasmi ya Google).
- Toa (extract) kwenye `C:\platform-tools`. Hakuna installer inayohitajika.

**2. Washa USB debugging kwenye simu**

- Settings → About phone → gusa **Build number** mara 7 (hufungua Developer options).
- Settings → System → Developer options → **USB debugging** = ON.
- Unganisha kebo; simu itauliza **"Allow USB debugging?"** → gusa **ALLOW** (tia alama ya "always allow from this computer").

**3. Pakua APK mpya** kutoka `https://github.com/mwijay12/tanuki-rush/releases/latest` — faili ni `tanuki-rush-android-preview.apk`.

**4. Endesha script** kutoka kwenye folder ya repo:

```powershell
powershell -ExecutionPolicy Bypass -File tools\field_diag.ps1 -Adb C:\platform-tools\adb.exe -Apk C:\Users\<jina lako>\Downloads\tanuki-rush-android-preview.apk
```

Script itasoma toleo lililosakinishwa, kufunga app na kuiwasha upya, kupiga picha za skrini kila sekunde chache, kusoma logcat, kuangalia historia ya ANR, na mwisho kufungua mchezo kutoka kwenye simu yenyewe kupitia bandari 43853 ili kujua ikiwa upande wa Dart uko hai. **Haifuti data yako na hai-uninstall chochote** isipokuwa ukiongeza `-ForceUninstall` mwenyewe.

**5. Tuma matokeo:** `tanuki-report.txt` (nakili maudhui yote hapa chat), `tanuki-screen.png` (ambatanisha picha), na `tanuki-logcat.txt` ikiwa itaombwa.

**Jinsi ya kusoma rangi ya skrini.** Script inachapisha rangi halisi za pixel, si maelezo ya macho:

| Rangi iliyochapishwa | Maana |
|---|---|
| `#0A1A44` (bluu ya giza), skrini bapa bila kitu | App imesimama **kabla ya Flutter kuchora** — hii ndiyo hitilafu inayoripotiwa. Soma mstari wa `SUB-VERDICT`. |
| `#0A1A44` lakini kuna spinner, maandiko au kitufe | Njia ya makosa inafanya kazi; picha pekee inatosha kutambua tatizo. |
| `#BFE3FF` (bluu nyepesi), skrini bapa | Flutter na WebView wako hai, lakini **WebGL haikuchora scene**. Hii ni hitilafu tofauti kabisa (GPU ndani ya WebView), na watchdog hukaa kimya kwa sababu Flutter inachora kawaida. |

Mstari muhimu zaidi kwenye ripoti ni `SUB-VERDICT`:

- **"UI thread STOPPED RUNNING"** → kitu cha native kimezuia main thread baada ya `onCreate` (injini ya Flutter, usajili wa plugin, au WebView inayojiandaa kwa mara ya kwanza). Hii inaendana na kitufe cha kurudi kuwa kimekufa.
- **"UI thread is ALIVE"** (heartbeat zinaendelea) → Android iko sawa, injini ya Flutter inashindwa kuchora; tatizo ni kwenye rasterizer/GPU.
- **"the app is NOT installed"** → sakinisha APK kwanza, kisha endesha script tena.

Toleo la **1.0.7** linaongeza *heartbeat* kwenye log kila sekunde 5 wakati app inasubiri fremu. Ndicho kinachotofautisha visa hivyo viwili hapo juu, kwa hiyo tumia APK ya 1.0.7 (si 1.0.6) kwa vipimo hivi.

Kwa sasa, njia salama zaidi ya kucheza ni **toleo la browser** kwenye Chrome ya simu — hakuna Flutter shell, hakuna skrini ya bluu. Chanzo kiko `tanuki-rush/`; kijengee kwa `npm run build` na utumie `npm run preview`. Workflow ya `.github/workflows/web.yml` itachapisha tovuti kwenye GitHub Pages (`https://mwijay12.github.io/tanuki-rush/`) mara tu Pages itakapowashwa kwenye Settings → Pages → Source: **GitHub Actions**; ni hatua moja ya kibinadamu kwa sababu token ya CI haina ruhusa ya `pages: write`.

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
