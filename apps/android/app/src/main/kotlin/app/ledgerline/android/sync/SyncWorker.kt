package app.ledgerline.android.sync

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.components.SingletonComponent

@EntryPoint
@InstallIn(SingletonComponent::class)
interface SyncEntryPoint {
    fun coordinator(): SyncCoordinator
}

/** The periodic background pull. All decisions live in [SyncCoordinator.backgroundPull]. */
class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val coordinator = EntryPointAccessors.fromApplication(applicationContext, SyncEntryPoint::class.java).coordinator()
        return when (coordinator.backgroundPull(runAttemptCount)) {
            BackgroundOutcome.Retry -> Result.retry()
            BackgroundOutcome.Done, BackgroundOutcome.Stop -> Result.success()
        }
    }
}
