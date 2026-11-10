# Accounts and sync

[Office user guides](README.md)

Open **Settings → Accounts → Add account**. Choose guided setup for step-by-step entry or manual setup to see the fields together. Select **Edit** beside a connected account to update its settings. Leave the password blank to keep the saved password. Switching to a different mailbox or calendar connection asks for confirmation before replacing the affected downloaded data. Google accounts use **Authorize** to update provider access.

You can check a connection before saving where offered. Checks verify access without sending mail or moving items. Closing the setup dialog clears unsaved entries. Saved provider credentials are encrypted in the installation.

## Choose a connection type

| Type | What to enter |
| --- | --- |
| **Gmail — app password** | Enter your full Gmail address and a Google-generated app password. Office fills the mail server settings. This connects email. |
| **Gmail with Google sign-in** | Configure Google integration first, then connect your Google account. Select Calendar access if you want a read-only copy of the primary calendar. |
| **IMAP/SMTP** | Enter the provider's public hostnames and credentials. Office uses TLS IMAP on port 993 and TLS SMTP on port 465 with the same login. |
| **CalDAV** | Enter the final HTTPS URL of the calendar collection and its credentials. Use port 443, 8443, or 2080. Events sync as read-only copies. |

Connections require public hostnames and valid TLS certificates. For Gmail app-password availability and help creating one, see [Google Account Help](https://support.google.com/accounts/answer/185833).

For Gmail app-password setup, paste the app password into Office. Spaces between its groups are removed automatically. Office supplies `imap.gmail.com` and `smtp.gmail.com` and discovers the account's system folders.

With IMAP, **Test connection** checks read-only Inbox access, archive and MOVE support, and SMTP login. With CalDAV, it checks the collection properties. Changing the settings clears the previous result.

## Find calendars for an IMAP account

During sync, Office looks for calendars for non-Google IMAP accounts. Each calendar appears by name in Calendar, where you can show or hide it. If the calendar service is on a different hostname from the IMAP server, open the account’s **Edit** screen, choose **Use discovered URL**, and save to authorize use of the mailbox login there. You can also enter your provider’s CalDAV server or collection URL directly. **Find calendars** retries using saved settings. If your provider requires a separate calendar login, use **Add account → CalDAV calendar**.

## Set up Google sign-in

1. Open **Settings → Accounts → Google integration** and copy the callback URL displayed there.
2. In your Google Cloud project, enable the Gmail API and, if needed, the Calendar API. Configure the consent screen and create a web OAuth client. Register the exact callback URL shown in Office, including the hostname, port, and query string.
3. Save the client ID, secret, and callback in Office. Add a Gmail account, select optional Calendar access, and choose **Connect with Google**.
4. Sign in as the account you intend to connect. If access expires, choose **Authorize** for that account and sign in with the original address.

Each installation needs its own setup and account authorization. A new hostname or port can require an updated callback registration.

A blank client secret keeps the saved secret when the client ID stays the same. Changing the integration credentials applies to future connections. Existing Google accounts keep the client settings and callback used for their authorization.

## Sync and check progress

Office checks accounts when opened and about every two minutes while the tab is visible and you've interacted recently. Choose **Sync now**, or enter `:sync Account name` to check one account. Keep Office open for sync and sending. Hidden and idle tabs stop starting automatic checks.

Mail sync works through Inbox, Archive, Trash, and Junk in batches, with newer mail first. **Older mail remains** means another check will continue the backlog. Custom folders refresh when opened or when you use **Refresh mail**. Office also refreshes the open account folder during its regular sync. Bodies download when opened, or during sync if you enable **Download message contents during sync for offline use** in Mail settings. Previously downloaded items remain available when the provider is offline.

For mail, **Repair / resync** in Accounts refreshes cached locations and content while keeping credentials and local mail. Use **Authorize** for a Google account that needs fresh authorization. **Remove** deletes the saved credentials and downloaded cache for that account from the workspace. If a move or send reports an uncertain outcome, check the provider and the activity log before repeating it. See [Activity and troubleshooting](activity.md).
