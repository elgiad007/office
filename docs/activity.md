# Activity and troubleshooting

[Office user guides](README.md)

The bottom status bar shows active and queued work, including sync, sends, backups, and mail actions. When work finishes, the status returns to **Ready**. During mail sync, progress can include the account, current folder, batch, and remaining older mail.

Choose **View activity**, or enter `:log`, to open recent events. Use **Level** and **Account** to filter. `:errors` and `:warnings` open the corresponding filters directly. **Copy visible log** copies the filtered entries. **Clear log** removes the saved entries. Where an activity entry links to an Office item, open the link to see that item.

## Choose how much to keep

Open **Settings → Activity Log** and choose **Save logging level** after selecting a level.

- **Summary** keeps operation outcomes and distinct warnings and errors.
- **Warnings and errors** keeps only those entries.
- **Detailed** also keeps folder checks, batch progress, and connection diagnostics.

The log shows up to 500 recent events and survives page refreshes. It records summaries and excludes passwords, tokens, and message bodies. Full workspace backups exclude the activity log.

The activity indicator uses a steady highlight when reduced motion is enabled. IMAP progress can appear as it happens when the host supports streaming.

## Investigate a problem

| Symptom | What to check |
| --- | --- |
| Older messages are still appearing | Check for **Older mail remains**. The cached count includes older messages brought in during sync. |
| A folder or account failed to sync | Filter the log by account. Check authorization, credentials, or the folder path, then use **Sync now**. See [Accounts and sync](accounts-and-sync.md). |
| A move or send reports an uncertain outcome | Check the destination folder, provider's Sent view, or recipient as appropriate before trying again. Sync after checking mail moves. |
| A local item seems missing | Clear search and check filters or collapsed groups. For missing synced mail, check Trash, Recovery copies, and the original account. |
| Office is unavailable on Windows | Check the launcher console and start the installation with **Start Office.bat**. For an interrupted update, see [Updates](updates.md). |
