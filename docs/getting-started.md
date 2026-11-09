# Getting started

[Office user guides](README.md)

## Start Office and sign in

On Windows, extract the Windows release ZIP into a writable folder and double-click **Start Office.bat**. The launcher opens Office in your browser at `http://127.0.0.1:8765` by default. Keep the extracted files together. When you're done, save your work and use **Stop Office.bat** before moving the installation or removing its drive.

If your Office workspace is already hosted, open its address in your browser. For installation details, see the [Linux instructions](../README.md#run-locally-on-linux) or [cPanel instructions](../README.md#install-through-cpanel).

On first launch, enter the one-time setup token and create an owner password of at least 12 characters. The Windows launcher displays the token. You can also find it in `data/setup-token.txt` in the private installation directory. After setup, use your password to sign in. Office has one owner per workspace. Sessions expire after an hour of inactivity or 12 hours after signing in.

## Create and save an item

1. Choose an app from the sidebar, such as **Tasks**.
2. Choose the app's **New** action, or press `c` outside a typing field.
3. Enter a title and any details, then choose **Save** or press `Ctrl+S` (`Cmd+S` on Mac).

A new item stays in memory until its first save. If you leave it, Office offers **Save**, **Discard Draft**, and **Cancel**. Existing items save changes automatically. The item toolbar shows the current save status. In Mail, a saved draft stays in **Drafts** until you send or discard it.

## Find and manage items

- Use the app's search box or press `/` to focus it. The list and detail pane show the current results and the selected item.
- Right-click an item to see its available actions. Use Ctrl/Cmd-click to toggle individual items or Shift-click to select a range, then open the menu on the selection.
- On a phone, open **Menu** to change apps and **Back to list** to leave an item. Some actions are under **More** or **More actions**.
- Press `?` or choose **Keyboard shortcuts** in the sidebar for searchable help. See [Keyboard navigation and commands](keyboard-navigation.md) for the default keys.

You can use the local apps and import files before adding an account. When you're ready to bring in provider mail or calendar events, see [Accounts and sync](accounts-and-sync.md). To save a copy of the workspace, see [Backups and moving Office](backups.md).
