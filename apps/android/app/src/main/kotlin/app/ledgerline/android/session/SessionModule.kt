package app.ledgerline.android.session

import android.os.SystemClock
import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent

@Module
@InstallIn(SingletonComponent::class)
abstract class SessionModule {
    @Binds
    abstract fun bindTokenProtector(protector: KeystoreTokenProtector): TokenProtector

    companion object {
        /** Time that keeps counting while the phone sleeps and cannot be set back by the owner. */
        @Provides
        fun clock(): Clock = Clock { SystemClock.elapsedRealtime() }
    }
}
