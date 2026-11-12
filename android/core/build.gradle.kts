plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
}
kotlin {
    jvmToolchain(25)
    compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) }
}
java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}
val contractResources = layout.buildDirectory.dir("generated/resources/contracts")
val syncContracts = tasks.register<Sync>("syncContracts") {
    from("../../contracts") {
        include("languages.json", "presets.json", "limits.json", "builtin-template.json", "errors.json")
        into("contracts")
    }
    from("../../lib/translate/profiles") { include("*.md"); into("profiles") }
    into(contractResources)
}
sourceSets.main { resources.srcDir(syncContracts) }
tasks.processResources { dependsOn(syncContracts) }
tasks.test { useJUnitPlatform() }
dependencies {
    implementation(libs.serialization.json)
    implementation(libs.coroutines.core)
    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.launcher)
}
