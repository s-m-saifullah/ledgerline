package app.ledgerline.android.server

import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent

@Module
@InstallIn(SingletonComponent::class)
abstract class ServerModule {
    @Binds
    abstract fun bindServerAddressStore(store: DataStoreServerAddressStore): ServerAddressStore
}
