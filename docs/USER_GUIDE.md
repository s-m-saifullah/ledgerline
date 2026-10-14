# Ledgerline user guide

This guide walks through a first session and the everyday money flows. USD is the base currency; accounts and entries can also use other currencies (see Other currencies). Money owed to you (Clients) can also use other currencies. All examples use made-up names.

## First run

1. Sign in with the owner email and password from your installation.
2. Open **More, Categories**. Choose **Add starter categories**, read the list (nothing is created yet), untick groups you do not want, tick any optional add-on that fits you (students, shared household, gig and hourly work, sending money abroad) and confirm. Or build your own categories by hand. You can rename, recolor, reorder, merge, archive and delete categories later.
3. Open **More, Accounts** and create your accounts yourself. Ledgerline never creates accounts for you.
4. Add your first transaction with the **Add** button.

## Accounts and balances

| Account type | Opening balance | Notes |
| --- | --- | --- |
| Bank, savings, cash, wallet | what it holds today | Counts toward the **In hand** total on Home. |
| Card | minus what you owe today | Purchases are expenses on the card; paying it is a transfer. |
| Loan | minus what is left to pay | One account per loan if you want them apart. |

**A negative balance means you owe money.** The opening balance is the balance before the entries you record in Ledgerline, so do not mix today's balance with older history.

Home shows **In hand**: the positive balances of your active bank, cash, wallet and savings accounts. Cards and loans stay on the Accounts screen, where **Net worth** and the amount owed on cards and loans are shown at the top. Money you hold for someone else inside your bank balance is counted as in hand until you pay it on.

## Budgets

Open **Budgets** to plan spending month by month.

1. Pick a month, then choose an expense category and enter how much to spend on it that month. Budgets are set on top-level categories; spending in their subcategories counts toward them.
2. Each category shows how much is left, with a bar. It turns red only when you have overspent. At the top, **Left this month** sums every budget.
3. **Spent** adds up cleared expenses and split lines in that month, in your base currency. Transfers and pending entries are not counted.
4. Turn on **carry over** for a category and what is left (or overspent, as a negative) moves into the next month. It is worked out from your entries each time, so editing an old entry or budget updates later months by itself.
5. **Copy from last month** fills in a new month from the previous one. Amounts are hidden in privacy mode like everywhere else.

## Other currencies

1. Open **More, Currencies** and choose **Add a currency**. Ledgerline fetches today's rate; you can set a rate yourself on any date and it is kept, never replaced by a refresh. Rates read base-currency first: *1 USD = 0.89 EUR*.
2. When you create an account, pick its currency. It cannot change afterwards, and the opening balance is entered in it.
3. An entry in a euro account is entered in euros. The form shows what it is worth in dollars (*About $112.17*) and the rate it will use: the newest stored rate on or before the entry's date, or a rate you set by hand. If no rate is stored yet, you are asked to set one before saving. The rate is saved with the entry, so later rate changes do not rewrite your history; editing the entry keeps its rate unless you change it.
4. A **transfer between currencies** asks for the amount sent and the amount received. If one account is in USD the two amounts fix the rate; between two other currencies the sent currency's stored rate sets the dollar value. Either way the two legs net to zero in dollars.
5. **Home** and **Net worth** show totals in dollars. Foreign balances are valued at the newest stored rate and shown beside their own amount. A currency with no rate yet is left out of the totals, and Home says so. Spending, income and budgets use each entry's saved dollar value.

## Everyday flows

