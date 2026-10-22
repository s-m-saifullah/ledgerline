package app.ledgerline.android.server

import java.net.URI
import java.net.URISyntaxException

/** Why an address typed by the owner was refused. */
enum class AddressProblem { Empty, Invalid, Cleartext, Extras }

sealed interface AddressResult {
    /** [origin] is exactly what the app sends as `Origin`, e.g. `https://ledgerline.example.com`. */
    data class Valid(val origin: String) : AddressResult
    data class Refused(val problem: AddressProblem) : AddressResult
}

/**
 * Turns what the owner typed into the server's origin. The app is self-hosted, so nothing is built in.
 * `https://` is assumed when no scheme is typed; plain `http://` is accepted only when [allowCleartext] is
 * true (debug builds, to try a scratch server). The address is the origin only: no user name, path, query or
 * fragment, because the server checks `Origin` against its own address.
 */
fun parseServerAddress(input: String, allowCleartext: Boolean): AddressResult {
    val text = input.trim()
    if (text.isEmpty()) return AddressResult.Refused(AddressProblem.Empty)
    if (text.any { it.isWhitespace() || it.isISOControl() }) return AddressResult.Refused(AddressProblem.Invalid)

    val schemeEnd = text.indexOf("://")
    val withScheme = if (schemeEnd >= 0) text else "https://$text"
    val uri = try {
        URI(withScheme)
    } catch (_: URISyntaxException) {
        return AddressResult.Refused(AddressProblem.Invalid)
    }

    val scheme = uri.scheme?.lowercase()
    val host = uri.host?.lowercase()
    if (host.isNullOrEmpty() || (scheme != "https" && scheme != "http")) return AddressResult.Refused(AddressProblem.Invalid)
    if (scheme == "http" && !allowCleartext) return AddressResult.Refused(AddressProblem.Cleartext)
    if (uri.rawUserInfo != null || uri.rawQuery != null || uri.rawFragment != null ||
        !(uri.rawPath.isNullOrEmpty() || uri.rawPath == "/")
    ) {
        return AddressResult.Refused(AddressProblem.Extras)
    }

    val defaultPort = if (scheme == "https") 443 else 80
    val port = if (uri.port == -1 || uri.port == defaultPort) "" else ":${uri.port}"
    return AddressResult.Valid("$scheme://$host$port")
}
