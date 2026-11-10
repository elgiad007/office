# Calendar

[Office user guides](README.md)

## Find events

Open **Calendar** in the sidebar, press `g 2`, or enter `:calendar`. Choose **Month** for a broad view, **Week** or **Day** for time slots, or **Agenda** for a list. Use **Today**, the previous and next controls, or the mini calendar to change the date. In Month view, select **+ more** to see the rest of a busy day.

Use **Calendars** to show or hide local events and individual account calendars. Search from Calendar to find events stored in Office across all dates, including hidden calendars. Choose **Search connected calendars** below the search heading to look up events directly on your connected Google primary calendar and CalDAV calendars. Leave the dates blank to search all dates and find recurring series, or enter both dates to find individual occurrences in a range of up to 366 days. Select a match to view its details.

In **Settings → Calendar**, choose how many events to show per day in Month view and per batch in Calendar Agenda and the header’s **Upcoming agenda**. Choose **Show more** to reveal another batch. Open the header agenda from the clock to see events in the next seven days.

## Create an event

Choose **New event**, select a date number, or select a time slot in Week or Day view. Enter a title, start and end, and optionally a location and description. Save the event to add it to your local calendar.

Timed events use your browser's local time. For an all-day event, choose the first and last dates you want it to appear. Use May 4 for both dates for a one-day event, or May 4 through May 6 for a three-day event.

## Edit a connected event

Open an event in a writable CalDAV calendar or your primary Google Calendar, change its fields, and choose **Save**. Office writes the changes to the provider. If someone changes the event while you're editing, keep a copy of your changes and sync before reopening it. To upgrade an existing Google connection, choose **Authorize** under **Settings → Accounts**, then sync. If you originally connected Gmail only, choose **Enable Calendar**.

For a repeating event, the editor initially applies changes to the selected occurrence. Choose **Edit entire series** to change the parent event or its recurrence. Under **Repeat and exceptions**, set a simple repeat pattern or edit the recurrence properties directly. Use `RDATE` to add dates and `EXDATE` to skip dates. Saving an event with guests may send updates through the provider.

CalDAV's **CalDAV properties** section edits iCalendar fields such as availability (`TRANSP`), privacy (`CLASS`), status, categories, URLs, attendees, attachments, and reminders (`VALARM`). Each property occupies a separate line. Office shows provider-managed values separately and preserves additional properties and time-zone definitions when you edit the main fields.

## Import, export, and sync

Use **Import** for an `.ics` file and **Export** to share events as ICS. When the original source was retained, **Download original ICS** in the event details preserves it, including recurrence information.

Google and CalDAV sync cover the previous week through the next 90 days, up to 100 events per calendar. Office uses the provider's expanded instances for recurring events. If a CalDAV server cannot expand a series, Office displays its original event and saved exceptions. Imported ICS series retain their recurrence information.

Calendars discovered from non-Google IMAP accounts appear as individual sources. To retry discovery or approve a separate calendar hostname, open **Settings → Accounts** and edit the mail account.

Discovered CalDAV calendars use the mail account’s name by default. When an account has multiple calendars, Office adds the provider’s calendar name after the account name. Choose the pencil button beside any calendar in the sidebar to set an Office-only alias. Clear the alias to restore the default name.

See [Accounts and sync](accounts-and-sync.md) to connect a calendar.
