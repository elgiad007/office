/** Browser-facing contracts. PHP remains the authority for validation and storage. */
export type {ItemKind} from './item-types.js';
import type {ItemKind} from './item-types.js';
import type {MailRule, MailRulePreview} from './mail-rules.js';
export type AppName = ItemKind | 'settings';
export type Cells = Record<string, string>;
export interface Workbook { sheets: {name: string; cells: Cells}[] }
export interface ChecklistItem {id: string; text: string; done: boolean}
export interface Attachment {part: string; name: string; type: string; size: number; available: boolean; encodedSize?: boolean}
export interface ItemMeta {
  remote?: boolean;
  account?: string;
  folder?: string;
  serverFolder?: string;
  labelIds?: string[];
  uid?: string;
  uidValidity?: string;
  source?: string;
  providerId?: string;
  gmailMessageId?: string;
  from?: string;
  junkReason?: string;
  junkReviewed?: boolean;
  to?: string;
  date?: string;
  sentAt?: string;
  read?: boolean;
  sendAccount?: string;
  raw?: string;
  rawBase64?: string;
  headersBase64?: string;
  hasHtml?: boolean;
  headerOnly?: boolean;
  hasAttachments?: boolean;
  attachments?: Attachment[];
  messageSize?: number;
  due?: string;
  priority?: string;
  done?: boolean;
  email?: string;
  phone?: string;
  company?: string;
  group?: string;
  start?: string;
  end?: string;
  location?: string;
  recurrence?: string;
  rawIcs?: string;
  workbook?: Workbook;
  checklist?: ChecklistItem[];
}
export interface ItemInput { kind: ItemKind; title: string; body: string; meta: ItemMeta }
export interface OfficeRecord extends ItemInput {
  connectionCount?: number;
  id: string;
  revision: number;
  created: string;
  updated: string;
  summary?: boolean;
  hasOriginal?: boolean;
  contentHash?: string;
  bodyHash?: string;
}
export interface MailFolder {
  id: string; name: string; delimiter?: string | null; protected?: boolean; role?: string;
}
export interface Account {
  id: string; type: 'imap' | 'google' | 'caldav'; label: string;
  gmailImap?: boolean;
  folders?: MailFolder[]; last_sync?: string | null; error?: string | null;
}
export interface Preferences {
  swipe?: import('./swipe.js').SwipePreferences;
  showElapsedTime?: boolean;
  activityLogLevel?: 'summary' | 'warnings' | 'detailed';
  mailList?: MailListLayout;
  mailView?: MailViewPreferences;
  taskView?: TaskViewPreferences;
  linkAutocomplete?: {limit:number; sort:string};
  theme?: string; density?: string; accent?: string;
  keys?: Record<string, string>;
  mailDisplay?: string; defaultMailAccount?: string;
  keepRecoveryCopies?: boolean; confirmBeforeSend?: boolean;
  mailOffline?: boolean;
}
export interface MailViewPreferences {group: 'date' | 'sender' | 'none'; sort: 'date-desc' | 'date-asc' | 'sender-asc' | 'sender-desc' | 'subject-asc' | 'subject-desc'; collapsed: string[]}
export interface TaskViewPreferences {
  group: 'none' | 'due' | 'status' | 'priority';
  sort: 'due-asc' | 'due-desc' | 'priority-desc' | 'priority-asc' | 'title-asc' | 'title-desc' | 'updated-desc' | 'updated-asc';
  status: 'unfinished' | 'completed' | 'all'; priority: string;
  due: 'all' | 'overdue' | 'today' | 'upcoming' | 'undated'; collapsed: string[];
}
export type MailListField = 'none' | 'sender' | 'date' | 'subject' | 'attachment' | 'preview';
export interface MailListSlot {field: MailListField; size: 'small' | 'normal' | 'large'}
export interface MailListLayout {sender: 'both' | 'name' | 'email'; rows: {left: MailListSlot; right: MailListSlot}[]}
export interface MailScope { account: string; folder: string; limit: number }
export interface AppState {
  app: AppName; rows: OfficeRecord[]; current: OfficeRecord | null;
  csrf: string; accounts: Account[]; prefs: Preferences; search: string;
  mode: string; dirty: boolean; selected: Set<string>; sheet: number; cell: string;
  wikiEditing: boolean; lastActivity: number; syncing: boolean;
  savePromise: Promise<void> | null; mailFolder: string; mailScope: MailScope | null;
  folderOpen: Set<string>;
}
export interface ActivityProgress {
  time: string; level: string; account: string;
  operation: string; message: string; duration_ms: number | null; phase: string;
  run?: string; record_id?: string | null;
}
export interface ActivityEntry extends ActivityProgress {id: number}
export interface ConnectionCheck { label: string; status: string; message: string }
export interface CheckResult { status: string; checks: ConnectionCheck[] }
export interface GoogleSettings {
  configured: boolean; client_id: string; redirect: string;
  notice?: { error: boolean; message: string } | null;
}
export interface Status {
  setup: boolean; authenticated: boolean; activity: boolean;
  csrf: string; preferences: Preferences;
  lastInteraction?: number | null;
  remoteSenderIcons?: boolean;
}
export interface MutationResult { record: OfficeRecord; removedIds?: string[] }
export interface MailActionResult { record: OfficeRecord | null; removedIds?: string[]; undoToken?: string }
export interface ApiError extends Error { status?: number; code?: string; record?: OfficeRecord }
export interface ApiResponses {
  'update-check': {installed: string;latest: string | null;available: boolean;canInstall: boolean;download: string | null;notes: string | null};
  'update-install': {job: string};
  'connection': {ok: boolean;changed?:number};
  status: Status;
  accounts: { accounts: Account[] };
  setup: { csrf: string }; login: { csrf: string }; logout: { ok: boolean };
  'session-activity': { ok: boolean }; reauthenticate: { ok: boolean };
  save: MutationResult; delete: { ok: boolean; undoToken?: string }; 'mail-action': MailActionResult;
  'mail-undo': MutationResult;
  'mail-junk-settings': {rules: {type: 'sender' | 'domain'; target: string}[]; folder: string};
  'mail-rules': {version:string;rules:MailRule[]};
  'mail-rule-review': MailRulePreview;
  'mail-empty-junk': {authorize: true} | {count: number; name: string; token: string} | {deleted: number; skipped: number; unconfirmed: number; warning?: string};
  send: { ok: boolean; record: OfficeRecord };
  'mail-folders': { folders: MailFolder[] };
  'mail-folder-manage': { folders: MailFolder[] };
  'mail-folder-sync': { count: number; more?: boolean };
  'mail-content': { record: OfficeRecord };
  'mail-export-plan': { batches: {account: string; ids: string[]}[] };
  'mail-export-batch': { warning: string | null };
  'mail-files': {record: OfficeRecord; attachments: Attachment[]};
  sync: { count: number; more?: boolean };
  'account-test': CheckResult; 'account-save': { id: string };
  'account-delete': { ok: boolean };
  'google-connect': { url: string }; 'google-settings': GoogleSettings;
  preferences: { ok: boolean };
  import: { count: number }; 'import-items': { count: number }; restore: { count: number; preferences?: Preferences };
}
export interface RecordList {records: OfficeRecord[];mailPage?: {total: number;offset: number;more: boolean}}
export type ConnectionVisibility='active'|'archived'|'all';
export interface ConnectionItem {id:string;kind:string;title:string;excerpt:string;meta:Record<string,string>;degree?:number;activeDegree?:number;archivedDegree?:number}
export interface ConnectionEdge {a:string;b:string;created:string;archived?:boolean}
export interface ConnectionGroup {id:string;title:string;kind:string;items:number;links:number;archivedLinks?:number}
export interface ConnectionList {links:ConnectionEdge[];items:ConnectionItem[];more:boolean;total?:number;activeTotal?:number;archivedTotal?:number;groups?:ConnectionGroup[];itemTotal?:number;groupTotal?:number}
export type ApiRoute = keyof ApiResponses | `records&${string}` | `record&${string}` | `history&${string}` | `connection-search&${string}` | `connections&${string}`;
export type ApiResponse<R extends ApiRoute> = R extends keyof ApiResponses ? ApiResponses[R]
  : R extends `connection-search&${string}` ? {items:ConnectionItem[]}
  : R extends `connections&${string}` ? ConnectionList
  : R extends `records&${string}` ? RecordList
  : R extends `record&${string}` ? {record: OfficeRecord}
  : {revisions: {revision: number; snapshot: OfficeRecord}[]};
