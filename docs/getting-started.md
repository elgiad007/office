# Getting started

[Office user guides](README.md)

## Start Office and sign in

Open your Office address in a browser. On Windows, double-click **Start Office.bat** to launch Office and open the address for you. If you haven't installed the software yet, see [Install Office](installation.md).

On first launch, enter the one-time setup token and create the first profile with a password of at least 12 characters. The Windows launcher displays the token. You can also find it in `data/setup-token.txt` in the private installation directory. After setup, choose your profile and enter its password. Sessions expire after an hour of inactivity or 12 hours after signing in. Sync and polling do not extend the idle deadline.

The first profile is the installation owner. In **Settings → Profiles**, choose **Create invitation** and give the code to the person joining. From the sign-in screen, they choose **Create profile**, enter the code, and set their own name and password. Each code works once and expires after 24 hours. Profile names are visible in the sign-in picker, so use names you're comfortable displaying there.

Each profile starts with its own empty workspace, including its own mail accounts, records, and preferences. Select your profile name in the top bar to switch profiles; on a phone, open **More** to reach it. Tabs in the same browser session share a sign-in. Use separate browser profiles or devices to keep two Office profiles open at once.

On upgrade, your existing workspace appears as **Default**. Sign in again with your existing password. Your items and provider connections stay in place.

## Create and save an item

1. Choose an app from the sidebar, such as **Tasks**.
2. Choose the app's **New** action, or press `c` outside a typing field.
3. Enter a title and any details, then choose **Save** or press `Ctrl+S` (`Cmd+S` on Mac).

A new item stays in memory until its first save. If you leave it, Office offers **Save**, **Discard Draft**, and **Cancel**. Refreshing or closing the tab warns about unsaved work. Preview, export, and sync do not create a saved copy. Existing items save changes automatically. The item toolbar shows the current save status. In Mail, a saved draft stays in **Drafts** until you send or discard it.

## Find and manage items

- Use the app's search box or press `/` to focus it. The list and detail pane show the current results and the selected item.
- Right-click an item to see its available actions. Use Ctrl/Cmd-click to toggle individual items or Shift-click to select a range, then open the menu on the selection.
- On a phone, open **Menu** to change apps and **Back to list** to leave an item. Some actions are under **More** or **More actions**.
- Press `?` or choose **Keyboard shortcuts** in the sidebar for searchable help. See [Keyboard navigation and commands](keyboard-navigation.md) for the default keys.

You can use the local apps and import files before adding an account. When you're ready to bring in provider mail or calendar events, see [Accounts and sync](accounts-and-sync.md). To save a copy of the workspace, see [Backups and moving Office](backups.md).
