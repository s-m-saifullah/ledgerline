package app.ledgerline.android.update

import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdateAddressTest {
    private val release = UpdateConfig("owner/repo", "https://api.github.com", "https://github.com", "ab", allowCleartext = false)
    private val debug = UpdateConfig("owner/repo", "http://localhost:3103", "http://localhost:3103", "own", allowCleartext = true)

    private fun allowed(url: String, config: UpdateConfig = release) = isAllowedUpdateUrl(url.toHttpUrl(), config)

    @Test
    fun theReleaseBuildAllowsOnlyGithubHostsOverHttps() {
        assertTrue(allowed("https://api.github.com/repos/o/r/releases"))
        assertTrue(allowed("https://github.com/o/r/releases/download/t/f"))
        assertTrue(allowed("https://objects.githubusercontent.com/x"))
        assertTrue(allowed("https://release-assets.githubusercontent.com/x"))
    }

    @Test
    fun lookAlikeHostsAndPlainHttpAreRefused() {
        assertFalse(allowed("http://github.com/x"))
        assertFalse(allowed("http://api.github.com/x"))
        assertFalse(allowed("https://evilgithubusercontent.com/x"))
        assertFalse(allowed("https://github.com.evil.example/x"))
        assertFalse(allowed("https://githubusercontent.com.evil.example/x"))
        assertFalse(allowed("https://example.com/x"))
        assertFalse(allowed("http://localhost:3103/x"))
    }

    @Test
    fun theDebugBuildAlsoAllowsItsOwnScratchHostButNoOtherPlainHttp() {
        assertTrue(allowed("http://localhost:3103/repos/o/r/releases", debug))
        assertFalse(allowed("http://203.0.113.7/x", debug))
        assertTrue(allowed("https://github.com/x", debug))
    }

    @Test
    fun theAddressesAreBuiltFromTheConstantsNotFromTheReplyOfTheList() {
        assertEquals("https://api.github.com/repos/owner/repo/releases?per_page=30", release.releasesUrl())
        assertEquals("https://github.com/owner/repo/releases/download/android-v0.1.3/f.apk", release.assetUrl("android-v0.1.3", "f.apk"))
    }

    @Test
    fun aBuildWithoutAPinCannotCheck() {
        assertTrue(release.enabled)
        assertFalse(release.copy(certPin = "").enabled)
    }
}
