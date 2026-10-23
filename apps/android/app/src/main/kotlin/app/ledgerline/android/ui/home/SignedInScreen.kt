package app.ledgerline.android.ui.home

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
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
import app.ledgerline.android.R
import app.ledgerline.android.mirror.EntryLine
import app.ledgerline.android.ui.design.LedgerCard
import app.ledgerline.android.ui.design.LinkButton
import app.ledgerline.android.ui.design.PageHeader
import app.ledgerline.android.ui.design.ScreenMargin
import app.ledgerline.android.ui.design.SecondaryButton
import app.ledgerline.android.ui.editor.EditorScreen
import app.ledgerline.android.ui.editor.EditorTarget
import app.ledgerline.android.ui.format.formatUpdated
import app.ledgerline.android.ui.more.MoreScreen
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
fun SignedInScreen(viewModel: SignedInViewModel = hiltViewModel(), home: HomeViewModel = hiltViewModel()) {
    var tab by rememberSaveable { mutableStateOf(Tab.Home) }
    var showAttention by rememberSaveable { mutableStateOf(false) }
    var editing by rememberSaveable { mutableStateOf<String?>(null) }
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
    val header: @Composable () -> Unit = { SyncHeader(status, onRetry = viewModel::refresh, onOpenAttention = { showAttention = true }) }
    SignedInFrame(tab, onSelect = { tab = it }, onAdd = { edit(EditorTarget.New()) }) { inside ->
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
                    HomeContent(header, month, home::retry, accounts)
                } else {
                    val entries by viewModel.entries.collectAsState()
                    val canShowMore by viewModel.canShowMore.collectAsState()
                    TransactionsContent(header, entries, canShowMore, viewModel::showMoreEntries) { line: EntryLine ->
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
            Tab.Budgets -> Later(R.string.budgets_title, R.string.later_budgets, inside)
            Tab.Insights -> Later(R.string.insights_title, R.string.later_insights, inside)
            Tab.More -> MoreScreen(viewModel, { showAttention = true }, ListBottomSpace, inside)
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

/**
 * One size for all five bar labels: the theme's, or smaller when the longest label ("Transactions" at 320 dp or
 * with large text) would not fit a tab's width. Labels are never cut off and never differ from each other.
 */
@Composable
private fun barLabelSize(labels: List<String>): TextUnit {
    val style = MaterialTheme.typography.labelMedium
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    // The bar's own side padding and each item's inner padding leave a tab about 16 dp less than its share.
    val tabWidth = with(density) { (LocalWindowInfo.current.containerSize.width / labels.size).toDp() - 16.dp }
    // Never below about 9 dp of actual height, however large the phone's text setting is.
    val smallest = 9f / density.fontScale
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
    Text(text, style = MaterialTheme.typography.labelMedium.copy(fontSize = size), maxLines = 1, softWrap = false, textAlign = TextAlign.Center)
}

/** A screen that arrives in a later part of slice 5: its header and a card that points to the web app. */
@Composable
internal fun Later(title: Int, text: Int, modifier: Modifier = Modifier) {
    LazyColumn(modifier = modifier, contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = ListBottomSpace)) {
        item { PageHeader(stringResource(title), eyebrow = stringResource(R.string.eyebrow_ledger)) }
        item {
            LedgerCard {
                Text(stringResource(text), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

/** The sync line, the unsent count and how many changes wait for the owner: what [SyncHeader] shows. */
data class SyncStatus(val line: SyncLine, val unsent: Int, val attention: Int)

/** Under each page header: when the mirror was updated, what is not sent, and the way to changes that need the owner. */
@Composable
internal fun SyncHeader(status: SyncStatus, onRetry: () -> Unit, onOpenAttention: () -> Unit) {
    val line = status.line
    val updated = line.updatedAt?.let { stringResource(R.string.sync_updated, formatUpdated(it)) }
    val text = when {
        line.running -> stringResource(R.string.sync_running)
        line.problem == SyncProblem.Offline && updated != null -> stringResource(R.string.sync_offline_saved, updated)
        line.problem == SyncProblem.Offline -> stringResource(R.string.sync_offline)
        line.problem == SyncProblem.Failed -> stringResource(R.string.sync_failed)
        else -> updated
    }
    val unsent = if (status.unsent > 0) pluralStringResource(R.plurals.unsent_count, status.unsent, status.unsent) else null
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = ScreenMargin).heightIn(min = 48.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(
            listOfNotNull(text, unsent).joinToString(" · "),
            style = MaterialTheme.typography.bodySmall,
            color = if (line.problem == SyncProblem.Failed) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(1f),
        )
        if (line.problem != null && !line.running) LinkButton(stringResource(R.string.try_again), onRetry)
    }
    if (status.attention > 0) {
        SecondaryButton(
            pluralStringResource(R.plurals.attention_banner, status.attention, status.attention),
            onClick = onOpenAttention,
            modifier = Modifier.fillMaxWidth().padding(horizontal = ScreenMargin, vertical = 4.dp),
        )
    }
}
