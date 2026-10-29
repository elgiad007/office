# Initial delivery status

## Implemented

- Portable PHP/SQLite application and a shared responsive interface for all seven apps.
- Owner setup/login, sessions, CSRF checks, encrypted provider credentials, stale-write rejection, unique wiki names and text revisions.
- Functional local tasks, contacts, agenda, rich-text documents, Markdown wiki and multi-sheet workbooks.
- Home-row application commands and remapping, standard keyboard focus, light/dark/system themes, three accent palettes and compact density.
- JSON backup/restore and item import/export; CSV workbooks, basic vCards, ICS, EML, text, Markdown and safe HTML. Original binary mail source is stored as base64; original ICS sources can be downloaded. The README documents format and size limits.
- Active-use Gmail/Google Calendar, IMAP/SMTP and CalDAV connector code; read/archive mail actions; explicit sends with a persisted uncertain state on failure. No cron jobs, automatic sends or background workers.
- Guided and manual account setup with shared validation, drafts preserved across paths/provider changes, masked review, connection checks that do not save or download, Google project instructions/copyable callback, and post-save authorization. Google configuration checks are distinguished from actual Google authorization.
- Windows batch launch/stop scripts and a release bundle containing the official PHP executable/DLLs, configuration and a CA bundle. Linux shared-hosting ZIP contains the application but no Windows runtime binaries.

## Verified locally

- PHP syntax checks for all backend entry points/modules.
- Seven JavaScript tests for CSV/vCard/ICS round trips, Markdown safety and formula evaluation, including cycles, scripts and shared dependencies.
- PHP tests for revisions, conflicts, secret encryption/decryption, time zones, MIME decoding, private-endpoint rejection, workbook validation, transaction rollback and an IMAP literal fixture.
- HTTP integration between two isolated installations: authentication/session rotation, CSRF, stale writes, unique wiki names, atomic imports, binary EML, original ICS, sheet persistence, encrypted secrets and full logical backup/restore with revisions/preferences.
- Browser workflows for setup, all local apps, j/k and gg navigation, keyboard help, autosave, persistence, wiki links/backlinks, script safety, spreadsheet formulas and reload persistence, dark mode, mobile layout, CSRF and invalid imports.
- Account-setup browser checks: guided/manual creation, provider-specific drafts, switching paths, Back navigation, validation and failed-save recovery, copyable Google callback, configuration-only Google check and authorization handoff, masked review, invalidated connection checks, keyboard use and mobile layout. Connection success/failure UI uses controlled provider fixtures; actual Google configuration checks and account saves use the PHP backend.
- Account-test HTTP checks: owner/CSRF requirements, shared input validation, no stored accounts from checks, no secret echo, and rejected private IMAP/SMTP endpoints. Real-provider acceptance remains required.
- Extracted Windows release: actual batch start/stop, bundled PHP/SQLite, setup and persistence, paths with spaces, repeated launch reuse, and copying the complete stopped folder to another path. This was tested on the current Windows machine; it does not establish compatibility with every clean Windows installation.

## Acceptance still required

- Actual hosting.com account: PHP extensions, public document root, SQLite locks, outbound TLS ports and shared-host execution limits.
- Real Gmail OAuth authorization/refresh, provider messages, calendar collections, SMTP acceptance, IMAP MOVE behavior and mailbox-specific folder names. Local fixtures are not provider acceptance.
- Keyboard/screen-reader review in the user's normal browsers. Full Vim operators inside rich text/source editors are not provided yet.
- Larger data sets and large backup restoration. Initial browser import/restore is limited to 8 MB; stop access and copy the full folder for larger migrations.

## Deliberate first-version limits

No complete mailbox synchronization or deletion reconciliation, external calendar edits/invitations, CalDAV recurrence expansion, MIME attachment viewer, MBOX, full DokuWiki/CommonMark compatibility, offline editing, or DOCX/ODT/XLSX/ODS conversion. Sync is a bounded recent snapshot. Embedded raster document images are supported; external images are omitted. See README for exact behavior and next phases in implementation-plan.md.
