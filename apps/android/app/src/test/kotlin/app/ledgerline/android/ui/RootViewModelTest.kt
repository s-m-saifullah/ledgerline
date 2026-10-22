package app.ledgerline.android.ui

import app.ledgerline.android.RootState
import app.ledgerline.android.RootViewModel
import app.ledgerline.android.session.SessionManager
import app.ledgerline.android.testing.FakeClock
import app.ledgerline.android.testing.FakeTokenProtector
import app.ledgerline.android.testing.FakeServerAddressStore
import app.ledgerline.api.SessionToken
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class RootViewModelTest {
    @Before
    fun setUp() = Dispatchers.setMain(UnconfinedTestDispatcher())

    @After
    fun tearDown() = Dispatchers.resetMain()

    private fun TestScope.watch(model: RootViewModel) {
        model.state.onEach { }.launchIn(backgroundScope)
        testScheduler.runCurrent()
    }

    @Test
    fun noAddressAsksForOne() = runTest {
        val model = RootViewModel(FakeServerAddressStore(null), SessionManager(FakeTokenProtector(), FakeClock()))
        watch(model)
        assertEquals(RootState.Address(canCancel = false), model.state.value)
    }

    @Test
    fun anAddressWithoutASessionAsksToSignIn() = runTest {
        val model = RootViewModel(FakeServerAddressStore("https://ledgerline.example.com"), SessionManager(FakeTokenProtector(), FakeClock()))
        watch(model)
        assertEquals(RootState.SignIn("https://ledgerline.example.com"), model.state.value)
    }

    @Test
    fun aSessionShowsTheSignedInScreenAndClearingItReturnsToSignIn() = runTest {
        val session = SessionManager(FakeTokenProtector(), FakeClock())
        val model = RootViewModel(FakeServerAddressStore("https://ledgerline.example.com"), session)
        watch(model)
        session.signedIn(SessionToken("t"))
        testScheduler.runCurrent()
        assertEquals(RootState.Offer, model.state.value)
        session.skipProtect()
        testScheduler.runCurrent()
        assertEquals(RootState.SignedIn("https://ledgerline.example.com"), model.state.value)
        session.endSession()
        testScheduler.runCurrent()
        assertEquals(RootState.SignIn("https://ledgerline.example.com"), model.state.value)
    }

    @Test
    fun aStoredSessionShowsTheLockScreenFirst() = runTest {
        val protector = FakeTokenProtector(stored = SessionToken("t"))
        val model = RootViewModel(FakeServerAddressStore("https://ledgerline.example.com"), SessionManager(protector, FakeClock()))
        watch(model)
        assertEquals(RootState.Locked, model.state.value)
    }

    @Test
    fun changingTheAddressShowsTheFormWithCancelUntilDone() = runTest {
        val model = RootViewModel(FakeServerAddressStore("https://ledgerline.example.com"), SessionManager(FakeTokenProtector(), FakeClock()))
        watch(model)
        model.changeAddress()
        testScheduler.runCurrent()
        assertEquals(RootState.Address(canCancel = true), model.state.value)
        model.addressDone()
        testScheduler.runCurrent()
        assertEquals(RootState.SignIn("https://ledgerline.example.com"), model.state.value)
    }
}
