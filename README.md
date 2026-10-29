# Portable Office

A personal office suite for a folder on your own computer or a PHP shared-hosting account. Mail, calendar, tasks, contacts, documents, wiki and simple spreadsheets share one keyboard-oriented interface. This is an initial implementation, with the limitations below.

## Run on Windows

Extract **the Windows release ZIP** into a writable folder, then double-click **Start Office.bat**. It starts the bundled PHP executable as a hidden web server on `127.0.0.1:8765` and opens your browser. The console displays a one-time setup token. Create your owner password in the browser. Use **Stop Office.bat** before moving the folder or removing a USB drive. Save work before stopping it. No Apache, Docker, database service or PHP installation is needed in this release bundle.

The executable has companion DLLs/extensions; keep the `runtime/windows/` files together. The bundle includes Mozilla CA certificates distributed by curl for verified TLS connections. Windows x64 is targeted. A missing Microsoft Visual C++ runtime can prevent PHP starting; see [runtime notes](runtime/windows/README.md). The development server is for localhost only, never public network hosting.

Optional: `Start Office.bat -Port 8766` or `Start Office.bat -NoBrowser`. Starting again reuses this folder's recorded process. It does not deliberately stop or reuse another application's server. The folder must be writable; Program Files is not a suitable default location.

Source checkouts do not contain PHP binaries. Build the Windows release with the packaging instructions below. For development, an existing PHP installation can run `php -S 127.0.0.1:8765 -t public`.

## Run locally on Linux

With PHP 8.2+ and PDO SQLite already available, run `sh start-local.sh`. Visit `http://127.0.0.1:8765`. After the first visit, retrieve the one-time token from `data/setup-token.txt` and complete setup. The same code and database format are used locally and on hosting.

## Install through cPanel

1. Upload/extract the hosting ZIP into a folder such as `/home/your-account/office`.
2. Set the domain/subdomain's **document root to `/home/your-account/office/public`**. The application parent and `data/` must not be publicly served. If your account cannot choose this root, resolve that with the host before deployment; do not copy everything into `public_html`.
3. Select PHP 8.2+ with PDO SQLite. OpenSSL is needed for account credentials; cURL and DOM are needed for HTTPS/CalDAV connectors. The owner must have write access to `data/`; do not use world-writable permissions.
4. Enable HTTPS using the hosting panel. Open the domain, read `data/setup-token.txt` in File Manager, and complete owner setup with a password of at least 12 characters. The token disappears after setup.

No Composer, Node, root access, Apache installation, cron job or persistent worker is required on the host. The parent `.htaccess` denies requests if the wrong root is selected; `public/.htaccess` permits the intended root. The root configuration is Apache-compatible; other web servers must likewise expose only `public/`.

Shared-host filesystem locking, outbound connections, PHP extensions and request limits must be confirmed on your actual account. This repository has not been deployed to hosting.com. Keep SQLite on a local filesystem with working locks, not a network-mounted folder.

## What works in this version

