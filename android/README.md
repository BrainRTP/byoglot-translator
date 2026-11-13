# Android

Run `./gradlew :core:test :app:assembleDebug :app:lintDebug` from this folder with JDK 25 and Android SDK 37. Set `ANDROID_HOME` to your SDK directory. The core is a Kotlin/JVM library; it bundles contract data and language profiles from the repository at build time and reads shared fixtures directly in tests.

Stable versions verified against the official Maven registries and Gradle releases on 2026-11-12: Gradle 9.9.1, Android Gradle plugin 9.5.1, Kotlin and Compose compiler 2.4.21, Compose UI 1.12.1, Material 3 1.4.0, Activity Compose 1.13.0, kotlinx.serialization 1.13.0, kotlinx.coroutines 1.11.0, and JUnit Jupiter 6.1.3. Jupiter retains the JUnit 5 dynamic test API used by the contract tests. Local verification uses Temurin 25.0.4.1 and Android build tools 37.0.0.

Application versions are independent of the browser extension and come from `VERSION_NAME` and `VERSION_CODE` in `gradle.properties`. Generated build output, SDK paths, and contract copies stay out of the source tree.

The app adds DataStore 1.3.0 and Lifecycle ViewModel 2.11.0. Android tests use AndroidX Test Runner 1.7.0 and Test JUnit 1.3.0; JVM app tests use kotlinx-coroutines-test at the catalog coroutine version. These versions were verified in the official Google Maven registry. Run `./gradlew :core:test :app:testDebugUnitTest :app:assembleDebug :app:lintDebug :app:assembleDebugAndroidTest` for the complete device-free checks.

Run `./gradlew :app:connectedDebugAndroidTest` on Android 17 before release. Local provider connections request `ACCESS_LOCAL_NETWORK`. Public HTTP and cross-origin redirects are refused at the transport boundary. The HTTP timeout is a total deadline, response bodies are capped at 8 MB, and the HTTP cache is disabled.

Settings alone are eligible for backup and transfer. Credentials use Android Keystore encryption and atomic records under `no_backup`; translations stay in memory. Screens and clipboard results are marked sensitive, and translation or key fields are never saved into activity instance state. Imported provider connections need their keys and consent restored in Connections.
