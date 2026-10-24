package app.ledgerline.android.update

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** One entry of GitHub's releases list; only what the update check reads (ADR 0043, in-app update). */
@Serializable
data class GithubRelease(
    @SerialName("tag_name") val tagName: String,
    val draft: Boolean = false,
    val prerelease: Boolean = false,
    val body: String? = null,
    val assets: List<GithubAsset> = emptyList(),
)

@Serializable
data class GithubAsset(val name: String, val size: Long = 0)

/** A release the app can offer: its notes as plain text and the two files it needs. */
@Serializable
data class Release(
    val tag: String,
    /** The version name, X.Y.Z. */
    val name: String,
    /** X*10000 + Y*100 + Z, the Android version code the release workflow gives the APK. */
    val code: Int,
    val notes: String,
    val apkName: String,
    val apkSize: Long,
    val hashName: String,
)

/** What the update check is pointed at; the release build is fixed to GitHub over https (ADR 0043). */
data class UpdateConfig(
    val repo: String,
    val apiBase: String,
    val downloadBase: String,
    /** The certificate fingerprint an update must be signed with: 64 hex digits, "own" (debug) or blank (check off). */
    val certPin: String,
    val allowCleartext: Boolean,
) {
    /** Whether this build can check at all: it needs a certificate to hold an update to. */
    val enabled: Boolean get() = certPin.isNotBlank()

    fun releasesUrl() = "$apiBase/repos/$repo/releases?per_page=30"

    fun assetUrl(tag: String, name: String) = "$downloadBase/$repo/releases/download/$tag/$name"
}

val UpdateJson = Json { ignoreUnknownKeys = true }

/** The most the update screen shows of the release notes. */
const val MaxNotesLength = 4000

private val tagPattern = Regex("^android-v(0|[1-9]\\d{0,2})\\.(0|[1-9]\\d?)\\.(0|[1-9]\\d?)$")

/** The version code of an Android release tag (`android-vX.Y.Z`), or null for any other tag. */
fun versionCodeOfTag(tag: String): Int? {
    val match = tagPattern.matchEntire(tag) ?: return null
    val (major, minor, patch) = match.destructured
    return major.toInt() * 10000 + minor.toInt() * 100 + patch.toInt()
}

/**
 * The notes the owner reads: the release text above its first line holding only `---` (the fingerprints follow it),
 * plain text, cut at [MaxNotesLength] characters. Nothing in it is followed or rendered.
 */
fun releaseNotes(body: String?): String {
    val lines = (body ?: "").replace("\r\n", "\n").split("\n")
    val end = lines.indexOfFirst { it.trim() == "---" }.let { if (it < 0) lines.size else it }
    val text = lines.take(end).joinToString("\n").trim()
    return if (text.length <= MaxNotesLength) text else text.take(MaxNotesLength).trimEnd() + "…"
}

/**
 * The newest release the app may offer: the highest `android-vX.Y.Z` that is published (not a draft, not a
 * pre-release) and carries its two files, `ledgerline-android-X.Y.Z.apk` and its `.sha256`. The server's `v*` tags
 * and any other tag are ignored. Null when there is none.
 */
fun chooseRelease(releases: List<GithubRelease>): Release? =
    releases.asSequence()
        .filter { !it.draft && !it.prerelease }
        .mapNotNull { release ->
            val code = versionCodeOfTag(release.tagName) ?: return@mapNotNull null
            val name = release.tagName.removePrefix("android-v")
            val apk = release.assets.firstOrNull { it.name == "ledgerline-android-$name.apk" } ?: return@mapNotNull null
            val hash = release.assets.firstOrNull { it.name == "ledgerline-android-$name.apk.sha256" } ?: return@mapNotNull null
            Release(release.tagName, name, code, releaseNotes(release.body), apk.name, apk.size, hash.name)
        }
        .maxByOrNull { it.code }
