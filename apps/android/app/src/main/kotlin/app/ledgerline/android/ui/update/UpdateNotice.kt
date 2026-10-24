package app.ledgerline.android.ui.update

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.dp
import app.ledgerline.android.R
import app.ledgerline.android.ui.design.LedgerCard
import app.ledgerline.android.ui.theme.LocalPalette

/**
 * The banner on Home and More that says a newer version is out. A tap opens the update screen; the X hides it for this
 * version only (a newer release brings it back), and the update stays reachable from Settings.
 */
@Composable
fun UpdateNotice(version: String, onOpen: () -> Unit, onDismiss: () -> Unit, modifier: Modifier = Modifier) {
    val palette = LocalPalette.current
    val title = stringResource(R.string.updates_notice_title, version)
    val detail = stringResource(R.string.updates_notice_detail)
    LedgerCard(modifier = modifier, padding = PaddingValues(start = 16.dp, top = 4.dp, bottom = 4.dp, end = 4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Row(
                modifier = Modifier
                    .weight(1f)
                    .heightIn(min = 56.dp)
                    .clickable(onClick = onOpen, role = Role.Button)
                    .clearAndSetSemantics { contentDescription = "$title, $detail" },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    modifier = Modifier.size(40.dp).background(palette.accentSoft, MaterialTheme.shapes.small),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(painterResource(R.drawable.ic_download), contentDescription = null, tint = palette.accent, modifier = Modifier.size(20.dp))
                }
                Column(modifier = Modifier.padding(start = 16.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(title, style = MaterialTheme.typography.titleMedium)
                    Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            // A 48 dp target; Material's IconButton is exactly that.
            IconButton(onClick = onDismiss) {
                Icon(
                    painterResource(R.drawable.ic_close),
                    contentDescription = stringResource(R.string.updates_notice_dismiss),
                    tint = palette.muted,
                    modifier = Modifier.size(20.dp),
                )
            }
        }
    }
}
