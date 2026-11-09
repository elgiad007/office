# Keyboard navigation and commands

[Office user guides](README.md)

Press `?` or select **Keyboard shortcuts** in the sidebar to search the shortcuts and commands available in Office. This guide uses the default bindings. Change single-character bindings in **Settings → Keyboard**.

Normal mode is for Office navigation and actions. Press `i` to enter edit mode on supported items. Text fields, editors, and dialogs use their own controls. Escape leaves edit mode and saves changes to existing items. Use **Save** for a new draft.

## Move, search, and act

| Keys | Action |
| --- | --- |
| `h` / `l` | Focus the pane to the left or right. |
| `j` / `k` | Move to the next or previous item or sidebar entry. In a focused mail body or Wiki page, scroll the content. |
| Arrow keys | Move within lists and sidebar menus. In a spreadsheet grid, move between cells. |
| `gg` / `G` | Go to the first or last item, or the top or bottom of a focused mail body. |
| `g b` | Retrace your previous view, including opened links and events. |
| `g 1` through `g 8` | Switch to Mail, Calendar, Tasks, Contacts, Documents, Wiki, Sheets, or Lists, in that order. |
| `/`, then `n` / `N` | Focus search, then navigate matches in normal mode. |
| `Ctrl+f` / `Ctrl+b` | Scroll the focused list or nonediting content down or up a page. |
| `d` / `u`, or `Ctrl+d` / `Ctrl+u` | Scroll down or up half a page. |
| Tab / Shift+Tab | Move between controls. From the selected row, Tab enters the content pane. |
| `c`, `i`, `s` | Create, edit, or save the current item. `Ctrl+S` or `Cmd+S` also saves while editing. |
| `v`, `D` | Toggle selection or delete. For connected mail outside Trash, delete moves it to Trash. |
| `L`, `z` | Open the selected item's connections or toggle desktop full screen. |
| Shift+F10 or Menu key | Open the item menu. Use arrows or Home/End to choose, Enter or Space to act, and Escape to close. |
| `a`, `m`, `r`, `U` | In Mail, archive, Quick Move, reply, or undo the last deletion. |
| `Ctrl+Enter` | Send the current mail draft. Enter confirms when confirmation is enabled. |
| `x`, `o` | Complete a task with `x`. In a checklist, `x` toggles a focused checkbox and `o` focuses the add field. |

Press the keys of a `g` sequence within about a second. In the sidebar, Enter opens the focused app or folder. Space expands or collapses mail account groups. In Mail, Backspace goes up to a selectable parent, then the account Inbox, then the Mail app button.

## Use the command line

Press `:` in normal mode. Enter runs the command. Use Up/Down to choose a suggestion and Tab to fill it. Escape closes suggestions first, then closes the command line and restores focus.

| Command | Action |
| --- | --- |
| `:mail` (`:m`) | Open Mail. Add an account name or ID to open that account's Inbox. |
| `:calendar` (`:cal`), `:tasks` (`:t`), `:contacts` (`:con`) | Open the corresponding app. |
| `:docs` (`:doc`, `:d`), `:wiki` (`:w`), `:sheets` (`:sh`), `:lists` | Open the corresponding app. |
| `:settings` (`:set`), `:backup` | Open Settings or go directly to Backups. |
| `:new [type] [title]` | Create an item. Types are `mail`, `event`, `task`, `contact`, `doc`, `page`, `sheet`, and `list`. Try `:new task Review budget` or `:new "Review budget"` for the current app. From Settings, specify a type. |
| `:new linked <type> [title]` | Create a draft that links to the current item on first save. |
| `:link [type] <name or ID>`, `:unlink [type] <name or ID>` | Add or remove a connection to an existing item. |
| `:links` (`:l`), `:links all` | Open current-item connections or the workspace overview. |
| `:sync [account]`, `:head` | Sync all accounts or a named account, or show headers for the selected message. |
| `:log`, `:errors`, `:warnings` | Open the activity log at the indicated level. |
| `:q` | Save pending edits and sign out. Unsaved drafts still prompt. |
