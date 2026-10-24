package app.ledgerline.android.ui.home

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FabPosition
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.sp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import app.ledgerline.android.R
import app.ledgerline.android.mirror.EntryFilters
import app.ledgerline.android.mirror.EntryLine
import app.ledgerline.android.ui.budgets.BudgetsContent
import app.ledgerline.android.ui.budgets.BudgetsViewModel
import app.ledgerline.android.ui.design.LinkButton
import app.ledgerline.android.ui.design.ScreenMargin
import app.ledgerline.android.ui.design.SecondaryButton
import app.ledgerline.android.ui.editor.EditorScreen
import app.ledgerline.android.ui.editor.EditorTarget
import app.ledgerline.android.ui.format.formatUpdated
import app.ledgerline.android.ui.clients.ClientsScreen
import app.ledgerline.android.ui.insights.InsightsContent
import app.ledgerline.android.ui.loans.LoansScreen
import app.ledgerline.android.ui.insights.InsightsViewModel
import app.ledgerline.android.ui.more.MoreActions
import app.ledgerline.android.ui.more.MoreContent
import app.ledgerline.android.ui.categories.CategoriesScreen
import app.ledgerline.android.ui.settings.SettingsScreen
import app.ledgerline.android.ui.update.UpdateNotice
import app.ledgerline.android.ui.update.UpdateScreen
import app.ledgerline.android.ui.update.UpdateViewModel
import androidx.compose.runtime.LaunchedEffect
import java.util.UUID

/** The bottom bar, as on the web: Home, Transactions, Budgets, Insights and More (ADR 0043, slice 5). */
enum class Tab(val title: Int, val icon: Int) {
    Home(R.string.home_title, R.drawable.ic_home),
    Transactions(R.string.entries_title, R.drawable.ic_entries),
    Budgets(R.string.budgets_title, R.drawable.ic_budgets),
    Insights(R.string.insights_title, R.drawable.ic_insights),
    More(R.string.more_title, R.drawable.ic_more),
}

/** Room under every list for the Add button, so it never covers the last row. */
internal val ListBottomSpace = 96.dp