- One-owner login, token-protected setup, CSRF-protected writes, idle session expiry, local encrypted provider credentials.
- Tasks with due dates, priority and completion; contacts with email, phone, company and group.
- Local calendar agenda with start/end/location; ICS import/export. Local-time input is stored with an absolute timestamp. Imported date-only events remain date-only until edited.
- Basic word processing: headings, lists, bold/italic, tables, links, embedded images (PNG/JPEG/GIF/WebP under 900 KB), undo/redo, safe HTML and text import, HTML export, browser print/PDF. HTML is sanitized before displaying or editing; external/unsupported images are replaced by their alt text rather than fetched.
- Wiki: namespace-style page names, Markdown subset, `[[namespace:page]]` links, backlinks, source/preview and revision history. Supported Markdown includes headings, paragraphs, simple bullets, bold, inline/fenced code, HTTP/mailto links and blockquotes. This is not DokuWiki plugin/syntax compatibility or a complete CommonMark implementation.
- Workbooks with multiple sheets; visible grid A1:L30, imported data retained through Z100; arithmetic and SUM/AVERAGE/MIN/MAX/COUNT, references and ranges, cycle/error detection. CSV import/export and JSON export for full workbooks. CSV exports preserve formula source; JSON retains every sheet. Cross-sheet references and Excel file formats are unsupported.
- EML import/export with original source; HTML and plain-text message reading and local drafts. Use the HTML / Text only buttons above a received message, or choose a default under Settings → Mail. Dark mode adapts sender text, link and background colors for readability; use Original colors above the message to restore its light presentation for that message during this session. Outlook blank paragraph spacing is preserved. HTML uses an isolated frame with scripts and forms disabled; external HTTPS images require Load images for each message and may report that the message was opened. Embedded PNG/JPEG/GIF/WebP images up to 500 KB each are supported. The PHP DOM extension is required for HTML viewing. Text only uses the plain-text body when available or readable text extracted from HTML, including for nested multipart messages. Transfer encodings and character sets are decoded; scripts, styles and attachment contents are excluded from the text view. Previously cached multipart messages are read from their saved originals automatically. Original EML import/download is initially limited to 1.4 MB per message; larger Gmail messages are skipped and larger IMAP messages report a limit error. General attachment viewing, encrypted messages and complete MIME support are deferred; download the original EML for those. Parsing is bounded to 20 nested levels and 500 parts.
- Google OAuth authorization/refresh, Gmail Inbox/Archive/Trash synchronization, Google primary-calendar agenda download, Gmail send/read/archive/trash/restore; TLS IMAP Inbox/Archive/Trash synchronization, verified folder moves, read operations and SMTP send; read-only CalDAV collection download. **These connectors are implemented but not accepted against real accounts yet.**
- Light/dark/system appearance, accent palettes, compact density, configurable home-row commands, responsive layout and standard focus navigation.
- Logical JSON backup of content, cached messages, preferences and revisions; transactional restore into an empty workspace. Credentials, owner password, OAuth tokens and local process state are excluded. Restored provider data becomes a local archive.

## Account connections and active-use sync

Choose **Settings → Add account**, then select either:

- **Account setup:** Gmail connects through Google sign-in after one-time installation configuration in Settings → Google integration, with optional read-only Calendar access. IMAP and CalDAV offer guided and manual setup, optional checks, and a masked review before saving.
- **Manual setup:** all configuration fields on one screen, with the same validation and optional checks.

Switching between these paths, going Back, or temporarily choosing another provider preserves entered values while the dialog remains open. Each provider has a separate draft. Secrets stay masked in inputs and are omitted from the review. Drafts are kept only in memory, never localStorage; closing the dialog clears them. Saving stores credentials encrypted on disk. Neither path automatically synchronizes or sends mail.

**Test connection** signs in to IMAP using read-only Inbox access, checks MOVE support and the archive folder, and signs in to SMTP without sending a message, or checks a CalDAV collection's properties without downloading events. Archive checks list folders and read their status; they do not move messages or prove write permission. Results are cleared if settings change. Checks do not save an account or validate mail delivery. You may save for later if a check cannot run on the current host. Google accounts are created only after Google authorization succeeds and Gmail confirms the account address. Cancelled or failed authorization does not create an account.

All connections require public DNS hostnames and verified TLS; private LAN endpoints and self-signed certificates are intentionally not supported initially. Generic mail currently uses **IMAP 993 and SMTP 465 with the same username/password**. STARTTLS/587, separate SMTP credentials are future work. Check your provider's app-password policy.

For CalDAV, supply the actual calendar **collection URL**, username and password/app password. Discovery from a service's home URL is not implemented. Redirects are not followed; use the final HTTPS endpoint. Only ports 443/8443 are accepted.

