package app.ledgerline.android.ui.more

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.ledgerline.android.R
import app.ledgerline.android.mirror.CategoryRow
import app.ledgerline.android.online.Online
import app.ledgerline.android.ui.design.CardGap
import app.ledgerline.android.ui.design.GroupedListCard
import app.ledgerline.android.ui.design.IconAvatar
import app.ledgerline.android.ui.design.ListRow
import app.ledgerline.android.ui.design.SectionLabel
import app.ledgerline.android.ui.design.TopBar
import app.ledgerline.android.ui.design.tabular
import app.ledgerline.android.ui.home.Tab
import app.ledgerline.android.ui.privacy.money
import app.ledgerline.api.HomeSummary
import app.ledgerline.api.Money

/** What More's rows open. */
class MoreActions(
    val openClients: () -> Unit,
    val openLoans: () -> Unit,
    val openCategories: () -> Unit,
    val openSettings: () -> Unit,
)

/**
 * The live figures on More's rows (ADR 0046). The money figures and the client count come from Home's online
 * read and are null until it answers, so offline or loading the rows show only their plain sentence; the
 * category counts come from the phone's own copy and work offline.
 */
data class MoreSummary(
    val owed: Money? = null,
    val owedClients: Int = 0,
    val lent: Money? = null,
    val categoryGroups: Int? = null,
    val categorySubs: Int = 0,
    val version: String = "",
)

/** The summary for More from Home's answer and the mirrored categories (archived and deleted ones are not counted). */
fun moreSummary(home: Online<HomeSummary>, categories: List<CategoryRow>?, version: String): MoreSummary {
    val ready = (home as? Online.Ready)?.value
    val live = categories?.filter { it.deletedAt == null && it.archivedAt == null }
    return MoreSummary(
        owed = ready?.owed?.total,
        owedClients = ready?.owed?.personCount?.toInt() ?: 0,
        lent = ready?.loans?.lent,
        categoryGroups = live?.count { it.parentId == null },
        categorySubs = live?.count { it.parentId != null } ?: 0,
        version = version,
    )
}

/** Add belongs to the tabs where entries are made and read; More and the screens opened from it have none (ADR 0046). */
fun addVisible(tab: Tab): Boolean = tab != Tab.More

/** More: a fixed top bar, then two grouped cards of rows, each with a live figure where it is known (ADR 0046). */
@Composable
fun MoreContent(
    actions: MoreActions,
    summary: MoreSummary,
    bottomSpace: Dp,
    modifier: Modifier = Modifier,
    notice: (@Composable () -> Unit)? = null,
) {
    Column(modifier = modifier) {
        TopBar(stringResource(R.string.more_title))
        LazyColumn(contentPadding = PaddingValues(bottom = bottomSpace), verticalArrangement = Arrangement.spacedBy(CardGap)) {
            if (notice != null) item { notice() }
            item {
                Group(R.string.more_group_receivables) {
                    row {
                        val owed = summary.owed?.takeIf { it.amount > 0 }
                        MoreRow(
                            R.drawable.ic_wallet,
                            stringResource(R.string.more_clients_title),
                            if (owed != null && summary.owedClients > 0) {
                                pluralStringResource(R.plurals.more_clients_owe, summary.owedClients, summary.owedClients)
                            } else {
                                stringResource(R.string.more_clients_detail)
                            },
                            owed,
                            actions.openClients,
                        )
                    }
                    row {
                        MoreRow(
                            R.drawable.ic_hand_coins,
                            stringResource(R.string.more_loans_title),
                            stringResource(R.string.more_loans_detail),
                            summary.lent?.takeIf { it.amount > 0 },
                            actions.openLoans,
                        )
                    }
                }
            }
            item {
                Group(R.string.more_group_structure) {
                    row {
                        val groups = summary.categoryGroups
                        MoreRow(
                            R.drawable.ic_tag,
                            stringResource(R.string.more_categories_title),
                            if (groups != null && groups > 0) {
                                pluralStringResource(R.plurals.more_category_groups, groups, groups) + " · " +
                                    pluralStringResource(R.plurals.more_category_subs, summary.categorySubs, summary.categorySubs)
                            } else {
                                stringResource(R.string.more_categories_detail)
                            },
                            null,
                            actions.openCategories,
                        )
                    }
                    row {
                        MoreRow(
                            R.drawable.ic_settings,
                            stringResource(R.string.more_settings_title),
                            stringResource(R.string.more_settings_detail),
                            null,
                            actions.openSettings,
                            trailingText = summary.version.takeIf { it.isNotEmpty() }?.let { stringResource(R.string.more_version, it) },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun Group(label: Int, rows: app.ledgerline.android.ui.design.GroupedRows.() -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SectionLabel(stringResource(label))
        GroupedListCard(rows = rows)
    }
}

/** One row: an icon tile, the title and a sentence, the live figure (through [money], so privacy mode masks it) and a chevron. */
@Composable
private fun MoreRow(icon: Int, title: String, subtitle: String, figure: Money?, onClick: () -> Unit, trailingText: String? = null) {
    val shown = figure?.let { money(it.amount, it.currency) }
    ListRow(
        title = title,
        subtitle = subtitle,
        leading = { IconAvatar(icon) },
        trailing = {
            Trailing(shown?.text ?: trailingText) {
                Icon(painterResource(R.drawable.ic_chevron_right), contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        },
        onClick = onClick,
        // A screen reader says "amount hidden" under privacy mode, not the dots.
        described = shown?.takeIf { it.spoken != it.text }?.let { listOf(title, subtitle, it.spoken).joinToString(", ") },
    )
}

@Composable
private fun Trailing(text: String?, chevron: @Composable () -> Unit) {
    androidx.compose.foundation.layout.Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        if (text != null) Text(text, style = MaterialTheme.typography.titleSmall.tabular())
        chevron()
    }
}
