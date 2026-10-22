package app.ledgerline.android.sync

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/** Runs the background pull now and then. Only a session kept on the phone has one. */
interface SyncScheduler {
    /** Makes sure the periodic pull is queued (a second call changes nothing). */
    fun schedule()

    fun cancel()
}

@Singleton
class WorkSyncScheduler @Inject constructor(@ApplicationContext private val context: Context) : SyncScheduler {
    override fun schedule() {
        val request = PeriodicWorkRequestBuilder<SyncWorker>(IntervalMinutes, TimeUnit.MINUTES)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, BackoffMinutes, TimeUnit.MINUTES)
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(WorkName, ExistingPeriodicWorkPolicy.KEEP, request)
    }

    override fun cancel() {
        WorkManager.getInstance(context).cancelUniqueWork(WorkName)
    }

    companion object {
        const val WorkName = "mirror-pull"
        const val IntervalMinutes = 15L
        const val BackoffMinutes = 5L
    }
}

@Module
@InstallIn(SingletonComponent::class)
abstract class SyncSchedulerModule {
    @Binds
    abstract fun bindScheduler(scheduler: WorkSyncScheduler): SyncScheduler
}
