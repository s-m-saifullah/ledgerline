plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
}

kotlin {
    jvmToolchain(17)
}

// The app's API types are written by hand for the routes it uses (the generated client was not usable,
// see ADR 0043). The contract test compares them with the committed OpenAPI document.
val openApiDocument = rootProject.file("../../docs/openapi.json")

tasks.test {
    inputs.file(openApiDocument)
    systemProperty("openapi.path", openApiDocument.absolutePath)
}

dependencies {
    api(libs.retrofit)
    api(libs.retrofit.kotlinx.serialization)
    api(libs.okhttp)
    api(libs.kotlinx.serialization.json)
    api(libs.kotlinx.coroutines.core)
    testImplementation(libs.junit)
    testImplementation(libs.okhttp.mockwebserver)
}
