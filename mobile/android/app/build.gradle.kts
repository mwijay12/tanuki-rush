plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

android {
    namespace = "com.tanukirush.tanuki_rush"
    compileSdk = flutter.compileSdkVersion
    // Pinned deliberately: AGP resolves an NDK even though the SQLite bridge
    // uses Android's built-in APIs. This keeps the build reproducible.
    ndkVersion = "27.3.13750724"

    compileOptions {
        // flutter_local_notifications uses java.time on older Android versions.
        isCoreLibraryDesugaringEnabled = true
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "com.tanukirush.tanuki_rush"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        // Uses the version code from pubspec.yaml. When using split APKs, 1000 * ABI_VERSION
        // is added automatically by Flutter. (https://developer.android.com/studio/build/configure-apk-splits#configure-APK-versions)
        // You can force using the value of versionCode by specifying the `-P force-version-code-ignoring-abi=true`
        // flag during build.
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    testOptions {
        unitTests.isIncludeAndroidResources = true
    }

    buildTypes {
        release {
            // TODO: Add your own signing config for the release build.
            // Signing with the debug keys for now, so `flutter run --release` works.
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    // One shared debug keystore for every CI-built APK, so that any two of them
    // can replace each other with `adb install -r`.
    //
    // Gradle generates a fresh debug keystore per machine, and each Actions job
    // gets a fresh machine, so the preview APK from the `build` job and the
    // diagnostic APKs from `build-field-apks` and `build-impeller-off` were each
    // signed with a different key. Installing one over another then fails with
    // INSTALL_FAILED_UPDATE_INCOMPATIBLE, which costs an uninstall — and an
    // uninstall erases local progress. This cost a real testing cycle on the
    // reporting Pixel 8 Pro. Pointing the existing debug signing config at a
    // checked-out keystore keeps every job on one key without changing which
    // config either build type uses.
    //
    // This is still a debug-grade key published in a public release: it must not
    // be mistaken for production signing, which needs a securely backed-up
    // release keystore (see README).
    val sharedKeystorePath = providers.environmentVariable("TANUKI_SHARED_DEBUG_KEYSTORE").orNull
    if (!sharedKeystorePath.isNullOrBlank()) {
        val sharedKeystore = file(sharedKeystorePath)
        if (sharedKeystore.isFile) {
            signingConfigs.getByName("debug").apply {
                storeFile = sharedKeystore
                storePassword = "android"
                keyAlias = "androiddebugkey"
                keyPassword = "android"
            }
        } else {
            logger.warn(
                "TANUKI_SHARED_DEBUG_KEYSTORE points at {} which does not exist; " +
                    "falling back to this machine's own debug keystore",
                sharedKeystore,
            )
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.4")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.14.1")
}

flutter {
    source = "../.."
}
