# Ledgerline user guide

This guide walks through a first session and the everyday money flows. Amounts are in USD for now. All examples use made-up names.

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

## Everyday flows

- **Spend money:** Add, enter the amount, choose a category, Save. The last used account and today's date are pre-filled, and an Undo appears. Time is optional.
- **Get paid:** an *income* entry into the account that receives it, with an income category.
- **Move money between your accounts:** switch Add to *Transfer*. A transfer is two linked entries and is not income or spending.
- **Pay a credit card:** a transfer from your bank account to the card account. It is not an expense.
- **Card interest or fees:** an expense on the card account (it increases what you owe). **Cashback:** income on the card account (it reduces what you owe). Compare the card balance with the statement each month; a difference means a missing entry.
- **Split a purchase:** use the split editor to allocate one payment across several categories. The account changes once; each category gets its share.
- **Shared bills:** record only your share as the expense. If you paid for others, move the rest with a transfer to an account you keep for what they owe you (a loan-type account); settle by transferring until it reads zero.
- **Money held for someone else:** record a transfer into and out of a dedicated pass-through account so neither step counts as income or spending.
- **Money sent abroad:** an expense in a family-support category, and the service fee as its own expense.

## Money owed to you (People)

Open **More, People** to add a person, log a service you provided (what, date, amount, optional due date) and record full or partial payments as they arrive. Logging a service does not count as income; a payment creates the income in the account that received it. Write off an amount that will never be paid: it leaves the open total but stays in history. Archiving a person keeps their balances and history.

## Finding and fixing entries

The Transactions screen groups entries by day, with filters that stay in the address bar. Edit or delete an entry from its details; a deleted entry can be restored with Undo. Deleting an account or category first requires deleting its connected transactions. Merging two categories moves everything from one to the other.

## Privacy

The eye icon blurs every amount on screen. Ledgerline sends nothing to analytics or tracking services, and its logs never contain amounts, payees or notes.

## Keyboard

Press Cmd or Ctrl plus K to open the command palette for jumping to pages and actions.

## Backups

Your server's operator should schedule backups and run the restore drill regularly. See the [self-hosting guide](SELF_HOSTING.md).