- **Spend money:** Add, enter the amount, choose a category, Save. The last used account and today's date are pre-filled, and an Undo appears. Time is optional.
- **Get paid:** an *income* entry into the account that receives it, with an income category.
- **Move money between your accounts:** switch Add to *Transfer*. A transfer is two linked entries and is not income or spending.
- **A fee for sending money:** on the transfer form, type it in the **Fee** box. A plain number such as `2` is a fixed fee in the sending account's currency; a number with a percent sign such as `1.5%` is a percentage of the amount sent. The fee is charged to the sending account only, so sending 100 with a fee of 2 takes 102 from it and the other account still receives 100. It is saved as its own expense, in a category you choose under **More** on the form. An account can remember its usual fee and category (edit the account), so the box starts filled in. Deleting the transfer asks whether to delete its fee too.
- **Pay a credit card:** a transfer from your bank account to the card account. It is not an expense.
- **Card interest or fees:** an expense on the card account (it increases what you owe). **Cashback:** income on the card account (it reduces what you owe). Compare the card balance with the statement each month; a difference means a missing entry.
- **Split a purchase:** use the split editor to allocate one payment across several categories. The account changes once; each category gets its share.
- **Shared bills:** record only your share as the expense. If you paid for others, move the rest with a transfer to an account you keep for what they owe you (a loan-type account); settle by transferring until it reads zero.
- **Money held for someone else:** record a transfer into and out of a dedicated pass-through account so neither step counts as income or spending.
- **Money sent abroad:** an expense in a family-support category, and the service fee as its own expense.

## Recurring entries

For rent, salary, subscriptions and regular transfers, open **More, Recurring** and choose **Add a recurring entry**. First set your **time zone** under More (the Ledger card), so Ledgerline knows what today is for you.

1. Pick a name, the type (expense, income or transfer), the account, the amount and the category, then how often it repeats (every N days, weeks, months or years) and the date it starts. An end date is optional. The form shows the next dates before you save.
2. On each date Ledgerline creates the entry for you, already counted, dated on that day. If the server was off or the start date is in the past, the missed ones are created too, one per date, and the form tells you how many are due before you save. Nothing is ever created twice, and an entry you delete is not created again.
3. A month that is too short uses its last day: a rule on the 31st runs on Feb 28 and goes back to the 31st afterwards.
4. A **transfer** rule can send between currencies: it uses a fixed amount that arrives each time. It can also carry a **bonus**, saved as income in the receiving account each time. A bonus is only added when you switch it on for that rule. It can also carry a **fee** charged to the sending account (type `2` for a fixed fee or `2%` for a percentage of the amount sent; a percentage is worked out again each time). The sending account's usual fee starts the box off, and you confirm it when you save the rule.
5. An entry that cannot be created, for example because the account is archived or a currency has no rate yet, waits under **Needs attention** with the reason and is tried again automatically. Fix the cause, or choose **Skip this one**.
6. **Pause** stops a rule; when you resume it, what came due in between is skipped, not caught up. Editing a rule changes only entries not created yet, and **Delete rule** keeps the entries it already made. An account or category used by a rule cannot be deleted while the rule exists; archive it instead.

## Money owed to you (Clients)

Open **More, Clients** to add a client, log a service you provided (what, date, amount, optional due date) and record full or partial payments as they arrive. Logging a service does not count as income; a payment creates the income in the account that received it. Write off an amount that will never be paid: it leaves the open total but stays in history. Archiving a client keeps their balances and history. For work paid by the hour, open **Work paid by the hour?** on the Log service form, enter the hours and your hourly rate, and choose **Use this total**: it fills the amount (and a blank description such as "3.5 h at $40.00/h"). Only the total is stored.

## Finding and fixing entries

The Transactions screen groups entries by day, with filters that stay in the address bar. Edit or delete an entry from its details; a deleted entry can be restored with Undo. Deleting an account or category first requires deleting its connected transactions. Merging two categories moves everything from one to the other.

## Privacy

The eye icon blurs every amount on screen. Ledgerline sends nothing to analytics or tracking services, and its logs never contain amounts, payees or notes.

## Keyboard

Press Cmd or Ctrl plus K to open the command palette for jumping to pages and actions.

## Backups

Your server's operator should schedule backups and run the restore drill regularly. See the [self-hosting guide](SELF_HOSTING.md).
