package app.ledgerline.android.testing

import app.ledgerline.android.server.ServerAddressStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow

class FakeServerAddressStore(initial: String? = null) : ServerAddressStore {
    val state = MutableStateFlow(initial)
    override val origin: Flow<String?> = state

    override suspend fun save(origin: String) {
        state.value = origin
    }

    override suspend fun clear() {
        state.value = null
    }
}

class FakeClock(var now: Long = 0) : app.ledgerline.android.session.Clock {
    override fun nowMillis() = now
}

/** A protector whose outcomes the test chooses; "stored" mirrors what the real one keeps on the phone. */
class FakeTokenProtector(
    var protection: app.ledgerline.android.session.Protection = app.ledgerline.android.session.Protection.Available,
    stored: app.ledgerline.api.SessionToken? = null,
) : app.ledgerline.android.session.TokenProtector {
    var stored: app.ledgerline.api.SessionToken? = stored
    var protectResult: app.ledgerline.android.session.ProtectOutcome? = null
    var unlockResult: app.ledgerline.android.session.UnlockOutcome? = null
    var discardCount = 0
    var unlockPrompts = 0
    var syncReads = 0

    override fun protection() = protection

    override fun hasStored() = stored != null

    override suspend fun protect(token: app.ledgerline.api.SessionToken): app.ledgerline.android.session.ProtectOutcome {
        val result = protectResult ?: app.ledgerline.android.session.ProtectOutcome.Saved
        if (result == app.ledgerline.android.session.ProtectOutcome.Saved) stored = token
        return result
    }

    override fun readForSync(): app.ledgerline.api.SessionToken? {
        syncReads++
        return if (protection == app.ledgerline.android.session.Protection.Available) stored else null
    }

    override suspend fun unlock(): app.ledgerline.android.session.UnlockOutcome {
        unlockPrompts++
        return unlockResult ?: stored?.let { app.ledgerline.android.session.UnlockOutcome.Unlocked(it) }
            ?: app.ledgerline.android.session.UnlockOutcome.KeyLost
    }

    override fun discard() {
        stored = null
        discardCount++
    }
}

/** The phone's own choices, in memory. */
class FakePhoneSettings(keep: app.ledgerline.android.settings.FilterKeep = app.ledgerline.android.settings.FilterKeep()) :
    app.ledgerline.android.settings.PhoneSettings {
    override val privacyMode = kotlinx.coroutines.flow.MutableStateFlow(false)
    override val allowScreenshots = kotlinx.coroutines.flow.MutableStateFlow(false)
    override val theme = kotlinx.coroutines.flow.MutableStateFlow(app.ledgerline.android.settings.ThemeChoice.System)
    override val centsFirst = kotlinx.coroutines.flow.MutableStateFlow(false)
    override val filterKeep = kotlinx.coroutines.flow.MutableStateFlow(keep)

    override fun setPrivacyMode(on: Boolean) { privacyMode.value = on }

    override fun setAllowScreenshots(allow: Boolean) { allowScreenshots.value = allow }

    override fun setTheme(choice: app.ledgerline.android.settings.ThemeChoice) { theme.value = choice }

    override fun setCentsFirst(on: Boolean) { centsFirst.value = on }

    override fun setFilterKeep(keep: app.ledgerline.android.settings.FilterKeep) { filterKeep.value = keep }
}

/** Filters kept for a chosen time, in memory; [saved] is what a closed app would find. */
class FakeFilterStore(var saved: app.ledgerline.android.settings.SavedFilters? = null) : app.ledgerline.android.settings.FilterStore {
    override fun load() = saved

    override fun save(saved: app.ledgerline.android.settings.SavedFilters) { this.saved = saved }

    override fun clear() { saved = null }
}
