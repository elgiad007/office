# Updates

[Office user guides](README.md)

Open **Settings → Updates → Check for updates**. Compare the available release to the installed version. Use **Release notes** to read about the release and **Download ZIP** to get the package for your installation. Older or unsigned installations need a one-time manual upgrade to a signed package before they can use this check.

## Windows portable installation

1. Start the signed Windows release with **Start Office.bat**.
2. Save work in every Office tab and choose **Install and restart** in Updates.
3. Wait for Office to verify the package and restart on the same port. It waits for active PHP requests and takes a private data snapshot. If startup fails, the updater restores the previous files and data.
4. Reopen or refresh Office and check the installed version.

For the one-time manual upgrade, stop the old copy with **Stop Office.bat**. Extract the signed Windows ZIP to a new folder, copy the old installation's private `data/` into it, and start the new installation.

## Linux or hosted installation

Use the hosting ZIP. The administrator stages the release outside the public document root, pauses access, and waits for active requests to finish. Keep private copies of the stopped installation's data and the previous release files. Replace the application files while preserving the private `data/` directory or configured `OFFICE_DATA_DIR`, then restore access with the document root still pointing at `public/`.

## Recover an interrupted Windows update

Update logs and recovery snapshots are under `.office-update/<job>/` beside the launchers. They can contain private data. If Office is still unavailable after an interruption and `.office-update/pending` exists, open PowerShell in the installation folder and run:

```powershell
$job = (Get-Content -Raw -LiteralPath '.office-update/pending').Trim()
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".office-update/$job/recover.ps1" -Job $job -Recover
```

The script restores the previous installation or finishes cleanup for a completed update. If it reports that the update lock is in use, let the updater finish before trying recovery. Once the upgrade is verified and you no longer need its recovery snapshot, you can remove the completed job folder.
