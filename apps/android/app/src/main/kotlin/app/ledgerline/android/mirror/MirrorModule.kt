package app.ledgerline.android.mirror

import android.content.Context
import androidx.room.Room
import app.ledgerline.android.outbox.OutboxDao
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object MirrorModule {
    @Provides
    @Singleton
    fun database(@ApplicationContext context: Context): MirrorDatabase =
        // No destructive fallback: the outbox holds changes that exist nowhere else, so a missing migration must fail
        // loudly in testing rather than delete them.
        Room.databaseBuilder(context, MirrorDatabase::class.java, "mirror.db").build()

    @Provides
    fun dao(database: MirrorDatabase): MirrorDao = database.dao()

    @Provides
    fun outbox(database: MirrorDatabase): OutboxDao = database.outbox()

    @Provides
    fun reads(database: MirrorDatabase): MirrorReads = database.reads()
}
