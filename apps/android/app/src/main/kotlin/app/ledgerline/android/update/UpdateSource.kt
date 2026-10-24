package app.ledgerline.android.update

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.builtins.ListSerializer
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.IOException

/** Why a check or a download did not complete. */
class UpdateIoException(val offline: Boolean, message: String) : IOException(message)

/** Where the list of releases comes from: GitHub's public list (a fake in tests and on the scratch machine). */
interface UpdateSource {
    suspend fun releases(): List<GithubRelease>
}

/** The two files of a release, fetched over https only. */
interface UpdateFiles {
    /** The text of the release's `.sha256` file. */
    suspend fun hashText(release: Release): String

    /** Downloads the APK to a private file; [onProgress] gets the bytes received so far. Deleted on any failure. */
    suspend fun apk(release: Release, onProgress: (Long) -> Unit): File

    /** The downloaded file (it exists only between a verified download and the install). */
    fun apkFile(): File

    fun deleteApk()
}

/** Whether a request may go to [url]: https, and only to GitHub's own hosts (the debug build: the scratch host). */
fun isAllowedUpdateUrl(url: HttpUrl, config: UpdateConfig): Boolean {
    if (config.allowCleartext) {
        val base = config.downloadBase.toHttpUrl()
        if (url.host == base.host) return true
    }
    if (!url.isHttps) return false
    return url.host == "api.github.com" || url.host == "github.com" || url.host.endsWith(".githubusercontent.com")
}

private const val MaxRedirects = 5
private const val MaxListBytes = 2L * 1024 * 1024
private const val MaxApkBytes = 200L * 1024 * 1024

/**
 * Talks to GitHub with nothing but the request itself (ADR 0043): no token, no cookie, no account or device data;
 * the User-Agent is the app's name and version only. Redirects are followed by hand, at most five and only to an allowed
 * host; the client's own redirect handling is off.
 */
class GithubUpdateSource(
    private val client: OkHttpClient,
    private val config: UpdateConfig,
    private val userAgent: String,
    directory: File,
) : UpdateSource, UpdateFiles {
    private val apkFile = File(directory, "update.apk")
    private val web = client.newBuilder().followRedirects(false).followSslRedirects(false).build()

    override suspend fun releases(): List<GithubRelease> {
        val text = fetch(config.releasesUrl(), MaxListBytes, accept = "application/vnd.github+json") { it.readText() }
        return try {
            UpdateJson.decodeFromString(ListSerializer(GithubRelease.serializer()), text)
        } catch (e: kotlinx.serialization.SerializationException) {
            throw UpdateIoException(offline = false, "The release list could not be read")
        }
    }

    override suspend fun hashText(release: Release): String =
        fetch(config.assetUrl(release.tag, release.hashName), 4096) { it.readText() }

    override suspend fun apk(release: Release, onProgress: (Long) -> Unit): File {
        val target = apkFile
        target.delete()
        try {
            fetch(config.assetUrl(release.tag, release.apkName), MaxApkBytes) { response ->
                var received = 0L
                response.byteStream().use { input ->
                    target.outputStream().use { out ->
                        val buffer = ByteArray(64 * 1024)
                        while (true) {
                            val read = input.read(buffer)
                            if (read < 0) break
                            received += read
                            if (received > MaxApkBytes) throw UpdateIoException(false, "The file is too large")
                            out.write(buffer, 0, read)
                            onProgress(received)
                        }
                    }
                }
            }
        } catch (e: Throwable) {
            target.delete()
            throw e
        }
        return target
    }

    override fun apkFile(): File = apkFile

    override fun deleteApk() {
        apkFile.delete()
    }

    private suspend fun <T> fetch(url: String, limit: Long, accept: String? = null, read: (okhttp3.ResponseBody) -> T): T =
        withContext(Dispatchers.IO) {
            var current = url.toHttpUrl()
            try {
                repeat(MaxRedirects + 1) {
                    if (!isAllowedUpdateUrl(current, config)) throw UpdateIoException(false, "The address is not allowed")
                    val request = Request.Builder().url(current).header("User-Agent", userAgent)
                        .apply { if (accept != null) header("Accept", accept) }.build()
                    web.newCall(request).execute().use { response ->
                        if (response.isRedirect) {
                            val location = response.header("Location") ?: throw UpdateIoException(false, "Bad redirect")
                            current = current.resolve(location) ?: throw UpdateIoException(false, "Bad redirect")
                            return@repeat
                        }
                        if (!response.isSuccessful) throw UpdateIoException(false, "The server answered ${response.code}")
                        val body = response.body
                        val length = body.contentLength()
                        if (length > limit) throw UpdateIoException(false, "The file is too large")
                        return@withContext read(body)
                    }
                }
                throw UpdateIoException(false, "Too many redirects")
            } catch (e: UpdateIoException) {
                throw e
            } catch (e: IOException) {
                throw UpdateIoException(offline = true, "No connection")
            }
        }

    private fun okhttp3.ResponseBody.readText(): String = string()
}
