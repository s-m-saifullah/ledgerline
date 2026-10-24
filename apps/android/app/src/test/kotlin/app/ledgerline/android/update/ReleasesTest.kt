package app.ledgerline.android.update

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

private fun release(
    tag: String,
    draft: Boolean = false,
    prerelease: Boolean = false,
    body: String? = "Notes for $tag.\n\n---\n\nSigned release.",
    assets: List<String>? = null,
): GithubRelease {
    val name = tag.removePrefix("android-v")
    val files = assets ?: listOf("ledgerline-android-$name.apk", "ledgerline-android-$name.apk.sha256")
    return GithubRelease(tag, draft, prerelease, body, files.map { GithubAsset(it, 1000) })
}

class ReleasesTest {
    @Test
    fun theTagGivesTheVersionCodeTheReleaseWorkflowUses() {
        assertEquals(10203, versionCodeOfTag("android-v1.2.3"))
        assertEquals(103, versionCodeOfTag("android-v0.1.3"))
        assertEquals(9999999, versionCodeOfTag("android-v999.99.99"))
    }

    @Test
    fun anyOtherTagHasNoCode() {
        for (tag in listOf("v0.5.4", "android-v1.2", "android-v01.2.3", "android-v1.100.0", "android-v1.2.3-rc1", "android-1.2.3", "")) {
            assertNull(tag, versionCodeOfTag(tag))
        }
    }

    @Test
    fun theHighestVersionWinsWhateverTheOrderOfTheList() {
        val chosen = chooseRelease(listOf(release("android-v0.9.0"), release("android-v0.10.0"), release("android-v0.1.2")))
        assertEquals("0.10.0", chosen?.name)
        assertEquals(1000, chosen?.code)
    }

    @Test
    fun draftsPreReleasesAndTheServersTagsAreIgnored() {
        val list = listOf(
            release("android-v0.3.0", draft = true),
            release("android-v0.2.0", prerelease = true),
            release("v0.5.4", assets = listOf("ledgerline-android-0.5.4.apk", "ledgerline-android-0.5.4.apk.sha256")),
            release("android-v0.1.2"),
        )
        assertEquals("0.1.2", chooseRelease(list)?.name)
        assertNull(chooseRelease(list.take(3)))
    }

    @Test
    fun aReleaseWithoutBothFilesIsNotOffered() {
        assertNull(chooseRelease(listOf(release("android-v0.2.0", assets = listOf("ledgerline-android-0.2.0.apk")))))
        assertNull(chooseRelease(listOf(release("android-v0.2.0", assets = listOf("ledgerline-android-0.2.0.apk.sha256")))))
        assertNull(chooseRelease(listOf(release("android-v0.2.0", assets = listOf("other.apk", "other.apk.sha256")))))
        assertNull(chooseRelease(emptyList()))
    }

    @Test
    fun theReleaseCarriesItsFilesSizeAndNotes() {
        val chosen = chooseRelease(listOf(release("android-v0.1.3")))!!
        assertEquals("android-v0.1.3", chosen.tag)
        assertEquals("ledgerline-android-0.1.3.apk", chosen.apkName)
        assertEquals("ledgerline-android-0.1.3.apk.sha256", chosen.hashName)
        assertEquals(1000L, chosen.apkSize)
        assertEquals("Notes for android-v0.1.3.", chosen.notes)
    }

    @Test
    fun notesStopAtTheFirstLineOfOnlyThreeDashes() {
        assertEquals("One\nTwo", releaseNotes("One\nTwo\n---\nHashes"))
        assertEquals("One", releaseNotes("One\r\n  ---  \r\nHashes"))
        assertEquals("A --- B\n----", releaseNotes("A --- B\n----\n---\nx"))
    }

    @Test
    fun notesWithoutTheLineAreAllShownAndEmptyOnesAreEmpty() {
        assertEquals("Just this.", releaseNotes("  Just this.\n"))
        assertEquals("", releaseNotes(null))
        assertEquals("", releaseNotes("---\nHashes only"))
    }

    @Test
    fun longNotesAreCutAtTheLimitWithAnEllipsis() {
        val long = releaseNotes("x".repeat(MaxNotesLength + 50))
        assertEquals(MaxNotesLength + 1, long.length)
        assertEquals('…', long.last())
        assertEquals(MaxNotesLength, releaseNotes("x".repeat(MaxNotesLength)).length)
    }

    @Test
    fun theListReaderIgnoresWhatItDoesNotNeed() {
        val json = """[{"tag_name":"android-v0.1.3","draft":false,"prerelease":false,"body":"Hi\n---\nx","id":7,"author":{"login":"a"},
            "assets":[{"name":"ledgerline-android-0.1.3.apk","size":5,"download_count":3,"browser_download_url":"https://example.invalid/x"},
            {"name":"ledgerline-android-0.1.3.apk.sha256","size":90}]}]"""
        val parsed = UpdateJson.decodeFromString(kotlinx.serialization.builtins.ListSerializer(GithubRelease.serializer()), json)
        assertEquals("0.1.3", chooseRelease(parsed)?.name)
        assertEquals("Hi", chooseRelease(parsed)?.notes)
    }
}
