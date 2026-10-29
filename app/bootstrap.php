<?php
declare(strict_types=1);

const KINDS = ['tasks', 'contacts', 'calendar', 'documents', 'wiki', 'sheets', 'mail'];

function data_dir(): string {
    $dir = getenv('OFFICE_DATA_DIR') ?: dirname(__DIR__) . '/data';
    if (!is_dir($dir) && !mkdir($dir, 0700, true)) throw new RuntimeException('Cannot create private data directory.');
    return $dir;
}
function db(): PDO {
    static $db;
    if ($db) return $db;
    $db = new PDO('sqlite:' . data_dir() . '/office.sqlite', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $db->exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    $db->exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, meta TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, updated TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS records_kind ON records(kind,updated);
        CREATE UNIQUE INDEX IF NOT EXISTS wiki_page_names ON records(title) WHERE kind=\'wiki\';
        CREATE TABLE IF NOT EXISTS revisions (record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE, revision INTEGER NOT NULL, snapshot TEXT NOT NULL, PRIMARY KEY(record_id,revision));
        CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, label TEXT NOT NULL, type TEXT NOT NULL, config TEXT NOT NULL, secret TEXT NOT NULL, last_sync TEXT, error TEXT);
        CREATE TABLE IF NOT EXISTS attempts (bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, started INTEGER NOT NULL);');
    @chmod(data_dir() . '/office.sqlite', 0600);
    return $db;
}
function setting(string $key, mixed $fallback = null): mixed {
    $q = db()->prepare('SELECT value FROM settings WHERE key=?'); $q->execute([$key]);
    $value = $q->fetchColumn(); return $value === false ? $fallback : json_decode($value, true, 512, JSON_THROW_ON_ERROR);
}
function set_setting(string $key, mixed $value): void {
    db()->prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')->execute([$key,json_encode($value, JSON_THROW_ON_ERROR)]);
}
function fail(string $message, int $code = 400): never { throw new HttpError($message, $code); }
class HttpError extends RuntimeException {}
function json_response(mixed $value, int $code = 200): never {
    http_response_code($code); header('Content-Type: application/json; charset=utf-8');
    echo json_encode($value, JSON_THROW_ON_ERROR | JSON_INVALID_UTF8_SUBSTITUTE); exit;
}
function request_json(): array {
    if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 12 * 1024 * 1024) fail('Request too large.', 413);
    $raw = file_get_contents('php://input', false, null, 0, 12 * 1024 * 1024 + 1);
    if (strlen($raw) > 12 * 1024 * 1024) fail('Request too large.', 413);
    try { $value = json_decode($raw ?: '{}', true, 64, JSON_THROW_ON_ERROR); } catch (JsonException) { fail('Invalid JSON.'); }
    if (!is_array($value)) fail('Expected a JSON object.'); return $value;
}
function start_session(): void {
    ini_set('session.use_strict_mode','1');
    session_name('portable_office');
    session_save_path(data_dir());
    session_set_cookie_params(['httponly'=>true,'secure'=>!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off','samesite'=>'Lax','path'=> '/']);
    session_start();
    $_SESSION['csrf'] ??= bin2hex(random_bytes(32));
    if (isset($_SESSION['seen']) && time() - $_SESSION['seen'] > 3600) unset($_SESSION['owner']);
    $_SESSION['seen'] = time();
}
function csrf(): void {
    if (!hash_equals($_SESSION['csrf'], $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '')) fail('Session expired. Refresh and try again.',403);
}
function owner(): void { if (empty($_SESSION['owner'])) fail('Sign in required.',401); }
function throttle(): void {
    $bucket = hash('sha256', $_SERVER['REMOTE_ADDR'] ?? 'local');
    $q = db()->prepare('SELECT * FROM attempts WHERE bucket=?'); $q->execute([$bucket]); $row=$q->fetch();
    if ($row && time() - (int)$row['started'] < 900 && (int)$row['count'] >= 10) fail('Too many attempts. Try again in 15 minutes.',429);
    db()->prepare('INSERT INTO attempts VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=CASE WHEN started < ? THEN 1 ELSE count+1 END, started=CASE WHEN started < ? THEN excluded.started ELSE started END')->execute([$bucket,time(),time()-900,time()-900]);
}
function setup_token(): string {
    $path = data_dir() . '/setup-token.txt';
    // Exclusive creation prevents concurrent visitors from choosing different tokens.
    if ($file = @fopen($path, 'x')) { chmod($path,0600); fwrite($file, bin2hex(random_bytes(24))); fclose($file); }
    $token=trim((string)file_get_contents($path));
    if (!preg_match('/^[a-f0-9]{48}$/D',$token)) fail('Setup is initializing. Refresh and try again.',503);
    return $token;
}
function encrypt_secret(array $secret): string {
    $path = data_dir() . '/secret.key';
    if ($file = @fopen($path,'x')) { chmod($path,0600); fwrite($file,random_bytes(32)); fclose($file); }
    $key=file_get_contents($path); if (strlen($key)!==32) fail('Credential storage is initializing. Try again.',503);
    $iv=random_bytes(12); $tag='';
    $cipher=openssl_encrypt(json_encode($secret,JSON_THROW_ON_ERROR),'aes-256-gcm',$key,OPENSSL_RAW_DATA,$iv,$tag);
    if ($cipher === false) throw new RuntimeException('Credential encryption failed.');
    return base64_encode($iv . $tag . $cipher);
}
function decrypt_secret(string $value): array {
    $bytes=base64_decode($value,true); $key=@file_get_contents(data_dir().'/secret.key');
    if (!$key || !$bytes) fail('Account key unavailable. Reconnect this account.');
    $plain=openssl_decrypt(substr($bytes,28),'aes-256-gcm',$key,OPENSSL_RAW_DATA,substr($bytes,0,12),substr($bytes,12,16));
    if ($plain===false) fail('Cannot unlock account. Reconnect it.'); return json_decode($plain,true,512,JSON_THROW_ON_ERROR);
}
function record_row(array $row): array {
    $row['meta']=json_decode($row['meta'],true,64,JSON_THROW_ON_ERROR);
    // Empty PHP maps otherwise serialize as [], which loses named cell edits in JavaScript.
    if ($row['kind']==='sheets') foreach ($row['meta']['workbook']['sheets'] as &$sheet) $sheet['cells']=(object)$sheet['cells'];
    $row['revision']=(int)$row['revision']; return $row;
}
function get_record(string $id): array {
    $q=db()->prepare('SELECT * FROM records WHERE id=?'); $q->execute([$id]); $r=$q->fetch();
    if (!$r) fail('Item not found.',404); return record_row($r);
}
function validate_record(array $input): array {
    $kind=$input['kind']??''; if (!in_array($kind,KINDS,true)) fail('Unknown application.');
    $title=trim((string)($input['title']??'')); if (!$title || strlen($title)>500) fail('A title of up to 500 bytes is required.');
    $body=(string)($input['body']??''); if (strlen($body)>2*1024*1024) fail('Item exceeds 2 MB.');
    $meta=$input['meta']??[]; if (!is_array($meta) || strlen(json_encode($meta))>2*1024*1024) fail('Invalid item metadata.');
    if ($kind==='sheets') {
        $sheets=$meta['workbook']['sheets']??null;
        if (!is_array($sheets) || !array_is_list($sheets) || count($sheets)<1 || count($sheets)>10) fail('A workbook needs 1–10 sheets.');
        foreach ($sheets as $sheet) {
            if (!is_array($sheet) || !is_string($sheet['name']??null) || strlen($sheet['name'])>100 || !is_array($sheet['cells']??null) || count($sheet['cells'])>2600) fail('Invalid worksheet.');
            foreach ($sheet['cells'] as $ref=>$value) if (!preg_match('/^[A-Z](?:[1-9][0-9]?|100)$/D',(string)$ref) || !is_string($value) || strlen($value)>10000) fail('Cells must be text, within A1:Z100.');
        }
    }
    foreach (['start','end','due','email','phone','company','group','location','to','sendAccount','folder','from','raw','recurrence','date'] as $key) if (isset($meta[$key]) && !is_string($meta[$key])) fail('Invalid '.$key.' metadata.');
    return ['kind'=>$kind,'title'=>$title,'body'=>$body,'meta'=>$meta];
}
function save_record(array $input, bool $internal = false): array {
    $r=validate_record($input); $id=(string)($input['id']??bin2hex(random_bytes(16)));
    if (!preg_match('/^[a-zA-Z0-9_-]{1,100}$/D',$id)) fail('Invalid item ID.');
    $db=db(); $outer=$db->inTransaction(); if (!$outer) $db->beginTransaction();
    try {
        $q=$db->prepare('SELECT * FROM records WHERE id=?'); $q->execute([$id]); $old=$q->fetch();
        if ($internal && !empty($r['meta']['remote'])) { $q=$db->prepare('SELECT id FROM accounts WHERE id=?'); $q->execute([$r['meta']['account']??'']); if (!$q->fetch()) fail('Account was removed during synchronization.',409); }
        if ($r['kind']==='wiki') { $duplicate=$db->prepare("SELECT id FROM records WHERE kind='wiki' AND title=? AND id<>?"); $duplicate->execute([$r['title'],$id]); if ($duplicate->fetch()) fail('A wiki page with that name already exists.',409); }
        if ($old && !$internal && (int)($input['revision']??0)!==(int)$old['revision']) fail('This item changed elsewhere. Reopen it before saving.',409);
        if ($old && $old['kind']!==$r['kind']) fail('Cannot change application.');
        if ($old && !$internal && !empty(json_decode($old['meta'],true)['remote'])) fail('Synced items are read-only in this version.');
        $revision=$old?(int)$old['revision']+1:1;
        $db->prepare('INSERT INTO records VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,body=excluded.body,meta=excluded.meta,revision=excluded.revision,updated=excluded.updated')->execute([$id,$r['kind'],$r['title'],$r['body'],json_encode($r['meta'],JSON_THROW_ON_ERROR),$revision,gmdate('c')]);
        if (in_array($r['kind'],['wiki','documents'],true)) $db->prepare('INSERT INTO revisions VALUES(?,?,?)')->execute([$id,$revision,json_encode($r,JSON_THROW_ON_ERROR)]);
        if (!$outer) $db->commit();
    } catch (Throwable $e) { if (!$outer && $db->inTransaction()) $db->rollBack(); throw $e; }
    return get_record($id);
}