/**
 * The signed-in app: the mirrored accounts and entries, entries made offline, and More. Each tab's content is
 * a stateless function of plain data (ADR 0045), so it can be rendered for screenshots without view models.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SignedInScreen(
    viewModel: SignedInViewModel = hiltViewModel(),
    home: HomeViewModel = hiltViewModel(),
    budgets: BudgetsViewModel = hiltViewModel(),
    insights: InsightsViewModel = hiltViewModel(),
    update: UpdateViewModel = hiltViewModel(),
    settings: app.ledgerline.android.ui.settings.SettingsViewModel = hiltViewModel(),
) {
    val privacy = app.ledgerline.android.ui.privacy.LocalPrivacy.current
    var tab by rememberSaveable { mutableStateOf(Tab.Home) }
    // Once when the app opens (after the lock screen): the manager applies the switch, the day limit and the connection.
    LaunchedEffect(Unit) { update.checkOnLaunch() }
    val notice by update.notice.collectAsState()
    // A time chosen for the filters may have run out while the app was in the background.
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { viewModel.expireFilters() }
    var showAttention by rememberSaveable { mutableStateOf(false) }
    var editing by rememberSaveable { mutableStateOf<String?>(null) }
    // What is open on Insights (a category's subcategories, a chart's figures); a list, so it can be saved.
    var openInsights by rememberSaveable { mutableStateOf(listOf<String>()) }
    // What More has open: "clients", "loans", "categories", "update", "settings" or nothing (More itself).
    var moreOpen by rememberSaveable { mutableStateOf<String?>(null) }
    // Whether Transactions' "Filter entries" section is open.
    var filtersOpen by rememberSaveable { mutableStateOf(false) }
    // The currency Home's accounts are narrowed to (null: all), when there are accounts in more than one.
    var currency by rememberSaveable { mutableStateOf<String?>(null) }
    val line by viewModel.syncLine.collectAsState()
    val unsent by viewModel.unsent.collectAsState()
    val attention by viewModel.attention.collectAsState()
    val confirmSignOut by viewModel.confirmSignOut.collectAsState()
    confirmSignOut?.let { waiting -> SignOutQuestion(waiting, viewModel) }
    editing?.let { opened ->
        // "<session>|<target>": every opening of the editor gets its own session.
        val (session, target) = opened.split("|", limit = 2)
        EditorScreen(EditorTarget.decode(target), session, onClose = { editing = null })
        return
    }
    val edit = { target: EditorTarget -> editing = "${UUID.randomUUID()}|${target.encode()}" }
    if (showAttention) {
        BackHandler { showAttention = false }
        AttentionScreen(viewModel, onBack = { showAttention = false }, onFix = { edit(EditorTarget.Fix(it)) })
        return
    }
    val status = SyncStatus(line, unsent, attention.size)
    // Home's pending note and Insights' category rows open Transactions already narrowed (the filters live in the view model).
    val openEntries = { filters: EntryFilters ->
        viewModel.setFilters(filters)
        tab = Tab.Transactions
    }
    SignedInFrame(tab, onSelect = {
        if (it == Tab.More) moreOpen = null
        // Filters chosen to last until the owner leaves Transactions end here; a chosen time is checked on arriving.
        if (tab == Tab.Transactions && it != Tab.Transactions) viewModel.leftTransactions()
        if (it == Tab.Transactions) viewModel.expireFilters()
        tab = it
    }, onAdd = { edit(EditorTarget.New()) }) { inside ->
        when (tab) {
            Tab.Home, Tab.Transactions -> PullToRefreshBox(
                isRefreshing = line.running,
                onRefresh = {
                    viewModel.refresh()
                    if (tab == Tab.Home) home.retry()
                },
                modifier = inside,
            ) {
                if (tab == Tab.Home) {
                    val month by home.month.collectAsState()
                    val accounts by viewModel.accounts.collectAsState()
                    HomeContent(
                        status, month, accounts, currency, hidden = privacy,
                        actions = HomeActions(
                            onRetry = home::retry,
                            onOpenPending = { openEntries(PendingEntries) },
                            onOpenInsights = { tab = Tab.Insights },
                            onSelectCurrency = { currency = it },
                            onToggleHide = { settings.setPrivacyMode(!privacy) },
                            onRetrySync = viewModel::refresh,
                            onOpenAttention = { showAttention = true },
                        ),
                        banner = notice?.let { release ->
                            {
                                UpdateNotice(
                                    release.name,
                                    onOpen = { tab = Tab.More; moreOpen = "update" },
                                    onDismiss = update::dismissNotice,
                                )
                            }
                        },
                    )
                } else {
                    val entries by viewModel.entries.collectAsState()
                    val canShowMore by viewModel.canShowMore.collectAsState()
                    val filters by viewModel.filters.collectAsState()
                    val options by viewModel.filterOptions.collectAsState()
                    TransactionsContent(
                        status, entries, canShowMore, viewModel::showMoreEntries,
                        filters, options, filtersOpen, { filtersOpen = !filtersOpen }, viewModel::setFilters,
                        onRetrySync = viewModel::refresh, onOpenAttention = { showAttention = true },
                    ) { line: EntryLine ->
                        edit(
                            if (line.kind == "transfer" && line.transferId != null) {
                                EditorTarget.Transfer(line.transferId)
                            } else {
                                EditorTarget.Entry(line.id)
                            },
                        )
                    }
                }
            }
            Tab.Budgets -> PullToRefreshBox(
                isRefreshing = line.running,
                onRefresh = {
                    viewModel.refresh()
                    budgets.retry()
                },
                modifier = inside,
            ) {
                // Collecting the budgets is what reads them, so they are read only while this tab is open.
                val month by budgets.month.collectAsState()
                val state by budgets.budgets.collectAsState()
                BudgetsContent(month.toString(), state, budgets::previous, budgets::next, budgets::retry)
            }
            Tab.Insights -> PullToRefreshBox(
                isRefreshing = line.running,
                onRefresh = {
                    viewModel.refresh()
                    insights.retry()
                },
                modifier = inside,
            ) {
                val month by insights.month.collectAsState()
                val state by insights.insights.collectAsState()
                InsightsContent(
                    month.toString(),
                    state,
                    open = openInsights.toSet(),
                    onToggle = { key -> openInsights = if (key in openInsights) openInsights - key else openInsights + key },
                    onOpenCategory = { categoryId -> openEntries(categoryEntries(categoryId, month)) },
                    onPrevious = insights::previous,
                    onNext = insights::next,
                    onRetry = insights::retry,
                )
            }
            Tab.More -> when (moreOpen) {
                "clients" -> ClientsScreen(line.running, viewModel::refresh, onBack = { moreOpen = null }, modifier = inside)
                "categories" -> CategoriesScreen(onBack = { moreOpen = null }, bottomSpace = ListBottomSpace, modifier = inside)
                "loans" -> LoansScreen(line.running, viewModel::refresh, onBack = { moreOpen = null }, modifier = inside)
                "settings" -> SettingsScreen(
                    viewModel,
                    openAttention = { showAttention = true },
                    openUpdates = {
                        update.checkNow()
                        moreOpen = "update"
                    },
                    onBack = { moreOpen = null },
                    bottomSpace = ListBottomSpace,
                    modifier = inside,
                )
                "update" -> UpdateScreen(onBack = { moreOpen = "settings" }, bottomSpace = ListBottomSpace, modifier = inside)
                else -> MoreContent(
                    MoreActions({ moreOpen = "clients" }, { moreOpen = "loans" }, { moreOpen = "categories" }, { moreOpen = "settings" }),
                    ListBottomSpace,
                    inside,
                    notice = notice?.let { release ->
                        { UpdateNotice(release.name, onOpen = { moreOpen = "update" }, onDismiss = update::dismissNotice) }
                    },
                )
            }
        }
    }
}

/** The bottom bar and the Add button around a tab's content, which gets the space inside them. */
@Composable
internal fun SignedInFrame(tab: Tab, onSelect: (Tab) -> Unit, onAdd: () -> Unit, content: @Composable (Modifier) -> Unit) {
    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        floatingActionButton = {
            // Filled with the accent and a white plus, as the web's Add button.
            FloatingActionButton(
                onClick = onAdd,
                shape = MaterialTheme.shapes.large,
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary,
            ) {
                Icon(painterResource(R.drawable.ic_add), contentDescription = stringResource(R.string.add))
            }
        },
        // Bottom right, where Material puts it and a thumb reaches it (owner's choice; the web keeps it central).
        floatingActionButtonPosition = FabPosition.End,
        bottomBar = {
            val labelSize = barLabelSize(Tab.entries.map { stringResource(it.title) })
            NavigationBar(containerColor = MaterialTheme.colorScheme.surface) {
                Tab.entries.forEach { item ->
                    NavigationBarItem(
                        selected = tab == item,
                        onClick = { onSelect(item) },
                        icon = { Icon(painterResource(item.icon), contentDescription = null) },
                        label = { BarLabel(stringResource(item.title), labelSize) },
                        // As on the web: the selected tab is the accent, with no pill behind it.
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = MaterialTheme.colorScheme.primary,
                            selectedTextColor = MaterialTheme.colorScheme.primary,
                            indicatorColor = Color.Transparent,
                            unselectedIconColor = MaterialTheme.colorScheme.onSurfaceVariant,
                            unselectedTextColor = MaterialTheme.colorScheme.onSurfaceVariant,
                        ),
                    )
                }
            }
        },
    ) { padding -> content(Modifier.fillMaxSize().padding(padding)) }
}

