package app.ledgerline.android.server

import org.junit.Assert.assertEquals
import org.junit.Test

class ServerAddressTest {
    private fun valid(input: String, cleartext: Boolean = false) =
        (parseServerAddress(input, cleartext) as AddressResult.Valid).origin

    private fun refused(input: String, cleartext: Boolean = false) =
        (parseServerAddress(input, cleartext) as AddressResult.Refused).problem

    @Test
    fun aBareHostGetsHttps() = assertEquals("https://ledgerline.example.com", valid("ledgerline.example.com"))

    @Test
    fun theOriginIsNormalised() {
        assertEquals("https://ledgerline.example.com", valid("  HTTPS://Ledgerline.Example.com/  "))
        assertEquals("https://ledgerline.example.com", valid("https://ledgerline.example.com:443"))
        assertEquals("https://ledgerline.example.com:8443", valid("ledgerline.example.com:8443"))
    }

    @Test
    fun emptyInputIsRefused() {
        assertEquals(AddressProblem.Empty, refused(""))
        assertEquals(AddressProblem.Empty, refused("   "))
    }

    @Test
    fun plainHttpIsRefusedInReleaseBuilds() {
        assertEquals(AddressProblem.Cleartext, refused("http://ledgerline.example.com"))
        assertEquals(AddressProblem.Cleartext, refused("http://203.0.113.7:8080"))
    }

    @Test
    fun plainHttpIsAcceptedOnlyWhenCleartextIsAllowed() {
        assertEquals("http://203.0.113.7:8080", valid("http://203.0.113.7:8080", cleartext = true))
        assertEquals("http://ledgerline.example.com", valid("http://ledgerline.example.com:80", cleartext = true))
    }

    @Test
    fun otherSchemesAreInvalid() {
        assertEquals(AddressProblem.Invalid, refused("ftp://ledgerline.example.com"))
        assertEquals(AddressProblem.Invalid, refused("javascript://x"))
        assertEquals(AddressProblem.Invalid, refused("https://"))
    }

    @Test
    fun textWithSpacesIsInvalid() = assertEquals(AddressProblem.Invalid, refused("my server"))

    @Test
    fun pathsQueriesFragmentsAndUserNamesAreRefused() {
        assertEquals(AddressProblem.Extras, refused("https://ledgerline.example.com/app"))
        assertEquals(AddressProblem.Extras, refused("https://ledgerline.example.com/?a=1"))
        assertEquals(AddressProblem.Extras, refused("https://ledgerline.example.com/#x"))
        assertEquals(AddressProblem.Extras, refused("https://you@ledgerline.example.com"))
    }
}
