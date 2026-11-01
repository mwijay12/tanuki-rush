# Mwongozo — jinsi ya kuitumia app kwenye simu yako

## 1. Kuweka APK kwenye simu

Faili ya kuinstall iko hapa:

```
mobile/build/app/outputs/flutter-apk/app-release.apk
```

Njia mbili:

**Kwa kebo (adb):**

```bash
adb install -r mobile/build/app/outputs/flutter-apk/app-release.apk
```

**Bila kebo:** tuma faili ya APK kwa simu (WhatsApp, USB, Google Drive), ifungue
kwenye simu, kisha ruhusu "Install unknown apps" kwa app uliyotumia kuifungua.
Android itaonya kwa sababu APK hii haitoki Play Store — hiyo ni kawaida.

## 2. Kucheza

- Fungua app → mchezo unaanza moja kwa moja, hakuna browser.
- **Landscape pekee.** Geuza simu kwa pembeni.
- Vidole: drag upande wa kushoto kwa kusogea kushoto/kulia; vitufe vya **JUMP**,
  **BOOST**, **BRAKE** viko upande wa kulia.
- Kitufe cha "back" cha Android: bonyeza mara moja = pause; bonyeza tena ndani ya
  sekunde 2 = toka.

## 3. Kubadilisha jina la app au package

- Jina linaloonekana kwenye simu: `mobile/android/app/src/main/AndroidManifest.xml`,
  sifa `android:label`.
- Package id (inayotakiwa na Play Store): `mobile/android/app/build.gradle.kts`,
  `applicationId`. Badilisha pia `namespace` na jina la folda ya Kotlin chini ya
  `android/app/src/main/kotlin/...`.

## 4. Kujenga APK mwenyewe

Unahitaji Flutter SDK na Android SDK. Kisha:

```bash
cd mobile
flutter pub get
flutter build apk --release
```

Ukibadilisha mchezo wenyewe (ndani ya `tanuki-rush/`), kumbuka:

```bash
python3 tools/build_web_assets.py   # hujenga upya assets/web/
cd mobile && flutter build apk --release
```

## 5. Kwa Play Store (baadaye)

APK ya sasa inasainiwa kwa **debug key** — inatosha kwa simu yako, haitoshi kwa
Play Store. Unahitaji:

1. Kuunda keystore:
   ```bash
   keytool -genkey -v -keystore ~/tanuki-upload.jks -keyalg RSA \
     -keysize 2048 -validity 10000 -alias upload
   ```
2. Faili `mobile/android/key.properties` yenye nenosiri na njia ya keystore.
3. Kubadilisha `signingConfig` kwenye `app/build.gradle.kts` kutumia keystore hiyo.
4. `flutter build appbundle --release` (Play Store inapenda `.aab`, sio `.apk`).

Usiweke `key.properties` wala `.jks` kwenye git — `.gitignore` inazizuia tayari.

## 6. Kumbuka kuhusu hati miliki

Mchezo ni wa **たぬ (tanuu5)**, leseni ya MIT. Sheria ni rahisi:

- Unaweza kuutumia, kuubadilisha, na kuusambaza.
- Lazima uendelee kuweka copyright notice yake (`LICENSE-tanuki-rush`).
- Kwenye Play Store na GitHub, andika wazi kwamba mchezo wa asili ni wake.
- Usiseme mchezo wote ni wako — sema ulifanya app ya Android inayouendesha.
