# Portable Office — initial implementation plan

## Agreed requirements

- Personal, single-owner suite: mail, calendar, tasks, contacts, documents, wiki, and simple spreadsheets.
- Gmail and generic IMAP/SMTP/CalDAV have priority. No mail server is hosted by this application.
- Linux shared hosting managed through cPanel (an account created under a WHM reseller account).
- Upload one folder, point a domain at its `public/` directory, complete setup in the browser. No Docker, root access, server build, cron, or persistent worker.
- PHP and SQLite backend; prebuilt browser assets and dependencies ship with the release. Data stays inside the application folder, outside the public document root.
- Local use runs the same PHP application through a local web server. The Windows release bundles the PHP executable and companion DLLs, with `Start Office.bat` / `Stop Office.bat`. No Apache or PHP installation is needed on compatible Windows x64 systems; a missing Microsoft VC runtime may still need attention. Linux local use requires existing PHP. This is not a `file://` application.
- Synchronize only while the application is actively used. Short, resumable requests, explicit status and manual refresh. No scheduled jobs or background sending.
- Simple document editing takes priority over high-fidelity Word/LibreOffice compatibility. Initial portable formats are Markdown, HTML, and plain text; PDF through browser printing. DOCX/ODT conversion is deferred.
- Home-row/Vim bindings are a primary interaction method. Light/dark/system themes, accent and density preferences, standard Tab navigation, visible focus, accessible forms and dialogs.
- Import/export and a recoverable full backup are essential. Never upload imported items into remote accounts implicitly.

## Architecture

Use PHP 8.2+ with PDO SQLite, OpenSSL, cURL and DOM for live connectors. Serve browser-native JavaScript modules and CSS; a frontend build/runtime is unnecessary for this first version. This replaces the earlier provisional React/Node/Docker architecture and minimizes deployment dependencies.

`public/` contains only the browser assets and PHP entry points. `app/` contains backend code. `data/` contains the SQLite database, the encryption key and a setup token. All are within the parent folder; only `public/` is web accessible. Credentials are encrypted at rest with a key outside the public directory. A full backup excludes credentials by default; account reconnection is required after restoring elsewhere.

Use request-scoped SQLite connections, foreign keys, a busy timeout and transactions. Content records have revision numbers to reject stale edits. Keep revision snapshots for text records. Export a consistent logical JSON backup rather than copying an open WAL database. Imports validate before a single transaction and never replace account credentials or owner authentication.

## Delivery phases

1. **Portable foundation:** environment check, one-time setup token, owner login, secure sessions, CSRF protection, shared application shell, themes, home-row navigation, SQLite migrations, backup/restore.
2. **Useful local suite:** task and contact CRUD, local calendar agenda, Markdown wiki with namespaces/backlinks/history, simple rich-text documents, small multi-sheet spreadsheets with a deliberately bounded formula engine. Import/export JSON, Markdown/text/HTML, CSV, ICS, vCard and EML as appropriate. Unsupported content is retained or reported, never silently presented as lossless.
3. **Active-use connectors:** configure IMAP/SMTP, Gmail OAuth and a specific CalDAV calendar collection. Bounded inbox/agenda refresh, explicit outgoing sends, remote mail actions. No automatic retries of ambiguous sends. Cache is identified as a recent window, not a complete account archive. Preserve raw source data for downloaded emails/calendar objects. Secrets never return in normal API responses.
4. **Daily-use hardening:** paging and incremental synchronization, folder discovery/moves, attachments and MIME fidelity, invitation workflows, recurrence expansion and exceptions, additional calendars, contact sync, provider conflict handling, richer Vim text editing and spreadsheet functionality.

## First implementation acceptance criteria

- Runs from an extracted folder with no server dependency installation.
- Setup is token protected and single-owner; unauthenticated API access fails.
- Every local application can create, edit, persist and export its content.
- Navigation works with j/k, h/l, gg/G, /, n/N, i, Escape and ? without stealing characters from editable controls. All controls remain reachable using Tab. Bindings are documented and remappable.
- Edits survive refresh; stale writes are rejected. Autosave status reflects persisted state.
- Backups restore local records and revisions transactionally without sending mail or changing remote accounts.
- Hidden tabs and idle sessions do not initiate new sync. A short in-flight request can finish. Reloaded pages do not resend mail.
- Live connector behavior is tested against deterministic protocol fixtures; actual Gmail authorization and shared-host connectivity require real-account acceptance.
- Document conversion, calendar recurrence/invitations, MIME attachments, browser notifications while closed and comprehensive eM Client/LibreOffice parity are not first-version claims.

## Validation and rollout

Run PHP syntax checks, backend integration/security/round-trip tests, formula/parser tests and browser checks for setup, keyboard navigation, editing, import/export and persistence. Test with empty data and explicit fixtures, never populate the real installation with example personal information.

Before hosting, verify PHP version/extensions, writable private data storage, outbound HTTPS/IMAP/SMTP, filesystem locking, request memory/time limits, and an HTTPS domain whose document root is `public/`. Gmail setup needs user-owned OAuth client credentials, enabled APIs and a domain-specific callback. Moving domains requires updating that callback. No actual hosting deployment or real-account send is part of local implementation.

## Remaining scope

### Account setup: guided and manual paths

Add an explicit setup-method choice to Add account. Guided setup covers provider/identity, provider-specific instructions and fields, optional non-destructive connection checks, a review with masked secrets, and completion. Google guidance links to the Cloud console, explains enabling both APIs and configuring consent/test users, supplies a copyable callback, and offers authorization after saving. Google credentials can only be verified by completing Google's authorization flow.

Manual setup shows the full fields immediately. Both paths share one in-memory draft per provider and the same backend validation/save route, so switching paths or going Back preserves values. Secrets are not put in browser storage and are cleared when the dialog closes. Editing settings invalidates any previous check result. Tab/Enter/Escape, labelled controls and focus management must work across steps.

An authenticated, CSRF-protected account-test route checks IMAP login/read-only Inbox access, SMTP login without sending, or a CalDAV collection's properties. It must neither save an account nor fetch messages/events. Google testing is explicitly configuration-only pending authorization. Tests cover switching paths, back navigation, validation/errors, masked review, manual and guided saves, and Google completion. Rebuild both portable distributions after validation.

MBOX/ZIP content archives, bulk attachment import/export, external calendar writes, full recurrence display, CalDAV discovery, full Vim operators in rich text, offline editing and DOCX/ODT/XLSX/ODS conversion are subsequent work. A portable Windows runtime bundle and launcher are included in this initial delivery. Keep these limits visible in the README and interface.
