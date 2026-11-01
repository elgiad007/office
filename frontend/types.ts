/** Browser-facing contracts. PHP remains the authority for validation and storage. */
export type ItemKind = 'mail' | 'calendar' | 'tasks' | 'contacts' | 'documents' | 'wiki' | 'sheets';
export type AppName = ItemKind | 'settings';
export type Cells = Record<string, string>;
export interface Workbook { sheets: {name: string; cells: Cells}[] }
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
}
export interface ItemInput { kind: ItemKind; title: string; body: string; meta: ItemMeta }
export interface OfficeRecord extends ItemInput {
  id: string;
  revision: number;
  created: string;
  updated: string;
  summary?: boolean;
  hasOriginal?: boolean;
  contentHash?: string;
}
export interface MailFolder {
  id: string; name: string; delimiter?: string | null; protected?: boolean; role?: string;
}
export interface Account {
  id: string; type: 'imap' | 'google' | 'caldav'; label: string;
  folders?: MailFolder[]; last_sync?: string | null; error?: string | null;
}
export interface Preferences {
  theme?: string; density?: string; accent?: string;
  keys?: Record<string, string>;
  mailDisplay?: string; defaultMailAccount?: string;
  keepRecoveryCopies?: boolean; confirmBeforeSend?: boolean;
}
export interface MailScope { account: string; folder: string; limit: number }
export interface AppState {
  app: AppName; rows: OfficeRecord[]; current: OfficeRecord | null;
  csrf: string; accounts: Account[]; prefs: Preferences; search: string;
  mode: string; dirty: boolean; selected: Set<string>; sheet: number; cell: string;
  wikiPreview: boolean; lastActivity: number; syncing: boolean;
  savePromise: Promise<void> | null; mailFolder: string; mailScope: MailScope | null;
  folderOpen: Set<string>;
}
export interface ActivityEntry {
  id: number; time: string; level: string; account: string;
  operation: string; message: string; duration_ms: number | null; phase: string;
}
export interface ConnectionCheck { label: string; status: string; message: string }
export interface CheckResult { status: string; checks: ConnectionCheck[] }
export interface GoogleSettings {
  configured: boolean; client_id: string; redirect: string;
  notice?: { error: boolean; message: string } | null;
}
export interface Status {
  setup: boolean; authenticated: boolean; activity: boolean;
  csrf: string; preferences: Preferences;
}
export interface MutationResult { record: OfficeRecord; removedIds?: string[] }
export interface MailActionResult { record: OfficeRecord | null; removedIds?: string[] }
export interface ApiError extends Error { status?: number; code?: string; record?: OfficeRecord }
export interface ApiResponses {
  status: Status;
  accounts: { accounts: Account[] };
  setup: { csrf: string }; login: { csrf: string }; logout: { ok: boolean };
  save: MutationResult; delete: { ok: boolean }; 'mail-action': MailActionResult;
  send: { ok: boolean };
  'mail-folders': { folders: MailFolder[] };
  'mail-folder-manage': { folders: MailFolder[] };
  'mail-folder-sync': { count: number };
  sync: { count: number };
  'account-test': CheckResult; 'account-save': { id: string };
  'account-delete': { ok: boolean };
  'google-connect': { url: string }; 'google-settings': GoogleSettings;
  preferences: { ok: boolean };
  import: { count: number }; 'import-items': { count: number }; restore: { count: number };
  backup: unknown;
}
export type ApiRoute = keyof ApiResponses | `records&${string}` | `record&${string}` | `history&${string}`;
export type ApiResponse<R extends ApiRoute> = R extends keyof ApiResponses ? ApiResponses[R]
  : R extends `records&${string}` ? {records: OfficeRecord[]}
  : R extends `record&${string}` ? {record: OfficeRecord}
  : {revisions: {revision: number; snapshot: OfficeRecord}[]};
/** Requests are serialized as JSON; individual endpoints validate their payloads in PHP. */
export type ApiData = object;
export interface RequestApi {
  (route: 'google-settings', data: ApiData): Promise<{ok: boolean}>;
  <R extends ApiRoute>(route: R, data?: ApiData): Promise<ApiResponse<R>>;
}
export type Attempt = <T>(fn: () => T | Promise<T>) => Promise<T | undefined>;
export type Confirmation = (title: string, message: string, action: () => unknown) => void;
export type DeleteResult = {ok?: boolean; record?: OfficeRecord | null; removedIds?: string[]};
export type DeleteMail = (rows: OfficeRecord[], operation: (row: OfficeRecord) => Promise<DeleteResult>) => Promise<void>;
export interface FolderEnvironment {
  state: AppState; api: RequestApi; commit: () => Promise<void>; load: () => Promise<void>;
  notice: (text: string, error?: boolean) => void; modal: (title: string, body: string) => void;
  dialog: HTMLDialogElement; e: (value: unknown) => string;
  field: (label: string, name: string, value?: string, type?: string, extra?: string) => string;
  confirmation: Confirmation; attempt: Attempt; closeFolderPanel?: () => void;
}
export interface MenuEnvironment {
  state: AppState; e: (value: unknown) => string; commit: () => Promise<void>;
  selectRecord: (id: string, focus?: boolean) => Promise<void>; enterEdit: (preferTitle?: boolean) => void;
  api: RequestApi; load: () => Promise<void>;
  mailDeletionReload: () => (removedIds: string[]) => Promise<void>;
  deleteMailImmediately: DeleteMail; notice: (text: string, error?: boolean) => void;
  confirmation: Confirmation; attempt: Attempt;
  exportRecords: (all?: boolean, selectedRecords?: OfficeRecord[]) => Promise<void>;
  waitForMailRead: (id: string) => Promise<unknown> | undefined;
  mouseSelection: () => void; fileMail: () => Promise<void>;
}