/** Requests are serialized as JSON; individual endpoints validate their payloads in PHP. */
export type ApiData = object;
export interface RequestApi {
  (route: 'google-settings', data: ApiData): Promise<{ok: boolean}>;
  <R extends ApiRoute>(route: R, data?: ApiData): Promise<ApiResponse<R>>;
}
export type Attempt = <T>(fn: () => T | Promise<T>) => Promise<T | undefined>;
export type DeferItemAction = (row: OfficeRecord, apply: () => Promise<void>) => void;
export type Confirmation = (title: string, message: string, action: () => unknown, confirmLabel?: string) => void;
export type ConnectionDeletionChoices = Record<string,{connectionHubTitle?: string}>;
export type ConfirmDeletion = (rows: OfficeRecord[],title: string,message: string,action: (choices: ConnectionDeletionChoices) => unknown,skipUnconnected?: boolean) => Promise<void>;
export type DeleteResult = {ok?: boolean; record?: OfficeRecord | null; removedIds?: string[]; undoToken?: string};
export type DeleteMail = (rows: OfficeRecord[], operation: (row: OfficeRecord) => Promise<DeleteResult>, undoable?: boolean) => Promise<void>;
export interface FolderEnvironment {
  captureSidebarFocus?: () => () => void;
  state: AppState; api: RequestApi; commit: () => Promise<void>; load: (preferId?: string, options?: {preserveSelection?: boolean}) => Promise<void>;
  notice: (text: string, error?: boolean) => void; modal: (title: string, body: string) => void;
  dialog: HTMLDialogElement; e: (value: unknown) => string;
  field: (label: string, name: string, value?: string, type?: string, extra?: string) => string;
  confirmation: Confirmation; attempt: Attempt; closeFolderPanel?: () => void;
  withRecentSignIn: <T>(operation: () => Promise<T>) => Promise<T>;
  mailDeletionReload?: () => (removedIds: string[]) => Promise<void>;
}
export interface MenuEnvironment {
  confirmDeletion: ConfirmDeletion;
  renderList: () => void;
  state: AppState; e: (value: unknown) => string; commit: () => Promise<void>;
  selectRecord: (id: string, focus?: boolean) => Promise<void>; enterEdit: (preferTitle?: boolean) => void;
  api: RequestApi; load: () => Promise<void>;
  mailDeletionReload: () => (removedIds: string[]) => Promise<void>;
  deleteMailImmediately: DeleteMail; notice: (text: string, error?: boolean) => void;
  confirmation: Confirmation; attempt: Attempt;
  exportRecords: (all?: boolean, selectedRecords?: OfficeRecord[]) => Promise<void>;
  setMailRead: (record: OfficeRecord,read: boolean) => Promise<void>;
  waitForMailRead: (id: string) => Promise<unknown> | undefined;
  capturePane: () => () => void; mouseSelection: () => void; fileMail: () => Promise<void>;
}
