# Mail database indexing

## Storage and migration

`records.meta` remains the canonical metadata document. `mail_index` is a derived table with one row per mail record, linked by a cascading foreign key. It stores account, remote status, Office folder, provider folder, normalized message time, a compact label list and suspected-junk status. Bodies, originals, MIME details and other provider metadata stay in the existing storage.

Normal columns let account and folder queries avoid decoding large JSON documents. Message timestamps are milliseconds since the epoch, parsed from `date`, then `sentAt`; absent or invalid dates sort last. RFC mail dates and ISO timestamps are supported. Undated messages do not fall back to the cache modification time. Timestamp ties use record ID for stable ordering.

Four indexes support global date order, Office folder/date order, account/remote/folder queries, and provider-folder queries. Gmail label membership is evaluated against the small projected label array after account filtering. IMAP Inbox retains its case-insensitive matching; other provider folders retain exact matching.

The first connection checks for the table, takes a write lock, checks again, and creates/backfills the table in a single transaction. Backfill streams rows without loading MIME manifests or attachments. Concurrent requests cannot observe a partially built table. Save, restore and local deletion undo call `mail_index_record` inside their record transaction. Future code that writes mail directly must do the same. Deletions use the foreign-key cascade. A future change to these derived fields needs a versioned migration, not just a changed table definition.

The table is excluded from exported backups: restoring JSON or SQLite backups recreates the projection after provider records have been converted to local records. The public record shape is unchanged.

## List queries

`records&kind=mail&view=1&folder=Inbox&page=1&limit=100` returns a scoped list and `mailPage` containing `total`, `offset` and `more`. `account` changes `folder` into a provider folder or Gmail label. Queries support Office's all-mail, local-junk, suspected-junk and recovery-copy views. Count, ID selection and hydration share a read transaction. Attachment metadata and connection counts are fetched only for the selected IDs, in bounded batches.

The normal UI expands the requested prefix by 100, refreshing that window in one consistent snapshot. This avoids offset drift when newly synchronized messages arrive or earlier rows are removed. It does retransmit already displayed rows when expanding the window; subsequent cursor-based paging could reduce that cost. A requested page is capped at 10,000 rows; the UI requests the complete scoped view for larger windows.

Newest-first date/ungrouped views use paging. Searching, sender grouping, other sorts and collapsed groups request all rows in the selected view before applying the existing browser matching/grouping. This preserves substring search, Unicode casing, natural sorting and complete group membership. These modes still have a full-folder loading cost. Direct opening of a specific item and full exports retain the complete-mail compatibility endpoint. No FTS index is introduced: token search would change current substring behavior, and a future trigram index needs separate Unicode/short-query compatibility work.

The browser rejects stale responses after a query, app, read state or deletion changes. Query refreshes preserve the current editor. The retained Mail cache includes paging metadata so a 100-message snapshot is not mistaken for a complete mailbox.

## Validation and measurements

`tests/mail-index.php` covers migration from an old schema, page boundaries, RFC/ISO dates, folder/account membership, covering-index use, transactional updates/rollback, deletion and backup restore. `tests/mail-undo.php` checks that undo restores the indexed listing. `tests/mail-pagination.browser.mjs` covers expanding pages, keyboard navigation, searching beyond the first page, alternate sorting, cached paging state, folder changes, retry and stale responses.

A local benchmark on November 7, 2026 used a consistent SQLite copy with 3,553 messages (912 in Inbox). Median of three runs, including summary serialization:

| Request | Records | Response bytes | Backend time |
| --- | ---: | ---: | ---: |
| Previous full-mailbox list | 3,553 | 18,629,074 | 2,826.6 ms |
| Indexed complete Inbox | 912 | 4,345,777 | 928.4 ms |
| Indexed first Inbox page | 100 | 668,706 | 143.4 ms |

The one-time backfill took about 3.15 seconds. Account-ID lookup averaged 592.15 ms using the prior JSON predicate versus 0.40 ms using the metadata index over 20 runs. These are local backend measurements, not network/browser timings or live-provider performance guarantees. The projection and indexes add storage and write work; they do not accelerate provider network requests.
