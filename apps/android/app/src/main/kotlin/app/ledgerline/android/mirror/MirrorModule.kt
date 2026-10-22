package app.ledgerline.android.mirror

import android.content.Context
import androidx.room.Room
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
        Room.databaseBuilder(context, MirrorDatabase::class.java, "mirror.db")
            // A cache: after a schema change the next pull rebuilds it. Revisit with slice 4 (outbox).
            .fallbackToDestructiveMigration(dropAllTables = true)
            .build()

    @Provides
    fun dao(database: MirrorDatabase): MirrorDao = database.dao()

    @Provides
    fun reads(database: MirrorDatabase): MirrorReads = database.reads()
}
