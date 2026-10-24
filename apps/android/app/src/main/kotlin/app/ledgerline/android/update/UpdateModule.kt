package app.ledgerline.android.update

import android.content.Context
import app.ledgerline.android.BuildConfig
import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import okhttp3.OkHttpClient
import java.io.File
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
abstract class UpdateBindings {
    @Binds
    abstract fun bindStore(store: PrefsUpdateStore): UpdateStore

    @Binds
    abstract fun bindInstaller(installer: PackageUpdateInstaller): UpdateInstaller

    @Binds
    abstract fun bindReader(reader: AndroidApkReader): ApkReader

    companion object {
        @Provides
        @Singleton
        fun config() = UpdateConfig(
            repo = BuildConfig.UPDATE_REPO,
            apiBase = BuildConfig.UPDATE_API_BASE,
            downloadBase = BuildConfig.UPDATE_DOWNLOAD_BASE,
            certPin = BuildConfig.UPDATE_CERT_SHA256,
            allowCleartext = BuildConfig.ALLOW_CLEARTEXT,
        )

        /** One object is both the list reader and the file fetcher. The User-Agent is the app's name and version, no phone model. */
        @Provides
        @Singleton
        fun github(config: UpdateConfig, @ApplicationContext context: Context): GithubUpdateSource =
            GithubUpdateSource(OkHttpClient(), config, "Ledgerline-Android/${BuildConfig.VERSION_NAME}", File(context.cacheDir, "update").apply { mkdirs() })

        @Provides
        fun source(github: GithubUpdateSource): UpdateSource = github

        @Provides
        fun files(github: GithubUpdateSource): UpdateFiles = github

        @Provides
        fun wallClock(): WallClock = WallClock { System.currentTimeMillis() }

        @Provides
        fun installed(@ApplicationContext context: Context) =
            InstalledApp(BuildConfig.VERSION_CODE, BuildConfig.VERSION_NAME.removeSuffix("-debug"), context.packageName)
    }
}
