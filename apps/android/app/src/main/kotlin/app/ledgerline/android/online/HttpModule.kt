package app.ledgerline.android.online

import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import okhttp3.OkHttpClient
import javax.inject.Singleton

/**
 * The one HTTP client the app builds its others from (WP-19b): a client made with `newBuilder()` shares this one's connection
 * pool and threads, so the screens, the background sync, the sign-in step and the update check reuse one connection instead
 * of opening one each. Each of them still adds its own headers and limits.
 */
@Module
@InstallIn(SingletonComponent::class)
object HttpModule {
    @Provides
    @Singleton
    fun baseClient(): OkHttpClient = OkHttpClient()
}
