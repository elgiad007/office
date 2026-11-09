# Sheets

[Office user guides](README.md)

Open **Sheets**, press `g 7`, or enter `:sheets`. Choose **New workbook**. Use the tabs to switch worksheets, **Add sheet** to create another one, and **Rename sheet** to name the active tab.

## Enter data and formulas

Select a cell and type in the formula bar, or press `i` or Enter to edit. Use the arrow keys or Tab and Shift+Tab to move between cells. Escape returns focus to the selected cell. Choose **Save** to keep a new workbook.

Start a formula with `=`. Use arithmetic operators `+`, `-`, `*`, `/`, and `^`, references such as `A1`, or ranges such as `A1:A5`. For example, `=SUM(A1:A5)` adds five cells. Other functions include `AVERAGE`, `MIN`, `MAX`, and `COUNT`. Office reports calculation errors and circular references. Formulas refer to cells on the active worksheet.

## Exchange workbook data

The visible grid runs from A1 to L30. CSV imports can retain up to Z100, including cells outside that visible area. Office accepts CSV and its own JSON item format.

- **Export values only** writes the active sheet's calculated results to CSV and protects formula-like text. Use it for sharing results.
- **Export with formulas** writes raw cell contents to CSV for a trusted workflow.
- Use **Export** in the app header or export several selected workbooks to get an Office JSON file containing all their sheets. A single-sheet CSV covers only the active sheet. See [Import and export](import-export.md).
