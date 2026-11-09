# Import and export

[Office user guides](README.md)

Use **Import** in the app header and select a file. Office determines the item type from the format. Import text or Markdown from the app where you want it to land. Imports create local items.

| Format | What it imports | Export options |
| --- | --- | --- |
| `.eml` | An original mail message up to 1.4 MB | Download the original EML when available, or export mail from the app header. |
| `.ics` | Calendar events | Export ICS or download an event's original ICS when available. |
| `.vcf` | vCard contacts | Export one or more contacts as vCard. |
| `.html`, `.htm`, `.txt` | A document when imported from Documents | Export HTML or use **Plain text** or **Print / PDF** in the formatting toolbar. |
| `.md`, `.txt` | A page when imported from Wiki | Export a page as Markdown. |
| `.csv` | A workbook with one worksheet, up to 100 rows and 26 columns | Export the active sheet as values or raw cells with formulas. |
| Office item `.json` | Records from Office item exports | Keep Office-specific content such as multiple workbook sheets and checklist entries. |

The general file picker accepts imports up to 8 MB and applies format-specific limits. Choose an item's **Export** to get its individual format, use the right-click menu for available selection exports, or use **Export** in the app header for the app's collection export. App collections other than Calendar, Contacts, and Mail use Office item JSON.

## Export a mail collection

From the Mail header, open **Mail export options**. **Export cached mail** downloads `mail-cached.sqlite`, which includes header-only records. **Export with missing bodies** tries to fetch missing contents, skips messages that still have only headers, and downloads `mail.sqlite`. Keep the connection available and watch the export status. Choose **Cancel export** if needed.

The mail archives contain message records. To restore an Office workspace or retain downloaded attachment files, use [Backups](backups.md).
