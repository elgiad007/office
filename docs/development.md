# Develop and test Office

[Documentation index](README.md)

## Run a source checkout

From the repository root, run `php -S 127.0.0.1:8765 -t public` with PHP 8.2+ and PDO SQLite, then open the local address and follow [first-run setup](getting-started.md). For concurrent local requests on Windows, see the [portable Apache setup](development-server.md).

## Build the frontend

Edit the TypeScript source in `frontend/`, then regenerate and commit the browser-ready ES modules in `public/`. This lets a checkout or release ZIP run directly with PHP. Node and pnpm are development tools.

Install development dependencies using Node.js and pnpm, then build and check the frontend:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm test
```

`pnpm build` compiles TypeScript without bundling or a framework. `pnpm build:check` checks types and verifies that the committed JavaScript matches the source. Packaging and the Windows browser test runner perform that same check and stop if the output is stale. Commit updated `public/*.js` alongside frontend changes. To rebuild automatically while editing, use `pnpm exec tsc --watch`, then run `pnpm build` before committing to restore the generated-file headers.

Shared contracts for records, accounts, preferences, and route-specific API responses live in `frontend/types.ts`. PHP validates requests and imported data at runtime.

## Test the application

```sh
php tests/backend.php
php tests/mail-index.php
php tests/connections.php
php tests/connection-explorer.php
php tests/connection-archive.php
php tests/attachments.php
php tests/mail-sync.php
php tests/mail-lock.php
php tests/gmail-imap.php
php tests/mail-transfer.php
php tests/activity.php
php tests/google.php
node tests/http.mjs
```

Enable the [required PHP extensions](installation.md#install-through-cpanel) in your CLI configuration. The HTTP integration test launches its own temporary servers/data and tests actual backup/restore; set OFFICE_PHP to your PHP executable and optionally OFFICE_PHP_EXT to its extension directory. `tests/browser.mjs` additionally needs Playwright and a browser, and an isolated local test server. Set `OFFICE_TEST_URL` and `OFFICE_TEST_DATA` if not using its default `127.0.0.1:8787` / `.runtime/browser-data`. Never point this test at your actual workspace: it creates test records. `OFFICE_NODE_MODULES` can point to an existing package.json for resolving Playwright, and `OFFICE_BROWSER_CHANNEL=msedge` selects installed Edge. Screenshots go into ignored `test-results/`. `node tests/attachments.integration.mjs` starts its own isolated server and verifies attachment UI/downloads, drag and drop, forwarding/replies, preview isolation, ZIP output, backup/restore and mail reader regressions; it accepts the same Playwright variables plus `OFFICE_PHP` and `OFFICE_PHP_EXT`.

The Windows browser test runner creates a fresh isolated workspace and stops its server afterward:

```powershell
./tests/run-browser.ps1 -PhpBinary path/to/php.exe -BrowserChannel msedge
```

If CLI extensions are not configured, supply `-PhpExtensionDir path/to/ext`. After building the Windows ZIP, `./tests/windows-portable.ps1` tests the actual batch launchers, paths with spaces, repeated launch and folder copying without opening a browser. Both tests retain their isolated artifacts under ignored `.runtime/`; they do not touch the real `data/` folder.