In **Settings → Google integration**, configure your own Google Cloud web OAuth client once per installation. Enable Gmail API and optionally Calendar API. Register the **exact callback URL** shown there, including `api.php?r=oauth-callback`. Configure the consent screen and test users as needed. Save the client ID, secret, and callback. A blank secret retains the saved secret only for the same client ID. These settings are encrypted and excluded from JSON backups.

You can register both your hosted HTTPS callback and your local callback in the same web client. The Windows launcher defaults to `http://127.0.0.1:8765/api.php?r=oauth-callback`; use the address actually shown by your installation. Keep its hostname and port fixed. Enter the client credentials once in each installation and authorize accounts separately there. Do not copy a live database to transfer connections.

Then choose **Add account → Guided setup (or Manual setup) → Gmail**, enter your email, optionally include Google Calendar, and choose **Connect with Google**. Google confirms the actual address; duplicate accounts are rejected. Reauthorization must use the original address. Gmail modify access includes reading, sending and organizing messages; Calendar access is optional and read-only. Existing Google accounts keep their credentials and Calendar behavior. Changing integration credentials affects future connections; existing connections continue using the credentials under which they were authorized.

Personal-use verification exceptions and testing-token expiration depend on Google's policy; an unverified/testing client is not promised permanent authorization. Testing grants normally expire after seven days. Domain/port changes require updating the registered callback; existing accounts retain their original callback for reauthorization.

Opening the app initiates a check. Further checks run every two minutes while the tab is visible and the owner has interacted within the last two minutes. Manual **Sync now** also checks accounts. Hidden or idle tabs initiate no new checks; an already-running request may finish. No jobs or sends happen when the application is closed. No push notifications or reminders are delivered while it is closed.

Mail synchronization checks complete identifier lists for **Inbox, Archive and Trash**, downloading up to 10 recent messages per folder and refreshing previously cached membership and read flags. Gmail lists are paginated; IMAP uses folder-specific UIDs and UIDVALIDITY. Downloads remain limited to 1.4 MB per message. Gmail Archive means mail without Inbox, Trash, Spam or Draft labels, including sent messages outside Inbox; custom labels are preserved. Calendar downloads remain limited to up to 100 objects in the previous week/next 90 days.

In Mail, accounts and their nested folder lists appear directly beneath **Mail** in the left application panel. Expand an account there and choose **Refresh folders** to discover its server folders or Gmail labels. The list is saved for later use, including offline browsing of downloaded messages. On narrow screens, use the **Show mail folders** button beneath the Mail icon to open the folder panel; selecting a folder closes it. Nested folders have expandable parent groups. Folders with identical names in different accounts stay separate. Select a folder to refresh its contents independently of other folders. **Load more** increases the recent message window by 10, up to 500; previously cached messages remain available. The currently open account folder is also refreshed during the normal active-use sync checks and **Sync now**. Other custom folders refresh when opened or through **Refresh mail**. Folder lists refresh on request. This is a cache rather than a complete historical mailbox download; failed network requests leave downloaded mail available.

Choose **New folder** (or **New label** for Gmail) to create one. Enter the full path for nested folders, using the server's hierarchy separator (commonly `/` or `.`); Gmail uses `/`. Select a custom folder to rename or delete it. IMAP renames update cached paths, including subfolders. IMAP deletion requires an empty folder without subfolders, checks the server again, and asks for confirmation. Stale cached originals are retained in Recovery copies. System folders and parents containing system folders are protected. Gmail deletion removes a label from messages without deleting the messages; renaming changes the selected label only. International IMAP folder names use modified UTF-7 and require PHP iconv.

Open a connected message and choose **Move / Labels** to file it. Use the selection shortcut (`v` by default) on several messages to file them together; all selected messages must belong to the same account. IMAP moves use the same verified MOVE operation as Archive. Gmail offers **Add label**, **Remove label**, or **Move here**. Move here adds the chosen label and removes Inbox/Trash; other labels remain. One cached Gmail message can appear in several label views. Bulk operations run message by message; if one fails, Office reports how many completed and reloads the cache. Refresh the affected folders before retrying an uncertain provider operation.