/** The smallest a bar label may get, in sp for the phone's [fontScale]: 11 dp of actual height (ADR 0046). */
internal fun smallestBarLabel(fontScale: Float): Float = BAR_LABEL_FLOOR_DP / fontScale

/** The one text size below 12 sp: only so "Transactions" stays on one line at 320 dp or with the largest text. */
internal const val BAR_LABEL_FLOOR_DP = 11f

/**
 * One size for all five bar labels: the theme's, or smaller when the longest label ("Transactions" at 320 dp or
 * with large text) would not fit a tab's width. Labels are never cut off and never differ from each other.
 */
@Composable
private fun barLabelSize(labels: List<String>): TextUnit {
    val style = MaterialTheme.typography.labelMedium
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    // A tab's inner padding leaves it a little less than its share; a label that is still too wide at the floor overflows evenly into the gaps, never cut off.
    val tabWidth = with(density) { (LocalWindowInfo.current.containerSize.width / labels.size).toDp() - 6.dp }
    // Never below the bar label floor (ADR 0046), however large the phone's text setting is.
    val smallest = smallestBarLabel(density.fontScale)
    var size = style.fontSize
    while (size.value > smallest) {
        val widest = labels.maxOf { measurer.measure(it, style.copy(fontSize = size), maxLines = 1, softWrap = false).size.width }
        if (with(density) { widest.toDp() } <= tabWidth) break
        size = (size.value - 0.25f).coerceAtLeast(smallest).sp
    }
    return size
}

