<?php
declare(strict_types=1);

const OFFICE_DEFAULT_PROFILE = 'default';
const OFFICE_PROFILE_INVITE_LIFETIME = 86400;

function office_profile_registry(): PDO {
    static $db;
    if ($db) return $db;
    $path=installation_data_dir().'/profiles.sqlite';
    $db=new PDO('sqlite:'.$path,null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
    @chmod($path,0600);
    $db->exec('PRAGMA busy_timeout=5000;
        CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE);
        CREATE TABLE IF NOT EXISTS profile_invites (digest TEXT PRIMARY KEY, expires INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS attempts (bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, started INTEGER NOT NULL);');
    return $db;
}

function office_profiles(): array {
    $registry=office_profile_registry();
    $list=static fn()=> $registry->query("SELECT id,name FROM profiles ORDER BY id<>'default',name,id")->fetchAll();
    $profiles=$list();
    if ($profiles || !is_file(installation_data_dir().'/office.sqlite')) return $profiles;

    // Legacy installations already have the first profile's database and key.
    // Leave both in place and publish the registry entry only once.
    $registry->exec('BEGIN IMMEDIATE');
    try {
        $profiles=$list();
        if (!$profiles && workspace_db(installation_data_dir())->query("SELECT 1 FROM settings WHERE key='owner'")->fetchColumn()) {
            $registry->prepare('INSERT INTO profiles VALUES(?,?)')->execute([OFFICE_DEFAULT_PROFILE,'Default']);
            $profiles=$list();
        }
        $registry->exec('COMMIT');
    } catch (Throwable $error) { $registry->exec('ROLLBACK'); throw $error; }
    return $profiles;
}

function office_find_profile(mixed $id): ?array {
    if (!is_string($id) || ($id!==OFFICE_DEFAULT_PROFILE && !preg_match('/^[a-f0-9]{32}$/D',$id))) return null;
    $q=office_profile_registry()->prepare('SELECT id,name FROM profiles WHERE id=?');
    $q->execute([$id]);
    return $q->fetch() ?: null;
}

function office_profile_dir(string $id): string {
    if ($id===OFFICE_DEFAULT_PROFILE) return installation_data_dir();
    if (!preg_match('/^[a-f0-9]{32}$/D',$id)) throw new LogicException('Invalid profile ID.');
    return installation_data_dir().'/profiles/'.$id;
}

function office_profile_database(array $profile): PDO {
    $dir=office_profile_dir($profile['id']);
    if (!is_file($dir.'/office.sqlite')) fail('This profile’s workspace is unavailable.',503);
    return workspace_db($dir);
}

function office_session_profile(): ?array {
    return office_find_profile($_SESSION['profile']??null);
}

function office_request_profile(): ?array {
    return $GLOBALS['office_request_profile']??null;
}

function office_bind_profile(array $profile): void {
    // The request may continue after releasing the session lock (e.g. mail sync).
    // Its database and files must keep pointing to the original profile.
    $bound=office_request_profile();
    if ($bound && $bound['id']!==$profile['id']) fail('Sign in required.',401);
    $GLOBALS['office_request_profile']=$profile;
}

function office_require_profile_context(mixed $expected): void {
    $id=office_request_profile()['id'];
    // Preserve the legacy single-profile API and direct URLs for the Default
    // profile. A missing context must never select a newly created profile.
    if ($expected===null && $id===OFFICE_DEFAULT_PROFILE) return;
    if (!is_string($expected) || !hash_equals($id,$expected)) fail('This tab is signed out of its profile.',401);
}

function office_require_installation_owner(): void {
    if (office_request_profile()['id']!==OFFICE_DEFAULT_PROFILE) fail('Only the installation owner can do this.',403);
}

function office_start_profile_session(array $profile): void {
    if (!session_regenerate_id(true)) fail('Could not start a profile session. Try again.',503);
    $now=time();
    $_SESSION=['profile'=>$profile['id'],'csrf'=>bin2hex(random_bytes(32)),'seen'=>$now,'signed_in'=>$now,'verified_at'=>$now];
}

function office_profile_name(mixed $name): string {
    if (!is_string($name)) fail('Enter a profile name.');
    $name=trim($name);
    if ($name==='' || strlen($name)>120 || preg_match('/\p{C}/u',$name)!==0) fail('Enter a profile name of up to 120 bytes.');
    return $name;
}

function office_profile_password_hash(mixed $password): string {
    $algorithm=owner_password_algorithm();
    $maxBytes=$algorithm===PASSWORD_BCRYPT?72:1024;
    if (!is_string($password) || strlen($password)<12 || strlen($password)>$maxBytes || str_contains($password,"\0")) fail("Use a password between 12 and $maxBytes bytes, without null characters.");
    return password_hash($password,$algorithm);
}

function office_store_profile_password(PDO $db,string $hash): void {
    $db->prepare("INSERT INTO settings (key,value) VALUES ('owner',?)")->execute([json_encode(['password'=>$hash],JSON_THROW_ON_ERROR)]);
}

function office_create_first_profile(array $input): array {
    if (office_profiles()) fail('Already configured.',409);
    $token=$input['token']??null;
    if (!is_string($token) || !hash_equals(setup_token(),$token)) fail('Incorrect setup token.',403);
    $profile=['id'=>OFFICE_DEFAULT_PROFILE,'name'=>office_profile_name($input['name']??'Default')];
    $hash=office_profile_password_hash($input['password']??null);
    $registry=office_profile_registry();
    $registry->exec('BEGIN IMMEDIATE');
    try {
        if ($registry->query('SELECT 1 FROM profiles')->fetchColumn()) fail('Already configured.',409);
        office_store_profile_password(workspace_db(installation_data_dir()),$hash);
        $registry->prepare('INSERT INTO profiles VALUES(?,?)')->execute(array_values($profile));
        $registry->exec('COMMIT');
    } catch (Throwable $error) { $registry->exec('ROLLBACK'); throw $error; }
    @unlink(installation_data_dir().'/setup-token.txt');
    return $profile;
}

function office_issue_profile_invite(): array {
    $code=bin2hex(random_bytes(16));
    $expires=time()+OFFICE_PROFILE_INVITE_LIFETIME;
    $registry=office_profile_registry();
    $registry->prepare('DELETE FROM profile_invites WHERE expires<=?')->execute([time()]);
    $registry->prepare('INSERT INTO profile_invites VALUES(?,?)')->execute([hash('sha256',$code),$expires]);
    return ['code'=>$code,'expires'=>$expires];
}

function office_redeem_profile_invite(array $input): array {
    $code=$input['code']??null;
    if (!is_string($code) || !preg_match('/^[a-fA-F0-9]{32}$/D',trim($code))) fail('Invalid or expired invitation code.',403);
    $digest=hash('sha256',strtolower(trim($code)));
    $profile=['id'=>bin2hex(random_bytes(16)),'name'=>office_profile_name($input['name']??null)];
    $registry=office_profile_registry();
    $invite=$registry->prepare('SELECT 1 FROM profile_invites WHERE digest=? AND expires>?');
    $invite->execute([$digest,time()]);
    if (!$invite->fetchColumn()) fail('Invalid or expired invitation code.',403);
    $invite->closeCursor();
    $hash=office_profile_password_hash($input['password']??null);

    $registry->exec('BEGIN IMMEDIATE');
    try {
        $consume=$registry->prepare('DELETE FROM profile_invites WHERE digest=? AND expires>?');
        $consume->execute([$digest,time()]);
        if (!$consume->rowCount()) fail('Invalid or expired invitation code.',403);
        $insert=$registry->prepare('INSERT INTO profiles VALUES(?,?) ON CONFLICT(name) DO NOTHING');
        $insert->execute(array_values($profile));
        if (!$insert->rowCount()) fail('That profile name is already taken.',409);
        $dir=office_profile_dir($profile['id']);
        if (!@mkdir($dir,0700,true)) fail('Could not create the profile workspace.',503);
        office_store_profile_password(workspace_db($dir),$hash);
        $registry->exec('COMMIT');
    } catch (Throwable $error) { $registry->exec('ROLLBACK'); throw $error; }
    return $profile;
}