Synchronization publishes an account's mail changes only after all selected folder scans and requested downloads succeed. A refused folder, incomplete search, failed page or time-budget error keeps the previous mail view. Large accounts or slow servers can exceed the 45-second mail budget; Office reports this rather than treating a partial list as deletions. Changes made on another device appear on the next successful sync. Folder changes during a scan can require another sync.

Messages missing from the synchronized folders leave the normal mail view. By default Office keeps their originals under **Recovery copies**, separate from **All cached mail**. Such a message may have been deleted or moved to an untracked folder; recovery does not establish its current location. Choose **Save locally** to retain an independent copy in **Local mail**, or **Discard copy** to remove only Office's recovery copy. Settings lets you disable retained recovery copies; absent cached messages are then removed during the next successful sync. Local mail is always independent of server reconciliation. Earlier **Not in Inbox** entries appear in Recovery copies and are reconciled on the next sync.

Choose **Settings → Connected accounts → Repair / resync** for an IMAP or Google account to rebuild membership and refresh the contents of previously cached messages as well as recent downloads. Repair keeps credentials and local mail; it requires a working server connection. Connection and permission failures appear in the account status and the action's error message. This does not recover a message permanently deleted from the server unless a local recovery copy exists.

Mail actions update the provider: **Archive**, **Move to Trash**, **Restore to Inbox**, **Move / Labels**, and read/unread. Trash is a server folder, so provider retention policies apply; Office does not permanently expunge server mail. IMAP moves require UID MOVE support and existing folders. Defaults `Archive` and `Trash` resolve unique server-designated folders or unique nested folders with those names. Explicit custom paths must match exactly. Missing default folders are skipped during sync; moving mail there reports a missing-folder error. Ambiguous or missing explicitly configured paths fail the scan. Office creates folders only through the explicit New folder action and never uses a broad EXPUNGE fallback. IMAP over Gmail may require an explicit existing archive path; the Google connector handles Gmail's labels directly.

An IMAP move succeeds only after Office verifies that the source UID existed, disappeared from its source folder, and the same message contents appeared under a new UID in the destination. The cache then stores the destination folder, UIDVALIDITY and UID, allowing subsequent read, trash and restore actions. Verification examines at most 10 new destination messages. If confirmation fails after MOVE, use Sync now or Repair / resync before retrying; the move may already have completed. External moves are matched only when the downloaded message contents are identical and unambiguous; Message-ID searches also check older destination messages outside the recent window. Otherwise the old copy is kept separately according to the recovery preference. Sync, repair and mail actions on the same account cannot overlap. The **Cached** badge describes a downloaded copy, not a live connection. **All cached mail** excludes Trash and recovery copies; use their dedicated folder filters to manage them.

Sending requires an explicit button and confirmation. A draft is marked as sending **before** contacting the provider. Failed/interrupted sends remain “Delivery uncertain”; check the provider/recipient before composing a replacement. There are no automatic resend attempts. Generic SMTP does not append a Sent copy to IMAP. The app itself retains a local Sent record. Reply composition quotes the original text but threading headers, attachments, multiple recipients, CC/BCC and signatures are deferred.

Calendar imports retain raw event sources for original download when available. The agenda does not expand CalDAV/local recurring series or handle invitation replies, exceptions, alarms or remote writes. Google expanded instances are read from its API. Use your existing calendar client for those workflows. Local task recurrence/contact synchronization are also deferred.

## Keyboard operation

Right-click an item in any application's list to open its action menu. Ctrl/Cmd-click toggles individual items; Shift-click selects a range. Right-clicking within a selection keeps that selection, while right-clicking another item targets that item alone. Menus show actions available for the entire selection, including bulk task completion, mail actions, export, and local deletion. Local deletion and discarding recovery copies require confirmation. Bulk changes run one item at a time; a failure reports how many completed and refreshes the view before retrying.

