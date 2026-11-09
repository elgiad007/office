# Install Office

[Office user guides](README.md)

## Run on Windows

Extract the Windows x64 release ZIP into a writable folder, then double-click **Start Office.bat**. It starts the bundled server on `127.0.0.1:8765` and opens your browser. The console displays the one-time setup token for [first sign-in](getting-started.md). Save your work and use **Stop Office.bat** before moving the folder or removing a USB drive.

Keep the `runtime/windows/` files together. They include the PHP executable, extensions, companion DLLs, and Mozilla CA certificates distributed by curl. If PHP fails to start because a Microsoft Visual C++ DLL is missing, see the [runtime notes](../runtime/windows/README.md). The bundled servers bind to localhost.

Use `Start Office.bat -Port 8766` to choose another port or `Start Office.bat -NoBrowser` to start without opening a browser. Starting again reuses this folder's recorded process. Choose a folder you can write to, such as a folder under your user profile.

Start Office selects portable Apache when installed, with four PHP FastCGI workers. Otherwise it uses PHP's built-in server. For a source checkout, see [Develop and test Office](development.md) or [Package and release Office](releases.md).

## Run locally on Linux

With PHP 8.2+ and PDO SQLite already available, run `sh start-local.sh`. Visit `http://127.0.0.1:8765`. After the first visit, retrieve the one-time token from `data/setup-token.txt` and complete setup. The same code and database format are used locally and on hosting.

## Install through cPanel

1. Upload/extract the hosting ZIP into a folder such as `/home/your-account/office`.
2. Set the domain/subdomain's **document root to `/home/your-account/office/public`**. The application parent and `data/` must not be publicly served. If your account cannot choose this root, resolve that with the host before deployment; do not copy everything into `public_html`.
3. Select PHP 8.2+ with PDO SQLite. Enable OpenSSL for account credentials and cURL and DOM for HTTPS/CalDAV connectors. Give the installation owner write access to `data/` and keep its permissions private.
4. Enable HTTPS using the hosting panel. Open the domain, read `data/setup-token.txt` in File Manager, and complete owner setup with a password of at least 12 characters. The token disappears after setup.

No Composer, Node, root access, Apache installation, cron job or persistent worker is required on the host. The parent `.htaccess` denies requests if the wrong root is selected; `public/.htaccess` permits the intended root. The root configuration is Apache-compatible; other web servers must likewise expose only `public/`.

For mail attachments, allow at least 16 MB for JSON requests and 256 MB of PHP memory. Check the host's request limits separately. For international IMAP folder names, enable the PHP iconv extension.

Verify filesystem locking, outbound connections, PHP extensions, and request limits on your hosting account. Keep SQLite on a local filesystem with working locks.

For an internet-facing installation, redirect HTTP to HTTPS at the web server and enable HSTS after checking HTTPS works. If HTTPS terminates at a reverse proxy, configure the trusted web server or PHP integration to set `HTTPS=on` for those requests. Verify the browser receives a `Secure`, `HttpOnly`, `SameSite=Lax` Office session cookie. Apply request and rate limits at the host, especially to sign-in and the API. Restrict outbound connector traffic where your host supports it. Use distinct hosting accounts or PHP runtime identities for Office domains that require filesystem isolation.

## Password compatibility after an upgrade

Office uses Argon2id where PHP supports it and otherwise uses bcrypt, which has a 72-byte password limit. Successful verification upgrades a bcrypt password hash when Argon2id is available. If an older bcrypt setup accepted a longer password, sign in with the first 72 bytes. If the cutoff splits a Unicode character, contact the installation administrator to reset the stored password hash.
