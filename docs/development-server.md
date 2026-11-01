# Portable Windows development server

Office can run on Apache without WSL, an installer, a Windows service, or a database server. PHP remains the application runtime; Apache serves HTTP and dispatches PHP requests across four separate FastCGI processes. All listeners bind to loopback only. Only `public/` is exposed.

## Install and start

With the existing Windows PHP runtime in `runtime/windows/`, stop Office, then run:

```powershell
./scripts/install-apache.ps1
./scripts/start-windows.ps1 -NoBrowser
```

The installer downloads Apache Lounge's Windows x64 ZIP and verifies its pinned SHA-256 before extraction. Its license and notices remain inside `runtime/apache/`. The Apache build requires the Microsoft Visual C++ runtime described on the publisher's download page. No service is registered.

`Start Office.bat` automatically selects Apache when `runtime/apache/Apache24/bin/httpd.exe` exists. The URL remains `http://127.0.0.1:8765/`; use `-Port 8766` to choose another port. `Stop Office.bat` shuts down this instance and its PHP workers. Stop before moving the folder, upgrading binaries, or copying data. Generated absolute paths are rebuilt on every start, so the stopped installation is portable.

Private configuration, PID state and logs live in `data/`. Startup checks the HTTP port, validates Apache's configuration, and cleans up processes if startup fails. Shutdown verifies executable paths, command lines and creation times before stopping saved processes. Start/stop does not install, reconfigure or stop another Apache installation.

If Apache is absent, the existing PHP development server remains available. To select it explicitly use `Start Office.bat -DevelopmentServer`. Stop the current server before changing modes. Apache binaries are ignored by Git; the installer makes a source checkout reproducible.

## Packaging

Pass `-ApacheRuntimeArchive .runtime/apache.zip -ApacheExpectedSha256 <publisher-sha256>` to `scripts/package.ps1` along with the existing Windows PHP archive/hash parameters. This includes the portable Apache files in the Windows release ZIP without user data or credentials. Hosting ZIPs do not require Windows binaries.

## Linux deployment

Use the host's Apache/PHP-FPM (or Nginx/PHP-FPM), with several PHP workers and `public/` as the document root. The Windows launcher/configuration is development infrastructure, not a Linux dependency. Match PHP extensions and upload/request limits; retain a working CA certificate store. SQLite and credentials keep their existing format. Do not copy an active database alone.

## Mail performance

Normal sync reuses cached originals and downloads content only for uncached messages in the requested window. Repair / resync still reloads cached originals. Gmail label views share cached content. IMAP servers advertising CONDSTORE use changed-flags requests after a successful baseline; other servers use bounded full flag batches. Folder membership remains fully reconciled, and failed scans do not advance checkpoints or publish partial membership.

Moves reuse cached originals after source UIDVALIDITY validation. A single-message COPYUID mapping can establish the destination without downloading its body; Office still confirms source removal, destination UIDVALIDITY and destination existence. Servers without a usable mapping retain byte-content verification. Gmail keeps its account-wide identity verification.

Mail lists omit remote original-message blobs, keeping bodies for immediate text reading and body search. Original EML and exports fetch full records on demand. Keyboard/mouse navigation updates the affected list rows instead of rebuilding the list. Connected-mail archives advance immediately and restore failed operations.

Account checks run with a maximum of two accounts at once, leaving PHP workers for interactive requests. Mutations for each account remain serialized, but can proceed while that account's background scan is reading the provider. A generation counter changes before and after each mutation. Before publishing, sync briefly takes the mutation lock and checks the counter. A superseded or overlapping scan is discarded without changing membership or advancing its checkpoint; the next scheduled check refreshes it. Separate scan locks prevent two tabs from publishing overlapping scans for the same account. Failed and uncertain writes invalidate old scans too.

The Apache smoke test checks that a fast PHP request completes while another PHP request is sleeping, as well as repeated start, paths containing spaces, private files and complete shutdown. Backend/browser regressions check that actions proceed during a held scan and stale scans cannot undo the resulting cache changes.

Further work: bounded provider batches with reusable connections, durable action queues, Gmail history-based synchronization, and QRESYNC deletion tracking. These require separate handling of partial batch failures, stale cursors and process restarts; this implementation retains complete membership scans and confirmed provider writes.
