#!/usr/bin/env bash
# Shared by backup.sh and restore-drill.sh. Each check is one single-line SQL
# statement that returns one scalar. backup.sh records the value inside the
# backup's exported snapshot; restore-drill.sh recomputes it on the restored
# copy, so expectations always come from the same snapshot as the dump.

# Checks that become manifest lines (check|name|value).
VERIFY_CHECKS=(balances networth owed transfers splits linked receipts recurring fees tips loans)
# Invariants that must return 0 on a restored database (deferred triggers do not run during pg_restore).
VERIFY_INVARIANTS=(transfer_pairs split_allocations receipt_contacts recurring_links fee_links tip_links loan_links)

verify_requires() {
  case "$1" in
    balances|networth) echo "SELECT to_regclass('public.accounts') IS NOT NULL AND to_regclass('public.transactions') IS NOT NULL" ;;
    owed|linked) echo "SELECT to_regclass('public.receivables') IS NOT NULL AND to_regclass('public.receivable_payments') IS NOT NULL" ;;
    transfers|transfer_pairs) echo "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='transactions' AND column_name='transfer_id')" ;;
    splits|split_allocations) echo "SELECT to_regclass('public.transaction_splits') IS NOT NULL" ;;
    receipts|receipt_contacts) echo "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='receivable_payments' AND column_name='receipt_id')" ;;
    fees|fee_links) echo "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='transactions' AND column_name='fee_transfer_id')" ;;
    tips|tip_links) echo "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='transactions' AND column_name='tip_payment_id')" ;;
    loans|loan_links) echo "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='accounts' AND column_name='contact_id')" ;;
    recurring|recurring_links) echo "SELECT to_regclass('public.recurring_rules') IS NOT NULL AND to_regclass('public.recurring_runs') IS NOT NULL" ;;
    *) echo "SELECT false" ;;
  esac
}

