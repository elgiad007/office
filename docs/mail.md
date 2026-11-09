# Mail

[Office user guides](README.md)

Open **Mail**, press `g 1`, or enter `:mail`. Use the Mail sidebar to browse local folders and connected accounts. On a phone, tap **Folders** in the message list. See [Accounts and sync](accounts-and-sync.md) to connect an account.

## Browse and search

Expand an account and choose **Refresh folders** to discover its IMAP folders or Gmail labels. Open a folder to refresh it. **Load next batch** indexes more messages from the server. **Show next 100 messages** reveals more rows from the existing cache. The cached count can grow as older mail downloads.

Search in the current view by subject, correspondent, or downloaded body text. Open **List view** above the message rows to group by date or sender, turn grouping off, or sort by date, sender, or subject. Select a group heading or choose **Expand all** or **Collapse all**. The default is newest first with date groups. Open Junk, Trash, or Recovery copies separately to see messages outside **All cached mail**.

Choose **List appearance** in Mail settings to customize the three lines, their left and right fields, text sizes, and sender name or address display. By default, the lines show sender and date, subject and attachment indicator, then a body preview.

The envelope is replaced by a checkmark when you select a row. A question mark in the attachment field means the attachment status is unknown. If an administrator enables remote sender icons with `OFFICE_REMOTE_SENDER_ICONS=1`, a lookup can reveal to the sender's website that the mail row was displayed, along with the Office server's IP address.

## Read messages and download attachments

- Use **More → HTML** or **Text only** to change how a message is displayed. Set a default in **Settings → Mail**. In dark mode, **Original colors** restores the message's own colors for the session.
- External images are blocked until you choose **Load images** for a message. Loading them can signal to the sender that the message was opened. The choice is remembered in the current browser profile.
- Open **Details → View message headers**, or enter `:head`, to inspect the cached original headers. The header viewer supports search and copying.
- Large messages may arrive as headers only. Use **Download message body** for the text parts and open **Attachments** to load the file list. Use **Check attachments** if you need to fetch the list again. A partial copy has no original EML to download.
- Open **Attachments** and use **Preview** for PNG, JPEG, GIF, WebP, or PDF files, or **Download** to save a file. **Save all** downloads a ZIP. Only downloaded files are available offline.

## Write and send

1. Choose **Compose**, **Reply**, or **Forward**. Reply quotes the original text. Forward includes the original files.
2. Enter a subject, one recipient, and your message. Select **Send using** to choose the outgoing account. Set your preferred account in **Settings → Mail**.
3. To attach files, first save the draft, then use **Add files** or drag files into it. Limits are 10 MB per file, 20 MB total, and 100 files per draft. **Save all** is also capped at 20 MB.
4. Choose **Send message** or press `Ctrl+Enter`. When confirmation is enabled, press Enter to confirm or Escape to keep editing. You can continue working while Office sends.

Saved drafts stay in **Drafts** until you send or discard them. Office retains a local Sent copy. If Office reports **Delivery uncertain**, check your provider or the recipient before sending a replacement. Office does not resend automatically.

Sending through generic SMTP keeps the Office Sent copy without appending it to the IMAP Sent folder. Sending or discarding a draft returns you to the previous mail folder and restores its search.

## File messages and manage folders

Use **Archive**, **Move to Trash**, or **More → Move / Labels** on a message. Use **More** or the right-click menu to mark it read or unread. For multiple messages, select them first and open the selection's item menu. Folder filing requires the selected messages to belong to the same account.

Press `m` for **Quick Move**, type a folder or label name, choose a match with Up or Down, then press Enter. Account names distinguish matching folders. A cross-account move copies and verifies the complete original before moving the source to Trash. It requires an original no larger than 1.4 MB and UIDPLUS on an IMAP destination. If verification is uncertain, check the destination and sync before trying again.

The Gmail label picker also offers **Add label** and **Remove label**. **Move here** applies the chosen label and removes Inbox or Trash membership while retaining other labels. A message can appear in several Gmail views.

With the Gmail app-password connection, Archive uses Gmail's All Mail and can overlap Inbox. Archive and Trash use the account's system folders, including when a custom label has the same name. After upgrading an older Gmail app-password installation, use **Refresh folders** and **Repair / resync** to refresh cached folder locations.

Use **New folder** or **New label** in an account to create one. For nested folders, enter the full path using your server's separator. Gmail uses `/`. Custom folders can be renamed or deleted. IMAP folders must be empty and have no subfolders before deletion. Gmail label deletion removes the label from messages. Office protects system folders.

## Trash, recovery, and exports

- Connected mail goes to the provider's Trash. **Restore to Inbox** sends it to Inbox. To reverse your most recent mail deletion, press `U` in normal mode within 15 minutes in the same page. Undo waits for pending deletions and restores confirmed successes to their original locations. Reloading clears the page's undo history.
- **Recovery copies** holds cached messages that disappeared from synced folders when retention is enabled. **Save locally** keeps an independent copy. **Discard copy** removes the recovery copy from Office. Find the retention setting under **Settings → Mail**.
- Use **Import** for an original `.eml` up to 1.4 MB. Open **More → Download original EML** where an original is available. In the Mail header, use **Mail export options** to export cached mail or fetch missing bodies during export. See [Import and export](import-export.md).
- See [Mail rules and junk](mail-rules-and-junk.md) for suspected spam, blocking, and permanent Junk or Spam deletion.
