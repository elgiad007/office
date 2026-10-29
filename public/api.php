<?php
declare(strict_types=1);
require dirname(__DIR__).'/app/bootstrap.php';
require dirname(__DIR__).'/app/formats.php';
require dirname(__DIR__).'/app/connectors.php';
require dirname(__DIR__).'/app/account-setup.php';
require dirname(__DIR__).'/app/google.php';

header('Cache-Control: no-store'); header('X-Content-Type-Options: nosniff'); header('Referrer-Policy: no-referrer');
try {
    if (PHP_VERSION_ID<80200 || !extension_loaded('pdo_sqlite')) fail('Requires PHP 8.2+ and PDO SQLite. Enable these in cPanel.',503);
    db(); start_session();
    $route=$_GET['r']??'status'; $method=$_SERVER['REQUEST_METHOD'];
    if ($route==='status' && $method==='GET') {
        $ready=setting('owner')!==null; if (!$ready) setup_token();
        json_response(['setup'=>!$ready,'authenticated'=>!empty($_SESSION['owner']),'csrf'=>$_SESSION['csrf'],'extensions'=>['sqlite'=>true,'openssl'=>extension_loaded('openssl'),'curl'=>extension_loaded('curl'),'dom'=>extension_loaded('dom')],'preferences'=>!empty($_SESSION['owner'])?setting('preferences',[]):[]]);
    }
    if ($route==='oauth-callback' && $method==='GET') {
        owner(); $oauth=$_SESSION['oauth']??null; unset($_SESSION['oauth']);
        try {
            if (!$oauth || time()-$oauth['time']>600 || !is_string($_GET['state']??null) || !hash_equals($oauth['state'],$_GET['state'])) fail('Expired or invalid Google authorization. Connect again.');
            if (!empty($_GET['error']) || !is_string($_GET['code']??null) || !$_GET['code']) fail('Google authorization was cancelled or denied. You can try connecting again.');
            $s=decrypt_secret($oauth['credentials']);
            $response=web_request('https://oauth2.googleapis.com/token','POST',['Content-Type: application/x-www-form-urlencoded'],http_build_query(['code'=>$_GET['code'],'client_id'=>$s['client_id'],'client_secret'=>$s['client_secret'],'redirect_uri'=>$oauth['redirect'],'grant_type'=>'authorization_code','code_verifier'=>$oauth['verifier']]));
            $tokens=json_decode($response['body'],true,64,JSON_THROW_ON_ERROR);
            if (empty($tokens['access_token'])) fail('Google did not return an access token. Connect again.');
            $profile=google_json('https://gmail.googleapis.com/gmail/v1/users/me/profile',$tokens['access_token']);
            finish_google_connection($oauth,$tokens,$profile);
            $_SESSION['google_notice']=['message'=>'Google account connected.','error'=>false];
        } catch (HttpError $e) { $_SESSION['google_notice']=['message'=>$e->getMessage(),'error'=>true]; }
        catch (Throwable $e) { $_SESSION['google_notice']=['message'=>'Google connection failed. Try connecting again.','error'=>true]; }
        header('Location: ./#settings',true,303); exit;
    }
    if ($method==='POST') { csrf(); $input=request_json(); }
    elseif ($method!=='GET') fail('Method not allowed.',405);
    if (in_array($route,['setup','login'],true) && $method==='POST') {
        throttle();
        if ($route==='setup') {
            if (setting('owner')!==null) fail('Already configured.',409);
            if (!hash_equals(setup_token(),(string)($input['token']??''))) fail('Incorrect setup token.',403);
            $password=(string)($input['password']??''); if (strlen($password)<12 || strlen($password)>1024) fail('Use a password between 12 and 1024 bytes.');
            $hash=password_hash($password,PASSWORD_DEFAULT); $db=db(); $db->exec('BEGIN IMMEDIATE');
            try { if (setting('owner')!==null) fail('Already configured.',409); set_setting('owner',['password'=>$hash]); $db->exec('COMMIT'); } catch(Throwable $e) { $db->exec('ROLLBACK'); throw $e; }
            @unlink(data_dir().'/setup-token.txt');
        } else { $user=setting('owner'); if (!$user || !password_verify((string)($input['password']??''),$user['password'])) fail('Incorrect password.',401); }
        session_regenerate_id(true); $_SESSION['owner']=true; $_SESSION['csrf']=bin2hex(random_bytes(32)); json_response(['ok'=>true,'csrf'=>$_SESSION['csrf']]);
    }
    owner();
    if ($route==='logout' && $method==='POST') { $_SESSION=[]; session_destroy(); json_response(['ok'=>true]); }
    if ($route==='records' && $method==='GET') {
        $kind=$_GET['kind']??''; if (!in_array($kind,KINDS,true)) fail('Unknown application.');
        $q=db()->prepare('SELECT * FROM records WHERE kind=? ORDER BY updated DESC'); $q->execute([$kind]); json_response(['records'=>array_map('record_row',$q->fetchAll())]);
    }
    if ($route==='save' && $method==='POST') {
        // Only connectors may create linked provider records.
        if (!empty($input['meta']['remote'])) fail('Provider records cannot be edited locally.');
        json_response(['record'=>save_record($input)]);
    }
    if ($route==='import-items' && $method==='POST') {
        $items=$input['records']??null; if (!is_array($items) || count($items)>500) fail('Import up to 500 items at a time.');
        $clean=[];
        foreach ($items as $item) { if (!is_array($item)) fail('Invalid import item.'); $r=validate_record($item); unset($r['meta']['remote'],$r['meta']['account'],$r['meta']['source']); $clean[]=$r; }
        $db=db(); $db->beginTransaction();
        try { foreach ($clean as $r) save_record($r); $db->commit(); } catch(Throwable $e) { $db->rollBack(); throw $e; }
        json_response(['count'=>count($clean)]);
    }
    if ($route==='delete' && $method==='POST') {
        $r=get_record((string)($input['id']??'')); if ((int)($input['revision']??0)!==$r['revision']) fail('Item changed elsewhere. Reopen it.',409);
        if (!empty($r['meta']['remote'])) fail('Remote items are read-only. Remove the account to clear its cache.');
        $q=db()->prepare('DELETE FROM records WHERE id=? AND revision=?'); $q->execute([$r['id'],$r['revision']]); if (!$q->rowCount()) fail('Item changed elsewhere.',409); json_response(['ok'=>true]);
    }
    if ($route==='history' && $method==='GET') { get_record((string)($_GET['id']??'')); $q=db()->prepare('SELECT revision,snapshot FROM revisions WHERE record_id=? ORDER BY revision DESC LIMIT 50'); $q->execute([$_GET['id']]); json_response(['revisions'=>array_map(static fn($r)=>['revision'=>(int)$r['revision'],'snapshot'=>json_decode($r['snapshot'],true)],$q->fetchAll())]); }
    if ($route==='preferences' && $method==='POST') {
        $p=$input['preferences']??[];
        if (!is_array($p) || strlen(json_encode($p))>10000) fail('Invalid preferences.'); set_setting('preferences',$p); json_response(['ok'=>true]);
    }
    if ($route==='backup' && $method==='GET') {
        $db=db(); $db->beginTransaction();
        $records=array_map('record_row',$db->query('SELECT * FROM records')->fetchAll()); $revisions=$db->query('SELECT * FROM revisions')->fetchAll(); $prefs=setting('preferences',[]); $db->commit();
        json_response(['format'=>'portable-office','version'=>1,'created'=>gmdate('c'),'records'=>$records,'revisions'=>$revisions,'preferences'=>$prefs]);
    }
    if ($route==='restore' && $method==='POST') {
        $backup=$input['backup']??[];
        if (($backup['format']??'')!=='portable-office' || ($backup['version']??0)!==1 || !is_array($backup['records']??null) || count($backup['records'])>10000) fail('Unsupported backup.');
        $validated=[]; $seen=[];
        foreach ($backup['records'] as $r) {
            if (!is_array($r)) fail('Invalid backup record.'); $v=validate_record($r); $id=(string)($r['id']??'');
            if (!preg_match('/^[a-zA-Z0-9_-]{1,100}$/D',$id) || isset($seen[$id])) fail('Invalid or duplicate backup ID.');
            $seen[$id]=true; $v['id']=$id; $v['revision']=max(1,(int)($r['revision']??1)); $v['updated']=gmdate('c');
            // Restored provider data is a local archive, not a live account connection.
            if (!empty($v['meta']['remote'])) { $v['meta']['importedFrom']=$v['meta']['accountLabel']??'Remote account'; unset($v['meta']['remote'],$v['meta']['account'],$v['meta']['source']); }
            $validated[]=$v;
        }
        $histories=$backup['revisions']??[]; if (!is_array($histories) || count($histories)>20000) fail('Invalid revision history.');
        foreach ($histories as $h) { if (!is_array($h) || !isset($seen[$h['record_id']??'']) || (int)($h['revision']??0)<1 || !is_array(json_decode($h['snapshot']??'',true))) fail('Invalid revision history.'); validate_record(json_decode($h['snapshot'],true)); }
        $prefs=$backup['preferences']??[]; if (!is_array($prefs) || strlen(json_encode($prefs))>10000) fail('Invalid preferences.');
        $db=db(); $db->exec('BEGIN IMMEDIATE');
        try {
            // Merge only into an empty local workspace to avoid accidental overwrites.
            if ((int)$db->query('SELECT COUNT(*) FROM records')->fetchColumn()!==0) fail('Restore requires an empty workspace. Use a fresh installation to keep existing work safe.',409);
            $q=$db->prepare('INSERT INTO records VALUES(?,?,?,?,?,?,?)');
            foreach ($validated as $v) $q->execute([$v['id'],$v['kind'],$v['title'],$v['body'],json_encode($v['meta'],JSON_THROW_ON_ERROR),$v['revision'],$v['updated']]);
            $q=$db->prepare('INSERT INTO revisions VALUES(?,?,?)'); foreach ($histories as $h) $q->execute([$h['record_id'],(int)$h['revision'],$h['snapshot']]);
            set_setting('preferences',$prefs); $db->exec('COMMIT');
        } catch(Throwable $e) { $db->exec('ROLLBACK'); throw $e; }
        json_response(['count'=>count($validated)]);
    }
    if ($route==='import' && $method==='POST') {
        $format=$input['format']??''; $raw=(string)($input['text']??''); $items=[];
        if ($format==='ics') { foreach (parse_ics($raw) as $e) $items[]=$e+['kind'=>'calendar']; }
        elseif ($format==='eml') { if (isset($input['base64'])) { $raw=base64_decode((string)$input['base64'],true); if ($raw===false) fail('Invalid EML source.'); } if(strlen($raw)>1400000)fail('Original EML import is limited to 1.4 MB in this version.'); $e=parse_eml($raw); $e['meta']['rawBase64']=base64_encode($raw); $e['meta']['folder']='Archive'; $items[]=$e+['kind'=>'mail']; }
        else fail('Unsupported server import.');
        if (count($items)>500) fail('Import up to 500 items at a time.');
        foreach ($items as $r) validate_record($r);
        $db=db(); $db->beginTransaction();
        try { foreach ($items as $r) save_record($r); $db->commit(); } catch(Throwable $e) { $db->rollBack(); throw $e; }
        json_response(['count'=>count($items)]);
    }
    if ($route==='google-settings' && $method==='GET') {
        $settings=google_settings(); $notice=$_SESSION['google_notice']??null; unset($_SESSION['google_notice']);
        json_response(['configured'=>!!$settings,'client_id'=>$settings['client_id']??'','redirect'=>$settings['redirect']??'','notice'=>$notice]);
    }
    if ($route==='google-settings' && $method==='POST') {
        save_google_settings($input); json_response(['ok'=>true]);
    }
    if ($route==='accounts' && $method==='GET') { $rows=db()->query('SELECT id,label,type,last_sync,error FROM accounts ORDER BY label')->fetchAll(); json_response(['accounts'=>$rows]); }
    if ($route==='account-save' && $method==='POST') {
        if (!extension_loaded('openssl')) fail('OpenSSL is required for encrypted account credentials.');
        $account=validate_account_input($input);
        $id=bin2hex(random_bytes(16)); db()->prepare('INSERT INTO accounts(id,label,type,config,secret) VALUES(?,?,?,?,?)')->execute([$id,$account['label'],$account['type'],json_encode($account['config']),encrypt_secret($account['credentials'])]); json_response(['id'=>$id]);
    }
    if ($route==='account-test' && $method==='POST') {
        $account=validate_account_input($input);
        session_write_close();
        json_response(check_account_connection($account));
    }
    if ($route==='account-delete' && $method==='POST') {
        $a=account((string)($input['id']??'')); $db=db(); $db->beginTransaction();
        $q=$db->prepare("DELETE FROM records WHERE json_extract(meta,'$.account')=? AND json_extract(meta,'$.remote')=1"); $q->execute([$a['id']]); $db->prepare('DELETE FROM accounts WHERE id=?')->execute([$a['id']]); $db->commit(); json_response(['ok'=>true]);
    }
    if ($route==='google-connect' && $method==='POST') {
        json_response(['url'=>start_google_connection($input)]);
    }
    if ($route==='sync' && $method==='POST') {
        $a=account((string)($input['id']??'')); session_write_close();
        try {
            $count=with_account_mail_lock($a['id'],function() use (&$a) { return match($a['type']) { 'google'=>sync_google($a),'imap'=>sync_imap($a),'caldav'=>sync_caldav($a) }; });
            db()->prepare('UPDATE accounts SET last_sync=?,error=NULL WHERE id=?')->execute([gmdate('c'),$a['id']]); json_response(['count'=>$count]);
        } catch(Throwable $e) { db()->prepare('UPDATE accounts SET error=? WHERE id=?')->execute(['Sync failed. Open Sync now to retry and see details.',$a['id']]); throw $e; }
    }
    if ($route==='send' && $method==='POST') {
        $r=get_record((string)($input['id']??'')); if ($r['kind']!=='mail' || ($r['meta']['folder']??'')!=='Drafts') fail('Select a saved draft.');
        if ((int)($input['revision']??0)!==$r['revision']) fail('Draft changed. Reopen before sending.',409);
        $a=account((string)($input['account']??''));
        if (!filter_var($r['meta']['to']??'',FILTER_VALIDATE_EMAIL) || preg_match('/[\r\n]/',$r['title']) || strlen($r['body'])>1000000) fail('Use one valid recipient, a one-line subject and a plain-text message up to 1 MB.');
        // Persist an uncertain state before networking; a dropped response must not trigger an automatic resend.
        $r['meta']['folder']='Sending'; $r=save_record($r);
        try { $raw=send_mail($a,(string)($r['meta']['to']??''),$r['title'],$r['body']); $r['meta']['folder']='Sent'; $r['meta']['sentAt']=gmdate('c'); $r['meta']['from']=$a['config']['email']; $r['meta']['rawBase64']=base64_encode($raw); $r['meta']['read']=true; save_record($r); json_response(['ok'=>true]); }
        catch(Throwable $e) { $r['meta']['folder']='Delivery uncertain'; save_record($r); fail($e->getMessage().' Check the recipient/provider before creating another send attempt.'); }
    }
    if ($route==='mail-action' && $method==='POST') {
        $r=get_record((string)($input['id']??'')); if ((int)($input['revision']??0)!==$r['revision'])fail('Message changed. Reopen it.',409);
        $action=(string)($input['action']??''); if (!in_array($action,['archive','read','unread'],true))fail('Unknown mail action.');
        session_write_close();
        $record=with_account_mail_lock((string)($r['meta']['account']??''),function() use ($r,$action,$input) {
            $current=get_record($r['id']);
            if ((int)($input['revision']??0)!==$current['revision']) fail('Message changed. Reopen it.',409);
            return remote_mail_action($current,$action);
        });
        json_response(['record'=>$record]);
    }
    fail('Route not found.',404);
} catch (HttpError $e) { json_response(['error'=>$e->getMessage()],$e->getCode() ?: 400); }
catch (Throwable $e) { error_log('Portable Office: '.$e->getMessage()); json_response(['error'=>'Server operation failed. Check the private server error log and PHP extensions.'],500); }
