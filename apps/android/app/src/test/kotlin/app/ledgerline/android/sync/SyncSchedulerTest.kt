package app.ledgerline.android.sync

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.work.NetworkType
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.testing.WorkManagerTestInitHelper
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class SyncSchedulerTest {
    private lateinit var context: Context

    @Before
    fun init() {
        context = ApplicationProvider.getApplicationContext()
        WorkManagerTestInitHelper.initializeTestWorkManager(context)
    }

    private fun jobs(): List<WorkInfo> =
        WorkManager.getInstance(context).getWorkInfosForUniqueWork(WorkSyncScheduler.WorkName).get()

    @Test
    fun queuesOneJobEvery15MinutesThatNeedsANetworkAndAskingAgainChangesNothing() {
        val scheduler = WorkSyncScheduler(context)
        scheduler.schedule()
        scheduler.schedule()
        val job = jobs().single()
        assertEquals(WorkInfo.State.ENQUEUED, job.state)
        assertEquals(NetworkType.CONNECTED, job.constraints.requiredNetworkType)
        assertEquals(TimeUnit.MINUTES.toMillis(15), job.periodicityInfo?.repeatIntervalMillis)
    }

    @Test
    fun cancellingRemovesTheJob() {
        val scheduler = WorkSyncScheduler(context)
        scheduler.schedule()
        scheduler.cancel()
        assertTrue(jobs().all { it.state == WorkInfo.State.CANCELLED })
    }
}
