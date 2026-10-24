package app.ledgerline.android.ui.design

import android.app.Application
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.requiredHeight
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import app.ledgerline.android.mirror.AccountBalance
import app.ledgerline.android.mirror.EntryLine
import app.ledgerline.android.online.Online
import app.ledgerline.android.overlay.ShownLine
import app.ledgerline.android.online.Paged
import app.ledgerline.android.ui.budgets.BudgetsContent
import app.ledgerline.android.ui.clients.ClientActions
import app.ledgerline.android.ui.clients.ClientContent
import app.ledgerline.android.ui.clients.ClientsListActions
import app.ledgerline.android.ui.clients.ClientsListContent
import app.ledgerline.android.ui.clients.contact
import app.ledgerline.android.ui.clients.event
import app.ledgerline.android.ui.clients.homeLoans
import app.ledgerline.android.ui.clients.loan
import app.ledgerline.android.ui.clients.payment
import app.ledgerline.android.ui.clients.person
import app.ledgerline.android.ui.clients.service
import app.ledgerline.android.ui.loans.LoansListActions
import app.ledgerline.android.ui.loans.LoansListContent
import app.ledgerline.android.ui.loans.PersonActions
import app.ledgerline.android.ui.loans.PersonContent
import app.ledgerline.api.Contact
import app.ledgerline.api.Service
import app.ledgerline.android.ui.budgets.budgetLine
import app.ledgerline.android.ui.budgets.budgetMonth
import app.ledgerline.android.ui.home.HomeContent
import app.ledgerline.android.ui.insights.CashFlowChart
import app.ledgerline.android.ui.insights.InsightsContent
import app.ledgerline.android.ui.insights.NetWorthChart
import app.ledgerline.android.ui.insights.insights
import app.ledgerline.android.ui.home.ListBottomSpace
import app.ledgerline.android.ui.home.Mirrored
import app.ledgerline.android.ui.home.SignedInFrame
import app.ledgerline.android.ui.home.SyncHeader
import app.ledgerline.android.ui.home.SyncLine
import app.ledgerline.android.ui.home.SyncStatus
import app.ledgerline.android.ui.home.Tab
import app.ledgerline.android.ui.home.TransactionsContent
import app.ledgerline.android.ui.home.homeSummary
import app.ledgerline.android.ui.more.MoreActions
import app.ledgerline.android.ui.more.MoreContent
import app.ledgerline.android.settings.FilterKeep
import app.ledgerline.android.settings.KeepMode
import app.ledgerline.android.settings.KeepUnit
import app.ledgerline.android.settings.ThemeChoice
import app.ledgerline.android.ui.editor.Choice
import app.ledgerline.android.mirror.EntryFilters
import app.ledgerline.android.ui.home.FilterOptions
import app.ledgerline.android.ui.editor.ComboField
import app.ledgerline.android.ui.editor.TagPicker
import app.ledgerline.android.ui.settings.SettingsActions
import app.ledgerline.android.ui.settings.SettingsContent
import app.ledgerline.android.ui.settings.SettingsState
import app.ledgerline.android.ui.settings.UpdatesInfo
import app.ledgerline.android.mirror.toRow
import app.ledgerline.android.ui.privacy.LocalPrivacy
import app.ledgerline.android.ui.theme.LedgerlineTheme
import app.ledgerline.api.HomeOwed
import app.ledgerline.api.Money
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.unit.dp
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Screenshots for design review (ADR 0045), not a comparison: every screen in its real frame at 320 and 390 dp,
 * light and dark, and with the largest font scale. Runs only with -Pledgerline.screenshots and writes PNGs to
 * app/build/outputs/roborazzi; the data is made up.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], application = Application::class)
