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

## Insights

Open **Insights** to see where a month's money went.

1. Pick a month with the arrows. The top shows what you **spent**, then the money in and the net for that month.
2. **Spending by category** lists the categories largest first, each with its share of the month's spending. A category with subcategories has an arrow: tap it to see the subcategories and anything spent in the category itself. Tap a category without subcategories, or a subcategory, to open its entries for that month in Transactions.
3. **Money in and out** shows the 12 months up to the chosen month as bars (teal for money in, grey for spending). **Show the figures** lists the same numbers as a table.
4. Only cleared entries count, in your base currency, split entries by line, with transfers left out. The month's money in and spending match Home's. Amounts are hidden in privacy mode like everywhere else.

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

For rent, salary, subscriptions and regular transfers, open **More, Recurring** and choose **Add a recurring entry**. First set your **time zone** under **More, Settings** (the Ledger card), so Ledgerline knows what today is for you.

1. Pick a name, the type (expense, income or transfer), the account, the amount and the category, then how often it repeats (every N days, weeks, months or years) and the date it starts. An end date is optional. The form shows the next dates before you save.
2. On each date Ledgerline creates the entry for you, already counted, dated on that day. If the server was off or the start date is in the past, the missed ones are created too, one per date, and the form tells you how many are due before you save. Nothing is ever created twice, and an entry you delete is not created again.
3. A month that is too short uses its last day: a rule on the 31st runs on Feb 28 and goes back to the 31st afterwards.
4. A **transfer** rule can send between currencies: it uses a fixed amount that arrives each time. It can also carry a **bonus**, saved as income in the receiving account each time. A bonus is only added when you switch it on for that rule. It can also carry a **fee** charged to the sending account (type `2` for a fixed fee or `2%` for a percentage of the amount sent; a percentage is worked out again each time). The sending account's usual fee starts the box off, and you confirm it when you save the rule.
5. An entry that cannot be created, for example because the account is archived or a currency has no rate yet, waits under **Needs attention** with the reason and is tried again automatically. Fix the cause, or choose **Skip this one**.
6. **Pause** stops a rule; when you resume it, what came due in between is skipped, not caught up. Editing a rule changes only entries not created yet, and **Delete rule** keeps the entries it already made. An account or category used by a rule cannot be deleted while the rule exists; archive it instead.

## Money owed to you (Clients)

Open **More, Clients** to add a client, log a service you provided (what, date, amount, optional due date) and record full or partial payments as they arrive. Logging a service does not count as income; a payment creates the income in the account that received it. Write off an amount that will never be paid: it leaves the open total but stays in history. Archiving a client keeps their balances and history. For work paid by the hour, open **Work paid by the hour?** on the Log service form, enter the hours and your hourly rate, and choose **Use this total**: it fills the amount (and a blank description such as "3.5 h at $40.00/h"). Only the total is stored.

If a client pays more than they owe, type what you received: Ledgerline settles what was owed and saves the extra as a **tip**, a separate income entry in the same account (choose a category for the tip; an income category named Tips is picked for you when it exists). A tip never changes what a client owes. When the account is in another currency, enter the tip in its own box. Deleting or undoing a payment removes its tip too; you can edit or delete a tip on its own from Transactions.

## Lending and borrowing

Open **More, Loans** to track money you lent to or borrowed from friends and family. It is separate from Clients, and these people do not appear there. The list shows each person with what they owe you or what you owe them, one balance per currency.

Choose **Add loan**, pick the person (or add a new one), and say what happened: you lent money, you borrowed money, or it is a loan you already had. Open a person to act on their balance:

- **Lend money** takes the amount out of one of your accounts and adds it to what they owe you. **Borrow money** does the opposite: the money arrives in one of your accounts and you owe them.
- **Record repayment** follows the balance. When they owe you, the money comes back into an account you choose; when you owe them, it leaves one. You cannot repay more than what is open (lend or borrow instead).
- **Waive what is left** writes the open balance off. If they owed you, it is an expense in a category you choose; if you owed them, it is income in one. You can undo it from Transactions.
- **Rename** and **Archive** keep a person tidy; their balances and history are kept.

