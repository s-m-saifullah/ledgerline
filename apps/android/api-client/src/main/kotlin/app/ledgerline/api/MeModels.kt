package app.ledgerline.api

import kotlinx.serialization.Serializable

/*
 * The signed-in person (ADR 0048, ADR 0050). The phone asks once, right after a sign-in, whether the person is still
 * on a temporary password: every other route answers 403 until they change it on the web. The contract sends every
 * property, so the type has no defaults; the app reads only `mustChangePassword`.
 */

/** `GET /api/v1/me`: the person and their own account. Never carries a password, a hash or a token. */
@Serializable
data class Me(
    val id: String,
    val name: String,
    val email: String,
    val isAdmin: Boolean,
    val mustChangePassword: Boolean,
    val twoFactorEnabled: Boolean,
)
