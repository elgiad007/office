# Backups and moving Office

[Office user guides](README.md)

## Download a workspace backup

1. Open **Settings → Backups** or enter `:backup`.
2. Choose **Prepare backup**. Verify your owner password if prompted. Office requires password verification within the previous five minutes.
3. When the status says the backup is ready, choose **Download SQLite backup** and save the file privately.

The backup includes local records, cached mail and events, downloaded attachments, revisions, preferences, and connections. The owner password, provider credentials, OAuth tokens, activity log, and local process state are excluded. Content and attachments that were never downloaded are unavailable in the backup.

## Restore to an empty workspace

1. Start a fresh Office installation and create its owner password.
2. Open **Settings → Backups → Restore backup**.
3. Select the Office `.sqlite` backup or a legacy Office `.json` backup and confirm the restore.
4. Check your content, then reconnect any provider accounts you want to sync. Previously synced copies restore as local archives.

Legacy JSON restores are limited to 8 MB. SQLite restores default to 128 MiB. For larger SQLite files, the administrator can raise `OFFICE_SQLITE_RESTORE_MAX_BYTES` and align the PHP and web server upload limits.

## Move a portable installation

To keep the whole installation, including its existing credentials, save your work and stop Office first. On Windows, use **Stop Office.bat**. Copy the entire installation folder, including the private data directory and its key, then start Office from the new location. For a hosted installation or a separate private data directory, have the administrator take the installation offline and preserve that directory as part of the move.

The folder contains private workspace content and the key used with encrypted credentials. Keep it private. Sign in again as needed, and review the Google callback if the workspace address changes.