With an item focused, Shift+F10 or the Menu key opens the same menu. Use arrows, Home/End and Enter to choose an action, or Escape to close it. Text fields and editors retain their normal browser context menus.

Press `?` for context help. Normal mode: `j/k` next/previous, `h/l` focus list/detail, `gg/G` first/last, `/` search, `n/N` move through results, `g 1`–`g 7` change apps, `c` create, `i` edit, `v` select, `s` save, `d` delete the current item (with confirmation) or move connected mail to Trash. Mail: `a` archive selected messages, `m` toggle read/unread, `r` reply. `Escape` leaves an editor and saves; Ctrl/Cmd+S saves. Single-character bindings can be remapped in Settings. The delete shortcut leaves synced read-only items and connected mail already in Trash unchanged. No send key is enabled.

In spreadsheets, focus a cell, use h/j/k/l or arrows to move, i/Enter to edit its formula, Escape to return, Tab/Shift+Tab to move cells. Typing fields keep their normal text input and browser editing behavior. **Full Vim motions/operators in text editors are not implemented yet.** The current mode distinction supplies home-row application navigation, not a full Vim emulator.

## Moving and backing up

Use Settings → Download full backup for a consistent snapshot. Backups include message/document contents and are sensitive; store them privately. Restore into a fresh empty installation so existing records cannot be overwritten accidentally. Browser file imports, including JSON backup restore, are initially limited to 8 MB; for larger workspaces, stop access and copy the complete folder. Chunked/streaming large-backup restore is future work. Reconnect provider accounts after restoring.

Alternatively stop the local server (or put hosted access into maintenance) and copy the **whole application folder**, including its private data and key. The key and encrypted credentials travel together; this is protection against exposing the database alone, not disk encryption. Sessions should not be shared between people. Browser sessions/callback registrations do not become portable merely by copying files. Never move/copy just an active SQLite database file.

## Development and packaging

No frontend build step is needed. Run:

```sh
node --test tests/formats.test.mjs
php tests/backend.php
php tests/mail-sync.php
php tests/google.php
node tests/http.mjs
```

Enable the PHP extensions mentioned above in your CLI configuration. The HTTP integration test launches its own temporary servers/data and tests actual backup/restore; set OFFICE_PHP to your PHP executable and optionally OFFICE_PHP_EXT to its extension directory. `tests/browser.mjs` additionally needs Playwright and a browser, and an isolated local test server. Set `OFFICE_TEST_URL` and `OFFICE_TEST_DATA` if not using its default `127.0.0.1:8787` / `.runtime/browser-data`. Never point this test at your actual workspace: it creates test records. `OFFICE_NODE_MODULES` can point to an existing package.json for resolving Playwright, and `OFFICE_BROWSER_CHANNEL=msedge` selects installed Edge. Screenshots go into ignored `test-results/`.

On Windows PowerShell, create a hosting ZIP with:

```powershell
./scripts/package.ps1
```

The Windows browser test runner creates a fresh isolated workspace and stops its server afterward:

```powershell
./tests/run-browser.ps1 -PhpBinary path/to/php.exe -BrowserChannel msedge
```

If CLI extensions are not configured, supply `-PhpExtensionDir path/to/ext`. After building the Windows ZIP, `./tests/windows-portable.ps1` tests the actual batch launchers, paths with spaces, repeated launch and folder copying without opening a browser. Both tests retain their isolated artifacts under ignored `.runtime/`; they do not touch the real `data/` folder.

For a Windows ZIP, download an official PHP x64 NTS distribution, compare its hash with the official manifest, then:

```powershell
./scripts/package.ps1 -WindowsRuntimeArchive .runtime/php.zip -ExpectedSha256 <official-sha256>
```

The packaging script copies only release sources and an empty data directory. It never includes your live `data/`, `.runtime/` or test output. Release ZIPs and clean extracted build folders go into ignored `dist/`.

See [the implementation plan](docs/implementation-plan.md) for staged work and acceptance criteria. No real-account or shared-host compatibility is implied by local tests.
