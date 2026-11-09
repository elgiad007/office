# Mail rules and junk

[Office user guides](README.md) · [Mail](mail.md)

## Route incoming mail

1. Open **Settings → Mail Rules → New rule**.
2. Name the rule and choose a mail account and destination. For an all-account rule, choose Archive or enter the exact full name of a custom folder or label that exists in every account.
3. Match **All conditions** or **Any condition**. Conditions can use the sender address or domain, To header, subject, body, receipt date, or receipt time. For receipt-time conditions, set a time zone such as `America/New_York` or `UTC`.
4. Choose **Save rule**. The rule acts on incoming Inbox mail during sync. Sender and domain blocks run first, then the first matching enabled rule wins.

Use the up and down buttons to set the rule order. You can edit, disable, enable, or delete a rule. To act on older cached Inbox mail, choose **Preview existing mail → Scan Inbox**. Review the matches a page at a time and choose **Move reviewed messages** when you want to file the displayed results.

## Review and block junk

- Choose **More → Mark as Junk** or use the message's item menu. Junk includes Gmail Spam, IMAP Junk, and locally filed messages. **Not Junk** restores a Junk message to Inbox or clears its suspected status.
- **Suspected Junk** shows Inbox messages with positive spam indicators in their headers. These are clues from the message headers and can be forged.
- **Block Sender** or **Block Domain** moves the message to Junk and creates a rule for future Inbox arrivals for that account. A domain block matches the exact domain. Manage blocks under **Settings → Mail → Junk mail**, where you can also set an existing IMAP Junk folder's full path.

## Empty Junk or Spam

Right-click the account's Junk or Spam folder, or **Local Junk**, and choose **Empty Junk Folder…** or **Empty Spam Folder…**. Review the count before confirming permanent deletion. Account folders can include messages Office has yet to download. Office may ask you to verify your password again. This operation cannot be undone.

For Gmail, including the app-password connection, first configure **Settings → Accounts → Google integration**. Use **Continue to Google** when prompted to grant the one-time permission for that account. Back in Office, open the folder action again to review the count and confirm. Other IMAP providers must support deleting the targeted messages without expunging unrelated mail.
