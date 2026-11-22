package app.ledgerline.android.mirror

import java.text.Normalizer

/**
 * What the Transactions list is narrowed to, with the web's fields and meanings (ADR 0043, polish PR C). Empty or
 * null means "any". All but the search are written twice, in SQL for the mirror ([MirrorReads]) and in [matches] for
 * the entries a pending change rebuilds, and a test runs both on the same data; the search is matched in code only
 * ([matchesText]), because SQLite folds the case of A to Z alone.
 */
data class EntryFilters(
    /** A literal part of the payee or note, ignoring capital and small letters (every letter, not only A to Z). */
    val text: String = "",
    val accountId: String? = null,
    val categoryId: String? = null,
    /** A main category also finds its subcategories' entries (what the Category filter does; Insights' "directly in" does not). */
    val includeSubcategories: Boolean = true,
    val tagId: String? = null,
    /** "yyyy-MM-dd", inclusive. */
    val from: String? = null,
    val to: String? = null,
    /** "expense", "income" or "transfer". */
    val kind: String? = null,
    /** "cleared" or "pending". */
    val status: String? = null,
) {
    /** The end date is before the start date: the web shows a message and no entries until it is corrected. */
    val rangeInvalid: Boolean get() = from != null && to != null && from > to

    /** How many filters are set (the search counts as one). */
    val count: Int
        get() = listOf(text.isNotBlank(), accountId != null, categoryId != null, tagId != null, from != null, to != null, kind != null, status != null).count { it }

    val applied: Boolean get() = count > 0

    /** What the Filters chip counts: every filter but the search (its own box) and the entry type (its own chips). */
    val sheetCount: Int get() = panelCount - if (kind != null) 1 else 0

    /** Every filter but the search, for the "Filter entries" heading. */
    val panelCount: Int get() = count - if (text.isNotBlank()) 1 else 0

    /** The search text as the queries take it: null when blank. */
    val searchText: String? get() = text.trim().ifEmpty { null }

    /** The search text without accents on Latin letters, folded once for all the rows it is compared with. */
    private val foldedTerm: String? by lazy { searchText?.withoutAccents() }

    /**
     * Whether a payee or note contains the search text, ignoring case for every letter and the accents of Latin letters
     * ("cafe" finds "Café" and "café" finds "cafe"); true when there is no search.
     */
    fun matchesText(payee: String?, note: String?): Boolean {
        val term = foldedTerm ?: return true
        return listOfNotNull(payee, note).any { it.withoutAccents().contains(term, ignoreCase = true) }
    }

    /**
     * Whether an entry as the phone shows it (the mirror with pending changes laid over it) passes every filter.
     * [categoryFamily] is the chosen category and, when asked for, its subcategories (null when there is no category
     * filter). A split entry is never rebuilt on the phone (it is read-only here), so only its own category is read.
     */
    fun matches(entry: ShownFilterFields, categoryFamily: Set<String>?): Boolean {
        if (accountId != null && entry.accountId != accountId) return false
        if (categoryFamily != null && entry.categoryId !in categoryFamily) return false
        if (tagId != null && tagId !in entry.tagIds) return false
        if (from != null && entry.date < from) return false
        if (to != null && entry.date > to) return false
        if (kind != null && entry.kind != kind) return false
        if (status != null && entry.status != status) return false
        if (!matchesText(entry.payee, entry.note)) return false
        return true
    }
}

/** The fields of an entry the filters read. */
data class ShownFilterFields(
    val accountId: String,
    val categoryId: String?,
    val tagIds: List<String>,
    val date: String,
    val kind: String,
    val status: String,
    val payee: String?,
    val note: String?,
)

private val AccentOnLatin = Regex("(?<=\\p{IsLatin})\\p{Mn}+")

/**
 * The text with the accents taken off Latin letters: "Café" is "Cafe", "Müller" is "Muller". Only a mark that follows a
 * Latin letter goes, so a Cyrillic "й" stays apart from "и", and the text is put back together afterwards (a Korean
 * syllable is not split into letters). Plain ASCII, which is most of what is typed, is returned as it is.
 */
internal fun String.withoutAccents(): String {
    if (all { it.code < 128 }) return this
    val parts = Normalizer.normalize(this, Normalizer.Form.NFD).replace(AccentOnLatin, "")
    return Normalizer.normalize(parts, Normalizer.Form.NFC)
}
