# Android

Run `./gradlew :core:test :app:assembleDebug :app:lintDebug` from this folder with JDK 25 and Android SDK 37. Set `ANDROID_HOME` to your SDK directory. The core is a Kotlin/JVM library; it bundles contract data and language profiles from the repository at build time and reads shared fixtures directly in tests.

Stable versions verified against the official Maven registries and Gradle releases on 2026-11-12: Gradle 9.9.1, Android Gradle plugin 9.5.1, Kotlin and Compose compiler 2.4.21, Compose UI 1.12.1, Material 3 1.4.0, Activity Compose 1.13.0, kotlinx.serialization 1.13.0, kotlinx.coroutines 1.11.0, and JUnit Jupiter 6.1.3. Jupiter retains the JUnit 5 dynamic test API used by the contract tests. Local verification uses Temurin 25.0.4.1 and Android build tools 37.0.0.

Application versions are independent of the browser extension and come from `VERSION_NAME` and `VERSION_CODE` in `gradle.properties`. Generated build output, SDK paths, and contract copies stay out of the source tree.