verify_sql() {
  local posted="coalesce((SELECT sum(t.amount) FROM transactions t WHERE t.ledger_id=a.ledger_id AND t.account_id=a.id AND t.deleted_at IS NULL AND t.status='cleared'),0)"
  local split_filter="s.ledger_id=p.ledger_id AND s.transaction_id=p.id AND s.deleted_at IS NOT DISTINCT FROM p.deleted_at AND (p.deleted_at IS NULL OR s.version=p.version)"
  case "$1" in
    # Every live account's posted balance (opening balance plus cleared, non-deleted entries).
    balances) echo "SELECT count(*) || '|' || md5(coalesce(string_agg(b.id || ':' || b.balance, ',' ORDER BY b.id), '')) FROM (SELECT a.id, (a.opening_balance::numeric + $posted)::text AS balance FROM accounts a WHERE a.deleted_at IS NULL) b" ;;
    # Net worth per ledger.
    networth) echo "SELECT count(*) || '|' || md5(coalesce(string_agg(n.ledger_id || ':' || n.total, ',' ORDER BY n.ledger_id), '')) FROM (SELECT a.ledger_id, sum(a.opening_balance::numeric + $posted)::text AS total FROM accounts a WHERE a.deleted_at IS NULL GROUP BY a.ledger_id) n" ;;
    # Open money owed per ledger (live, unwaived services minus live payments).
    owed) echo "SELECT count(*) || '|' || md5(coalesce(string_agg(o.ledger_id || ':' || o.total, ',' ORDER BY o.ledger_id), '')) FROM (SELECT r.ledger_id, sum(r.amount - coalesce((SELECT sum(p.amount) FROM receivable_payments p WHERE p.ledger_id=r.ledger_id AND p.receivable_id=r.id AND p.deleted_at IS NULL),0))::text AS total FROM receivables r WHERE r.deleted_at IS NULL AND r.written_off_at IS NULL GROUP BY r.ledger_id) o" ;;
    # Live and tombstoned transfer pairs.
    transfers) echo "SELECT count(DISTINCT (ledger_id, transfer_id)) FILTER (WHERE deleted_at IS NULL) || '|' || count(DISTINCT (ledger_id, transfer_id)) FILTER (WHERE deleted_at IS NOT NULL) FROM transactions WHERE transfer_id IS NOT NULL" ;;
    # Live split parents and live allocation lines.
    splits) echo "SELECT (SELECT count(*) FROM transactions WHERE is_split AND deleted_at IS NULL) || '|' || (SELECT count(*) FROM transaction_splits WHERE deleted_at IS NULL)" ;;
    # Linked payment/income pairs, live and tombstoned.
    linked) echo "SELECT (SELECT count(*) FROM receivable_payments WHERE deleted_at IS NULL) || '|' || (SELECT count(*) FROM receivable_payments WHERE deleted_at IS NOT NULL) || '|' || (SELECT count(*) FROM transactions WHERE receivable_payment_id IS NOT NULL)" ;;
    # Client-level receipts and their members.
    receipts) echo "SELECT count(DISTINCT (ledger_id, receipt_id)) || '|' || count(*) FROM receivable_payments WHERE receipt_id IS NOT NULL" ;;
    # Both legs of every transfer exist with opposite exact base amounts (and opposite amounts within one currency) and identical state.
    transfer_pairs) echo "SELECT count(*) FROM (SELECT ledger_id, transfer_id FROM transactions WHERE transfer_id IS NOT NULL GROUP BY ledger_id, transfer_id) g WHERE (SELECT count(*) FROM transactions x WHERE x.ledger_id=g.ledger_id AND x.transfer_id=g.transfer_id) <> 2 OR NOT coalesce((SELECT a.account_id <> b.account_id AND a.base_amount = -b.base_amount AND (a.currency <> b.currency OR a.amount = -b.amount) AND a.kind='transfer' AND b.kind='transfer' AND a.date=b.date AND a.time IS NOT DISTINCT FROM b.time AND a.note IS NOT DISTINCT FROM b.note AND a.version=b.version AND a.deleted_at IS NOT DISTINCT FROM b.deleted_at AND a.created_at=b.created_at AND a.updated_at=b.updated_at FROM transactions a JOIN transactions b ON a.ledger_id=b.ledger_id AND a.transfer_id=b.transfer_id WHERE a.ledger_id=g.ledger_id AND a.transfer_id=g.transfer_id AND a.amount<0 AND b.amount>0), false)" ;;
    # Every split parent has 2-50 lines that sum exactly to it; no stray live lines.
    split_allocations) echo "SELECT (SELECT count(*) FROM transactions p WHERE p.is_split AND ((SELECT count(*) FROM transaction_splits s WHERE $split_filter) NOT BETWEEN 2 AND 50 OR (SELECT coalesce(sum(s.amount),0) FROM transaction_splits s WHERE $split_filter) <> p.amount::numeric OR EXISTS (SELECT 1 FROM transaction_splits s WHERE $split_filter AND NOT (s.kind=p.kind AND s.version=p.version AND s.updated_at=p.updated_at)) OR (p.deleted_at IS NOT NULL AND EXISTS (SELECT 1 FROM transaction_splits s WHERE s.ledger_id=p.ledger_id AND s.transaction_id=p.id AND s.deleted_at IS NULL)))) + (SELECT count(*) FROM transaction_splits s JOIN transactions t ON t.ledger_id=s.ledger_id AND t.id=s.transaction_id WHERE s.deleted_at IS NULL AND NOT t.is_split)" ;;
    # A receipt never spans more than one client.
    receipt_contacts) echo "SELECT count(*) FROM (SELECT p.ledger_id, p.receipt_id FROM receivable_payments p JOIN receivables r ON r.ledger_id=p.ledger_id AND r.id=p.receivable_id WHERE p.receipt_id IS NOT NULL GROUP BY p.ledger_id, p.receipt_id HAVING count(DISTINCT r.contact_id) > 1) bad" ;;
    # Live rules, and runs by outcome.
    recurring) echo "SELECT (SELECT count(*) FROM recurring_rules WHERE deleted_at IS NULL) || '|' || (SELECT count(*) FROM recurring_runs WHERE status='created') || '|' || (SELECT count(*) FROM recurring_runs WHERE status='attention') || '|' || (SELECT count(*) FROM recurring_runs WHERE status='skipped')" ;;
    # Every created occurrence points at an entry that exists, and a transfer's link matches that entry.
    recurring_links) echo "SELECT count(*) FROM recurring_runs r WHERE r.status='created' AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.ledger_id=r.ledger_id AND t.id=r.transaction_id AND t.transfer_id IS NOT DISTINCT FROM r.transfer_id)" ;;
    # Transfer fee entries, live and tombstoned.
    fees) echo "SELECT count(*) FILTER (WHERE deleted_at IS NULL) || '|' || count(*) FILTER (WHERE deleted_at IS NOT NULL) FROM transactions WHERE fee_transfer_id IS NOT NULL" ;;
    # Every fee entry is an expense whose transfer still has its two legs in the same ledger.
    fee_links) echo "SELECT count(*) FROM transactions f WHERE f.fee_transfer_id IS NOT NULL AND (f.kind <> 'expense' OR (SELECT count(*) FROM transactions l WHERE l.ledger_id=f.ledger_id AND l.transfer_id=f.fee_transfer_id) <> 2)" ;;
    # Payment tips (ADR 0027): live and tombstoned entries, and the live total.
    tips) echo "SELECT count(*) FILTER (WHERE deleted_at IS NULL) || '|' || count(*) FILTER (WHERE deleted_at IS NOT NULL) || '|' || coalesce(sum(amount) FILTER (WHERE deleted_at IS NULL), 0) FROM transactions WHERE tip_payment_id IS NOT NULL" ;;
    # Client loan accounts (ADR 0030): how many, and the total of their balances (money lent minus money borrowed).
    loans) echo "SELECT count(*) || '|' || coalesce(sum(a.opening_balance::numeric + $posted), 0)::text FROM accounts a WHERE a.deleted_at IS NULL AND a.contact_id IS NOT NULL" ;;
    # Every live client loan account belongs to a live client of the same ledger; there is one per client and currency.
    loan_links) echo "SELECT (SELECT count(*) FROM accounts a WHERE a.deleted_at IS NULL AND a.contact_id IS NOT NULL AND (a.type <> 'loan' OR NOT EXISTS (SELECT 1 FROM contacts c WHERE c.ledger_id=a.ledger_id AND c.id=a.contact_id AND c.deleted_at IS NULL))) + (SELECT count(*) FROM (SELECT 1 FROM accounts a WHERE a.deleted_at IS NULL AND a.contact_id IS NOT NULL GROUP BY a.ledger_id, a.contact_id, a.currency HAVING count(*) > 1) x)" ;;
    # Every tip is an income entry whose payment exists in the same ledger and, when that payment is deleted, is deleted too; a receipt has at most one tip.
    tip_links) echo "SELECT (SELECT count(*) FROM transactions t WHERE t.tip_payment_id IS NOT NULL AND (t.kind <> 'income' OR NOT EXISTS (SELECT 1 FROM receivable_payments p WHERE p.ledger_id=t.ledger_id AND p.id=t.tip_payment_id AND (p.deleted_at IS NULL OR t.deleted_at IS NOT NULL)))) + (SELECT count(*) FROM (SELECT p.ledger_id, p.receipt_id FROM transactions t JOIN receivable_payments p ON p.ledger_id=t.ledger_id AND p.id=t.tip_payment_id WHERE p.receipt_id IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1) x)" ;;
    *) return 1 ;;
  esac
}
