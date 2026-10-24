import groovy.json.JsonSlurper

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
    alias(libs.plugins.hilt)
}

android {
    namespace = "app.ledgerline.android"
    compileSdk = 37

    defaultConfig {
        applicationId = "app.ledgerline.android"
        minSdk = 30
        targetSdk = 37
        // A release workflow sets both from its tag (infra/scripts/android-version.mjs); other builds keep these.
        versionCode = System.getenv("LEDGERLINE_VERSION_CODE")?.toIntOrNull() ?: 1
        versionName = System.getenv("LEDGERLINE_VERSION_NAME")?.takeIf { it.isNotBlank() } ?: "0.1.0"
        // The API version of the contract the app's types were checked against, shown in More.
        val contract = JsonSlurper().parse(rootProject.file("../../docs/openapi.json")) as Map<*, *>
        buildConfigField("String", "UPDATE_REPO", "\"s-m-saifullah/ledgerline\"")
        buildConfigField("String", "API_VERSION", "\"${(contract["info"] as Map<*, *>)["version"]}\"")
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    // The release key comes only from the environment (the android-release workflow, ADR 0043); with any of the four
    // missing the release build stays unsigned, as in pull requests and on a developer's machine.
    val keystoreFile = System.getenv("LEDGERLINE_KEYSTORE_FILE")?.takeIf { it.isNotBlank() }
    val keystorePassword = System.getenv("LEDGERLINE_KEYSTORE_PASSWORD")?.takeIf { it.isNotEmpty() }
    val keyAlias = System.getenv("LEDGERLINE_KEY_ALIAS")?.takeIf { it.isNotBlank() }
    val keyPassword = System.getenv("LEDGERLINE_KEY_PASSWORD")?.takeIf { it.isNotEmpty() }
    val releaseSigning =
        if (keystoreFile != null && keystorePassword != null && keyAlias != null && keyPassword != null) {
            signingConfigs.create("release") {
                storeFile = file(keystoreFile)
                storePassword = keystorePassword
                this.keyAlias = keyAlias
                this.keyPassword = keyPassword
            }
        } else {
            null
        }

    // The pinned signing certificate (64 hex digits, colons and case ignored); the release workflow passes the repository
    // variable ANDROID_CERT_SHA256 here. Anything else counts as not set.
    val releaseCertSha256 = (System.getenv("LEDGERLINE_CERT_SHA256") ?: "")
        .replace(":", "").trim().lowercase().takeIf { Regex("[0-9a-f]{64}").matches(it) } ?: ""

    buildTypes {
        debug {
            // Its own id and name, so it sits next to the release build on the same phone (ADR 0043, slice 5).
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
            // A debug build can be pointed at a scratch server over plain HTTP; a release build never can.
            buildConfigField("boolean", "ALLOW_CLEARTEXT", "true")
            // The update check reads a fake release list on the scratch machine (adb reverse tcp:3103 tcp:3103), and an
            // update must be signed with this build's own key; the real GitHub is never contacted (ADR 0043).
            buildConfigField("String", "UPDATE_API_BASE", "\"http://localhost:3103\"")
            buildConfigField("String", "UPDATE_DOWNLOAD_BASE", "\"http://localhost:3103\"")
            buildConfigField("String", "UPDATE_CERT_SHA256", "\"own\"")
        }
        release {
            buildConfigField("boolean", "ALLOW_CLEARTEXT", "false")
            // The update check (ADR 0043): the repository's public releases, and the certificate an update must be signed
            // with. Without LEDGERLINE_CERT_SHA256 (pull requests, a developer's build) the check is switched off.
            buildConfigField("String", "UPDATE_API_BASE", "\"https://api.github.com\"")
            buildConfigField("String", "UPDATE_DOWNLOAD_BASE", "\"https://github.com\"")
            buildConfigField("String", "UPDATE_CERT_SHA256", "\"$releaseCertSha256\"")
            isMinifyEnabled = true
            isShrinkResources = true
            signingConfig = releaseSigning
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    lint {
        // aapt2 only finds the adaptive icon in a folder with a version qualifier (mipmap-anydpi-v26), which
        // lint calls obsolete at minSdk 30.
        disable += "ObsoleteSdkInt"
        // Version updates come from Dependabot (it watches this Gradle build); this check asks the network and changes
        // its answer whenever anything is published, which made lint flag a pin kept two weeks old on purpose.
        disable += "NewerVersionAvailable"
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
        // Robolectric runs the real Room database on the JVM for the mirror tests.
        unitTests.isIncludeAndroidResources = true
    }
}

ksp {
    // The mirror's schema is committed so a later change can be checked and migrated.
    arg("room.schemaLocation", "$projectDir/schemas")
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    implementation(project(":api-client"))
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    implementation(libs.activity.compose)
    implementation(libs.hilt.android)
    implementation(libs.hilt.navigation.compose)
    implementation(libs.datastore.preferences)
    implementation(libs.lifecycle.runtime.compose)
    implementation(libs.lifecycle.process)
    implementation(libs.biometric)
    implementation(libs.room.runtime)
    implementation(libs.work.runtime)
    ksp(libs.room.compiler)
    ksp(libs.hilt.compiler)
    debugImplementation(libs.compose.ui.tooling)
    testImplementation(libs.junit)
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.core)
    testImplementation(libs.work.testing)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.okhttp.mockwebserver)
    testImplementation(platform(libs.compose.bom))
    testImplementation(libs.compose.ui.test.junit4)
    debugImplementation(libs.compose.ui.test.manifest)
    testImplementation(libs.roborazzi)
    testImplementation(libs.roborazzi.compose)
}

// Screenshots for design review (ADR 0045): only with -Pledgerline.screenshots, written to
// app/build/outputs/roborazzi, never committed or compared in CI (pixels differ between machines).
tasks.withType<Test>().configureEach {
    if (project.hasProperty("ledgerline.screenshots")) {
        systemProperty("ledgerline.screenshots", "true")
        systemProperty("roborazzi.test.record", "true")
    }
}