/** A bar label on one line at the shared [size]; a screen reader reads the whole word. */
@Composable
private fun BarLabel(text: String, size: TextUnit) {
    Text(
        text,
        style = MaterialTheme.typography.labelMedium.copy(fontSize = size),
        maxLines = 1,
        softWrap = false,
        textAlign = TextAlign.Center,
        modifier = Modifier.wrapContentWidth(unbounded = true),
    )
}

/** The sync line, the unsent count and how many changes wait for the owner: what [SyncHeader] shows. */
data class SyncStatus(val line: SyncLine, val unsent: Int, val attention: Int)

/** The sync state in words: running, offline (with when it was last saved), failed, or when the mirror was updated. */
@Composable
private fun syncText(line: SyncLine): String? {
    val updated = line.updatedAt?.let { stringResource(R.string.sync_updated, formatUpdated(it)) }
    return when {
        line.running -> stringResource(R.string.sync_running)
        line.problem == SyncProblem.Offline && updated != null -> stringResource(R.string.sync_offline_saved, updated)
        line.problem == SyncProblem.Offline -> stringResource(R.string.sync_offline)
        line.problem == SyncProblem.Failed -> stringResource(R.string.sync_failed)
        else -> updated
    }
}

/** Home's sync state (ADR 0046): a dot, the words, the unsent count and Try again. The dot is only an extra cue, the words say it. */
@Composable
internal fun SyncStatusRow(status: SyncStatus, onRetry: () -> Unit) {
    val line = status.line
    val palette = app.ledgerline.android.ui.theme.LocalPalette.current
    val unsent = if (status.unsent > 0) pluralStringResource(R.plurals.unsent_count, status.unsent, status.unsent) else null
    val dot = when {
        line.problem == SyncProblem.Failed -> palette.danger
        line.running || line.problem == SyncProblem.Offline -> palette.muted
        else -> palette.accent
    }
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = ScreenMargin).heightIn(min = 40.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        androidx.compose.foundation.layout.Box(Modifier.size(8.dp).background(dot, androidx.compose.foundation.shape.CircleShape))
        Text(
            listOfNotNull(syncText(line), unsent).joinToString(" · "),
            style = MaterialTheme.typography.bodySmall,
            color = if (line.problem == SyncProblem.Failed) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(1f),
        )
        if (line.problem != null && !line.running) LinkButton(stringResource(R.string.try_again), onRetry)
    }
}
