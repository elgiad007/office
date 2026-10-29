# Portable Windows PHP runtime

The Windows release ZIP includes the official x64 non-thread-safe PHP distribution here, including its DLLs and extension files. No PHP or Apache installation is required. `php.exe` supplies the local HTTP server. Its companion files must remain together.

Source checkouts contain only this configuration. To build the Windows bundle, place the official PHP ZIP in `.runtime/php.zip`, verify its SHA-256 against the official release manifest, and run `scripts/package.ps1 -WindowsRuntimeArchive .runtime/php.zip -ExpectedSha256 <official-sha256>`.

Some PCs need Microsoft's Visual C++ 2015–2022 x64 runtime. If PHP fails to start because a runtime DLL is absent, the launcher reports that startup failed; the package cannot promise to work on every clean Windows machine. Keep the included PHP license/distribution notices. Obtain updates from https://windows.php.net/download/.
