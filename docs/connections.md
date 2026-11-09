# Connections

[Office user guides](README.md)

Connect related items across all eight apps. For example, link a message, task, and calendar event for the same appointment. Each item shows the relationship, and the link survives title changes. Links to synced items are stored in Office.

## Link items and open them

1. Save the source item and choose **+ Link** in its header.
2. Search for a saved item by name or ID, then choose it. You can also use a command such as `:link event Budget review`. In command suggestions, use Up/Down to choose, Tab to fill, and Enter to link.
3. Choose **Connections · count** to see linked items. Select one to open it in its own app, or choose **View map** to explore the relationships. Use the unlink action to remove a link while keeping both items.

Use `:new linked task Follow up` to create a draft whose connection is saved with the new task. Use `:unlink [type] <name or ID>` to find and remove an existing link. Wiki's Markdown links are a separate feature.

## Explore the map and list

- Choose **Connections** in the sidebar or enter `:links all` to start with workspace groups. A group contains items joined directly or through other items. Enter `:links` to start with the current item's direct connections.
- Use **Find connected items** to search titles or exact IDs across the workspace. Filter by item type and use the list or load more results when the map shows only part of a group.
- Select a card to highlight its direct connections. Choose **Explore connections** to center on that item or **Open item** to go to its app. With keyboard focus on a card, arrow keys move spatially, Space selects, and Enter explores or opens the item when it is already the center.
- Use **Back**, **Forward**, or the faded **From** card to retrace exploration. Backspace goes back outside typing fields. Drag or use Shift+arrow keys to pan. Use the wheel, pinch, or `+` and `-` to zoom. **Fit view**, **Center selection**, and **Reset view** are in the toolbar.

## Archive relationships or preserve them on deletion

Switch between **Active**, **Archived**, and **All**. You can archive or restore a group, a selected item's connections, or an individual link. Group actions cover the complete group, including links beyond the loaded page. The items themselves remain available. Linking an archived pair again reactivates that relationship.

When deleting a connected local item or discarding a recovery copy, you can preserve its relationships in a named document. Office creates a hub with a deletion note and the links. Export the original first if you need its content or attachments. Moving connected mail to Trash keeps the links on the message. Full workspace backups include connections.