A loan you already had before using Ledgerline goes in through **Add loan**: choose **A loan I already had**. It sets the balance you start from and moves no money in any of your accounts. If you made a mistake, open the person and press **Change** next to **Before Ledgerline**: you can fix the amount or who owes whom (the currency stays as it is). To get rid of a loan altogether, for example one added in the wrong currency, press **Remove** on its balance. A loan can only be removed while nothing but its starting balance is left: if you lent, borrowed, repaid or waived, the dialog lists the dates of those entries, and you delete them in Transactions first. Removing a loan changes nothing in your own accounts.

Lending, borrowing and repaying are transfers, so they never count as income, spending or budgets. Home shows **Lent out** and **You owe** when they are not zero, and **Net worth** (on Accounts) includes them. The balance account kept for each person does not appear in your account lists, but every move shows under Transactions.

## Finding and fixing entries

The Transactions screen groups entries by day, with filters that stay in the address bar. Edit or delete an entry from its details; a deleted entry can be restored with Undo. Deleting an account or category first requires deleting its connected transactions. Merging two categories moves everything from one to the other.

## Exporting your data

Your ledger can be downloaded as CSV files that open in Excel, Numbers or Google Sheets.

1. **Transactions:** open **Import and export** under the filters (it stays closed until you need it) and use **Export as CSV** to save exactly the entries the screen is showing. Or open **More, Settings, Your data**, optionally choose a date range, and download every entry. **Download accounts** and **Download categories** save those lists.
2. Amounts are plain numbers in each currency's own decimals, and the **type** column (income, expense, transfer) gives the direction. A transfer is one row; a split entry is one row per line. Fees and bonuses are ordinary rows.
3. A file is made at the moment you download it and is never kept on the server. It holds your financial data, so store it somewhere private.

## Importing a statement

Use **Import from CSV** (on Transactions under **Import and export**, in Settings under Your data, or More, Import) to add entries from a bank statement or a spreadsheet saved as CSV.

1. **Template:** unsure how to lay a file out? **Download CSV template** sits next to the Import button and the file chooser. Fill it in and import it.
2. **Choose a file and the account** to import into. The file is read in your browser; it is never sent to the server or stored. Only the entries you approve are saved.
3. **Match your columns.** We guess from the column names and remember your choices for files with the same headers on this device. Say how dates are written, whether amounts are one signed column, an amount plus a type column, or separate money in and money out columns, and how numbers look (`1,234.56` or `1.234,56`). Files separated by semicolons or tabs work too.
4. **Choose categories.** Every entry needs one of your categories. Names in the file that match yours are used automatically; for the rest, pick a category or a default for expenses and one for income. Categories are never created for you.
5. **Review.** Rows that look like entries you already have (same account, date and amount, or the same entry id from an export) are listed as possible duplicates and left out unless you tick them. Rows that can't be read are listed with the reason. Transfers and split entries in an exported file can't be imported yet.
6. **Import.** All the entries are saved together or not at all. **Undo this import** removes whatever is left of that import; it is also available later under Recent imports.

## Privacy

The eye icon blurs every amount on screen. Ledgerline sends nothing to analytics or tracking services, and its logs never contain amounts, payees or notes.

## Typing amounts from the cents

In **More, Settings**, switch on **Type amounts from the cents** to type amounts the way many banking apps do: type digits only and the decimal point stays in place, so 1, 2, 3 reads 1.23. Backspace removes the last digit, and typing into a box that already has an amount adds digits to the end of it. A pasted amount is read as usual. The setting is saved on the device you are using, so turn it on for each phone or computer. It applies to every box where you type money, but not to exchange rates, percentages or hours. With the setting off, money boxes accept only digits and one decimal point, with as many decimals as the currency has.

## Keyboard

Press Cmd or Ctrl plus K to open the command palette for jumping to pages and actions.

## Backups

Your server's operator should schedule backups and run the restore drill regularly. See the [self-hosting guide](SELF_HOSTING.md).