class ScreenshotTest(private val width: Int, private val dark: Boolean, private val fontScale: Float) {
    companion object {
        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "{0}dp dark={1} font={2}")
        fun cases() = listOf(
            arrayOf<Any>(320, false, 1f),
            arrayOf<Any>(390, false, 1f),
            arrayOf<Any>(320, true, 1f),
            arrayOf<Any>(390, true, 1f),
            arrayOf<Any>(390, false, 2f),
        )
    }

    @Before
    fun screen() {
        assumeTrue("screenshots run with -Pledgerline.screenshots", System.getProperty("ledgerline.screenshots") == "true")
        RuntimeEnvironment.setQualifiers("w${width}dp-h1400dp-xxhdpi")
        RuntimeEnvironment.setFontScale(fontScale)
    }

    private fun shot(name: String, tab: Tab, private: Boolean = false, content: @Composable () -> Unit) {
        val theme = if (dark) "dark" else "light"
        captureRoboImage("build/outputs/roborazzi/$name-${width}dp-$theme-font$fontScale.png") {
            LedgerlineTheme(darkTheme = dark) {
                CompositionLocalProvider(LocalPrivacy provides private) {
                    SignedInFrame(tab, onSelect = {}, onAdd = {}) { inside ->
                        androidx.compose.foundation.layout.Box(inside) { content() }
                    }
                }
            }
        }
    }

    private val header: @Composable () -> Unit = {
        SyncHeader(SyncStatus(SyncLine("2026-10-22T10:42:00Z", running = false, problem = null), unsent = 1, attention = 0), {}, {})
    }

    @Test
    fun home() = shot("home", Tab.Home) {
        val month = homeSummary(590005).copy(
            moneyIn = Money(250000, "USD"),
            moneyOut = Money(71295, "USD"),
            owed = HomeOwed(Money(0, "USD"), 0, emptyList(), emptyList()),
            loans = homeSummary().loans.copy(lent = Money(0, "USD"), borrowed = Money(1250000, "USD")),
        )
        HomeContent(header, Online.Ready(month), {}, Mirrored.Ready(accounts), onOpenPending = {})
    }

    @Test
    fun homeOffline() = shot("home-offline", Tab.Home) { HomeContent(header, Online.Offline, {}, Mirrored.Ready(accounts.take(2)), onOpenPending = {}) }

    @Test
    fun transactions() = shot("transactions", Tab.Transactions) {
        TransactionsContent(header, Mirrored.Ready(entries), canShowMore = true, onShowMore = {}, EntryFilters(), filterOptions, false, {}, {}, onOpen = {})
    }

    private val filterOptions = FilterOptions(
        accounts = listOf(Choice("a1", "Everyday checking"), Choice("a2", "Wallet")),
        categories = listOf(Choice("c1", "Eating out"), Choice("c2", "Health")),
        tags = listOf(Choice("t1", "work"), Choice("t2", "trip")),
    )

    /** The filters open with several set, as after Home's pending note or an Insights row. */
    @Test
    fun transactionsFiltered() = shot("transactions-filtered", Tab.Transactions) {
        val filters = EntryFilters(text = "cafe", accountId = "a1", categoryId = "c1", from = "2026-10-01", to = "2026-10-31", status = "pending")
        TransactionsContent(header, Mirrored.Ready(entries.take(1)), canShowMore = false, onShowMore = {}, filters, filterOptions, true, {}, {}, onOpen = {})
    }

    @Test
    fun transactionsNoMatch() = shot("transactions-no-match", Tab.Transactions) {
        TransactionsContent(header, Mirrored.Ready(emptyList()), canShowMore = false, onShowMore = {}, EntryFilters(text = "zzz"), filterOptions, false, {}, {}, onOpen = {})
    }

    @Test
    fun transactionsBadRange() = shot("transactions-bad-range", Tab.Transactions) {
        val filters = EntryFilters(from = "2026-10-31", to = "2026-10-01")
        TransactionsContent(header, Mirrored.Ready(emptyList()), canShowMore = false, onShowMore = {}, filters, filterOptions, true, {}, {}, onOpen = {})
    }

    @Test
    fun budgets() = shot("budgets", Tab.Budgets) {
        val month = budgetMonth(
            items = listOf(
                budgetLine("Food", 30000, 12883, carriedIn = 30000),
                budgetLine("Fun", 1000, 16252),
                budgetLine("Home and garden with a long category name", 25000, 6299),
                budgetLine("Transport", 15000, 21000, carriedIn = -2500),
                budgetLine("Health", null, 1000),
                budgetLine("Gifts", null, 0),
            ),
        )
        BudgetsContent("2026-10", Online.Ready(month), {}, {}, {})
    }

    @Test
    fun budgetsOver() = shot("budgets-over", Tab.Budgets) {
        BudgetsContent("2026-10", Online.Ready(budgetMonth(items = listOf(budgetLine("Fun", 1000, 123456789)))), {}, {}, {})
    }

    @Test
    fun budgetsNone() = shot("budgets-none", Tab.Budgets) {
        BudgetsContent("2026-11", Online.Ready(budgetMonth("2026-11", listOf(budgetLine("Food", null, 0), budgetLine("Fun", null, 4200)))), {}, {}, {})
    }

    @Test
    fun budgetsOffline() = shot("budgets-offline", Tab.Budgets) { BudgetsContent("2026-10", Online.Offline, {}, {}, {}) }

    @Test
    fun insightsPage() = shot("insights", Tab.Insights) {
        InsightsContent("2026-10", Online.Ready(insights(worthMonths = 8)), open = setOf("c-food"), onToggle = {}, onOpenCategory = {}, onPrevious = {}, onNext = {}, onRetry = {})
    }

    /** The charts with their figures open, net worth with a month below zero and one missing a rate. */
    @Test
    fun insightsCharts() = shot("insights-charts", Tab.Insights) {
        val month = insights(spent = 123456789)
        val worth = month.netWorth.copy(
            months = month.netWorth.months.mapIndexed { i, row ->
                row.copy(netWorth = Money(-200000L + i * 90000, "USD"), unconvertedCurrencies = if (i == 9) listOf("EUR") else emptyList())
            },
        )
        androidx.compose.foundation.layout.Column(
            modifier = androidx.compose.ui.Modifier.verticalScroll(androidx.compose.foundation.rememberScrollState()),
            verticalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(8.dp),
        ) {
            CashFlowChart(month.cashFlow, "2026-10", open = true, onToggle = {})
            NetWorthChart(worth, "2026-10", open = true, onToggle = {})
        }
    }

    /** Net worth alone, so its chart and figures are in view: below zero at first, and one month missing a rate. */
    @Test
    fun insightsWorth() = shot("insights-worth", Tab.Insights) {
        val month = insights(worthMonths = 10)
        val worth = month.netWorth.copy(
            months = month.netWorth.months.mapIndexed { i, row ->
                row.copy(netWorth = Money(-200000L + i * 90000, "USD"), unconvertedCurrencies = if (i == 7) listOf("EUR") else emptyList())
            },
        )
        NetWorthChart(worth, "2026-10", open = true, onToggle = {})
    }

    @Test
    fun insightsHidden() = shot("insights-hidden", Tab.Insights, private = true) {
        androidx.compose.foundation.layout.Column(verticalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(8.dp)) {
            CashFlowChart(insights().cashFlow, "2026-10", open = false, onToggle = {})
            NetWorthChart(insights().netWorth, "2026-10", open = false, onToggle = {})
        }
    }

    @Test
    fun insightsOffline() = shot("insights-offline", Tab.Insights) {
        InsightsContent("2026-10", Online.Offline, open = emptySet(), onToggle = {}, onOpenCategory = {}, onPrevious = {}, onNext = {}, onRetry = {})
    }

    private val northwind = contact("Northwind Design", owed = 63000, oldest = "2026-09-21", phone = "555-0101", email = "accounts@northwind.example.com", note = "Invoices go out on the first of the month.")
    private val logo = service("Logo refresh, round two", 45000, date = "2026-10-02", time = "14:30", due = "2026-10-10")
    private val audit = service("Website audit", 30000, received = 12000, date = "2026-09-21", due = "2026-10-21")
    private val colours = service("Brand colours and type", 20000, received = 20000, date = "2026-09-02")
    private val photos = service("Menu photography with a rather long description", 8000, received = 5000, date = "2026-08-14", writtenOff = 3000, reason = "Rounded down as a thank-you")
    private val auditPayment = payment(audit, 12000, date = "2026-10-05", tip = 1000, note = "Paid by card")

    @Test
    fun clients() = shot("clients", Tab.More) {
        val rows = listOf(
            northwind,
            contact("Harbor Cafe"),
            contact("Overseas Print Shop", owed = 98000, oldest = "2026-10-01", balances = listOf(Money(80000, "EUR"), Money(18000, "USD")), unconverted = listOf("EUR")),
            contact("Willow Lane Studio with a long name", owed = 123456789, oldest = "2026-07-04", archived = true),
        )
        ClientsListContent("", "all", Online.Ready(Paged(rows, hasMore = true)), ClientsListActions({}, {}, {}, {}, {}, {}))
    }

    @Test
    fun clientsSearch() = shot("clients-search", Tab.More) {
        ClientsListContent("north", "all", Online.Ready(Paged(listOf(northwind), hasMore = false)), ClientsListActions({}, {}, {}, {}, {}, {}))
    }

    @Test
    fun clientsEmpty() = shot("clients-empty", Tab.More) {
        ClientsListContent("zzz", "all", Online.Ready(Paged(emptyList<Contact>(), hasMore = false)), ClientsListActions({}, {}, {}, {}, {}, {}))
    }

    @Test
    fun clientsOffline() = shot("clients-offline", Tab.More) { ClientsListContent("", "all", Online.Offline, ClientsListActions({}, {}, {}, {}, {}, {})) }

    @Test
    fun client() = shot("client", Tab.More) {
        ClientContent(
            Online.Ready(northwind),
            Online.Ready(Paged(listOf(logo, audit, colours, photos), hasMore = true)),
            Online.Loading,
            mapOf("website-audit" to Online.Ready(listOf(auditPayment))),
            today = "2026-10-23",
            actions = ClientActions({}, {}, {}, {}, {}, {}, {}, {}),
        )
    }

    @Test
    fun clientHistory() = shot("client-history", Tab.More) {
        val events = listOf(
            event("paymentCreated", audit, auditPayment, createdAt = "2026-10-23T09:09:00.000Z"),
            event("paymentEdited", audit, auditPayment, before = payment(audit, 10000), createdAt = "2026-10-22T09:09:00.000Z"),
            event("writtenOff", photos, createdAt = "2026-10-21T09:09:00.000Z"),
            event("created", logo, createdAt = "2026-10-02T09:09:00.000Z"),
        )
        ClientContent(
            Online.Ready(northwind.copy(oldestOpenServiceDate = null, phone = null, email = null, note = null)),
            Online.Ready(Paged(emptyList<Service>(), hasMore = false)),
            Online.Ready(Paged(events, hasMore = false)),
            emptyMap(),
            today = "2026-10-23",
            actions = ClientActions({}, {}, {}, {}, {}, {}, {}, {}),
        )
    }

    @Test
    fun loans() = shot("loans", Tab.More) {
        val rows = listOf(person("Sam Rivera", "USD" to 20000L), person("Jo Chen", "USD" to -15000L, "EUR" to 4000L), person("Casey Morgan"), person("Alex Settled", "USD" to 0L))
        LoansListContent(Online.Ready(homeLoans(20000, 15000)), "", "active", Online.Ready(Paged(rows, hasMore = false)), LoansListActions({}, {}, {}, {}, {}, {}))
    }

    @Test
    fun loan() = shot("loan", Tab.More) {
        PersonContent(
            Online.Ready(contact("Jo Chen", origin = "loan")),
            Online.Ready(listOf(loan("USD", -15000, opening = -5000), loan("EUR", 4000), loan("GBP", 0))),
            PersonActions({}, {}, {}),
        )
    }

    @Test
    fun more() = shot("more", Tab.More) { MoreContent(MoreActions({}, {}, {}, {}), ListBottomSpace) }

    private val longNotes = "Check for updates from Settings, or let the app look when it opens.\n" +
        "- See what is new before you download.\n" +
        "- The file is checked against the release and the signing key before Android is asked to install it.\n" +
        "- Filters on Transactions can stay for as long as you choose.\n" +
        "- Fixes for lists that did not line up at the largest text size."

    private val sampleRelease = app.ledgerline.android.update.Release(
        "android-v0.1.3", "0.1.3", 103, longNotes, "ledgerline-android-0.1.3.apk", 12_582_912, "ledgerline-android-0.1.3.apk.sha256",
    )

    private fun updateScreen(name: String, state: app.ledgerline.android.update.UpdateState) = shot(name, Tab.More) {
        app.ledgerline.android.ui.update.UpdateContent("0.1.2", state, app.ledgerline.android.ui.update.UpdateActions({}, {}, {}, {}, {}), ListBottomSpace)
    }

    @Test
    fun updateAvailable() = updateScreen("update-available", app.ledgerline.android.update.UpdateState.Available(sampleRelease))

    @Test
    fun updateDownloading() = updateScreen("update-downloading", app.ledgerline.android.update.UpdateState.Downloading(sampleRelease, 6_291_456))

    @Test
    fun updateReady() = updateScreen("update-ready", app.ledgerline.android.update.UpdateState.Ready(sampleRelease, needsPermission = true))

    @Test
    fun updateRefused() = updateScreen(
        "update-refused",
        app.ledgerline.android.update.UpdateState.Failed(
            app.ledgerline.android.update.UpdateProblem.Refused(app.ledgerline.android.update.Refusal.WrongCertificate),
            sampleRelease,
        ),
    )

    @Test
    fun updateUpToDate() = updateScreen("update-up-to-date", app.ledgerline.android.update.UpdateState.UpToDate)

    @Test
    fun homeWithUpdateNotice() = shot("home-update", Tab.Home) {
        val month = homeSummary(590005)
        HomeContent(
            header, Online.Ready(month), {}, Mirrored.Ready(accounts.take(2)), onOpenPending = {},
            banner = { app.ledgerline.android.ui.update.UpdateNotice("0.1.3", {}, {}, androidx.compose.ui.Modifier.padding(top = 12.dp)) },
        )
    }

    @Test
    fun moreWithUpdateNotice() = shot("more-update", Tab.More) {
        MoreContent(MoreActions({}, {}, {}, {}), ListBottomSpace, notice = { app.ledgerline.android.ui.update.UpdateNotice("0.1.3", {}, {}) })
    }

    private val categoryItems = listOf(
        app.ledgerline.android.mirror.syncCategory(1, "Food and groceries for the whole household").toRow("l"),
        app.ledgerline.android.mirror.syncCategory(2, "Groceries", parentN = 1).toRow("l"),
        app.ledgerline.android.mirror.syncCategory(3, "Dining out", parentN = 1, archived = true).toRow("l"),
        app.ledgerline.android.mirror.syncCategory(4, "Transport").toRow("l"),
        app.ledgerline.android.mirror.syncCategory(5, "Old project", archived = true).toRow("l"),
        app.ledgerline.android.mirror.syncCategory(6, "Salary", kind = "income").toRow("l"),
    )

    private fun categoriesShot(name: String, view: app.ledgerline.android.ui.categories.CategoriesView, items: List<app.ledgerline.android.mirror.CategoryRow> = categoryItems) = shot(name, Tab.More) {
        val actions = app.ledgerline.android.ui.categories.CategoriesActions({}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {})
        app.ledgerline.android.ui.categories.CategoriesContent(
            view,
            app.ledgerline.android.ui.categories.categoryGroups(items, view.kind, view.status, view.search),
            items,
            actions,
            ListBottomSpace,
        )
    }

    @Test
    fun categories() = categoriesShot("categories", app.ledgerline.android.ui.categories.CategoriesView())

    @Test
    fun categoriesEmpty() = categoriesShot("categories-empty", app.ledgerline.android.ui.categories.CategoriesView(), emptyList())

    @Test
    fun categoryAdd() = categoriesShot(
        "category-add",
        app.ledgerline.android.ui.categories.CategoriesView(form = app.ledgerline.android.ui.categories.CategoryForm.forNew("expense").copy(name = "Pets", parentId = categoryItems[3].id)),
    )

    @Test
    fun categoryEditWithAnError() = categoriesShot(
        "category-edit-error",
        app.ledgerline.android.ui.categories.CategoriesView(
            form = app.ledgerline.android.ui.categories.CategoryForm.forEdit(categoryItems[1]).copy(name = "Dining out"),
            error = app.ledgerline.android.ui.categories.CategoryError.Rejected("A sibling category already has this name, including archived categories."),
        ),
    )

    @Test
    fun categoryEditMainWithSubcategories() = categoriesShot(
        "category-edit-main",
        app.ledgerline.android.ui.categories.CategoriesView(form = app.ledgerline.android.ui.categories.CategoryForm.forEdit(categoryItems[0])),
    )

    @Test
    fun settingsUpdates() = shot("settings-updates", Tab.More) {
        SettingsContent(
            SettingsState(ThemeChoice.System, hideAmounts = false, centsFirst = true, allowScreenshots = false, filterKeep = FilterKeep(), updates = UpdatesInfo(auto = false, newVersion = "0.1.3"), unsent = 0, attention = 0, canLock = true, signingOut = false),
            SettingsActions({}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}),
            ListBottomSpace,
            // The Updates card sits below the first screen of Settings; shift the page up so this shot shows it.
            androidx.compose.ui.Modifier.requiredHeight(2800.dp).offset(y = (-760).dp),
        )
    }

    @Test
    fun settings() = shot("settings", Tab.More) {
        SettingsContent(
            SettingsState(ThemeChoice.System, hideAmounts = false, centsFirst = true, allowScreenshots = false, filterKeep = FilterKeep(KeepMode.ForAWhile, 30, KeepUnit.Minutes), updates = UpdatesInfo(auto = true, newVersion = "0.1.3"), unsent = 0, attention = 2, canLock = true, signingOut = false),
            SettingsActions({}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}),
            ListBottomSpace,
        )
    }

    private fun newCategoryShot(name: String, box: app.ledgerline.android.ui.editor.NewCategory?) = shot(name, Tab.Home) {
        androidx.compose.foundation.layout.Column(
            modifier = androidx.compose.ui.Modifier.padding(16.dp),
            verticalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(16.dp),
        ) {
            ComboField("Category", listOf(Choice("a", "Food"), Choice("a1", "Food › Groceries")), "a1", {}, "No matching categories.")
            app.ledgerline.android.ui.editor.NewCategoryBox(box, {}, {}, {})
        }
    }

    @Test
    fun newCategoryClosed() = newCategoryShot("new-category-closed", null)

    @Test
    fun newCategoryOpen() = newCategoryShot("new-category-open", app.ledgerline.android.ui.editor.NewCategory("Pets"))

    @Test
    fun newCategoryWithAnError() = newCategoryShot(
        "new-category-error",
        app.ledgerline.android.ui.editor.NewCategory(
            "Food",
            error = app.ledgerline.android.ui.categories.CategoryError.Rejected("A sibling category already has this name, including archived categories."),
        ),
    )

    @Test
    fun pickers() = shot("pickers", Tab.Home) {
        val tags = listOf(Choice("t1", "work"), Choice("t2", "weekend trip"), Choice("t3", "an old tag", archived = true), Choice("t4", "home"))
        androidx.compose.foundation.layout.Column(
            modifier = androidx.compose.ui.Modifier.padding(16.dp),
            verticalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(16.dp),
        ) {
            ComboField("Category", listOf(Choice("a", "Food"), Choice("a1", "Food › Groceries")), "a1", {}, "No matching categories.")
            ComboField("Category", emptyList(), null, {}, "No matching categories.", error = "Choose a category.", placeholder = "Choose a category")
            TagPicker(tags, listOf("t1", "t2", "t3"), {}, {})
        }
    }

    private val accounts = listOf(
        AccountBalance("a1", "Everyday checking", "bank", "USD", null, null, 365937, 0),
        AccountBalance("a2", "Wallet", "cash", "USD", null, null, -3800, 1),
        AccountBalance("a3", "Rainy day savings account with a long name", "savings", "USD", null, null, 1250000000, 0),
        AccountBalance("a4", "Travel card", "card", "EUR", null, null, -45210, 0),
        AccountBalance("a5", "Old account", "bank", "USD", "2026-01-01T00:00:00Z", null, 0, 0),
    )

    private fun entry(id: String, date: String, kind: String, amount: Long, payee: String?, category: String?, account: String, status: String = "cleared", tags: String? = null, split: Boolean = false) =
        EntryLine(id, date, null, kind, split, status, amount, "USD", payee, account, category, tags, if (kind == "transfer") "t$id" else null, "${date}T10:00:00Z")

    private val entries = listOf(
        ShownLine(entry("e1", "2026-10-22", "expense", -5100, "Corner cafe", "Eating out", "Everyday checking", tags = "work, trip"), unsent = true),
        ShownLine(entry("e2", "2026-10-22", "expense", -1234, "Pharmacy", "Health", "Everyday checking", status = "pending"), unsent = false),
        ShownLine(entry("e3", "2026-10-22", "transfer", -4800, null, null, "Everyday checking"), unsent = false),
        ShownLine(entry("e4", "2026-10-21", "income", 250000, "Payroll", "Salary", "Everyday checking"), unsent = false),
        ShownLine(entry("e5", "2026-10-21", "expense", -3000, "Market", null, "Wallet", split = true), unsent = false),
        ShownLine(entry("e6", "2026-10-20", "expense", -123456789, "A very long payee name that keeps going and going", "Home and garden", "Rainy day savings account with a long name"), unsent = false),
    )
}
