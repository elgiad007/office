<?php
declare(strict_types=1);
require dirname(__DIR__).'/app/bootstrap.php';
require dirname(__DIR__).'/app/formats.php';
require dirname(__DIR__).'/app/connectors.php';
require dirname(__DIR__).'/app/account-setup.php';
require dirname(__DIR__).'/app/google.php';
require dirname(__DIR__).'/app/mail-folders.php';
require dirname(__DIR__).'/app/mail-transfer.php';
require dirname(__DIR__).'/app/mail-undo.php';
require dirname(__DIR__).'/app/mail-empty-junk.php';

header('Cache-Control: no-store'); header('X-Content-Type-Options: nosniff'); header('Referrer-Policy: no-referrer');
try {
    if (PHP_VERSION_ID<80200 || !extension_loaded('pdo_sqlite')) fail('Requires PHP 8.2+ and PDO SQLite. Enable these in cPanel.',503);
    db(); start_session();
    $route=$_GET['r']??'status'; $method=$_SERVER['REQUEST_METHOD'];
    if ($route==='status' && $method==='GET') {
        $ready=setting('owner')!==null; if (!$ready) setup_token();
        json_response(['setup'=>!$ready,'authenticated'=>!empty($_SESSION['owner']),'activity'=>!empty($_SESSION['owner']),'csrf'=>$_SESSION['csrf'],'extensions'=>['sqlite'=>true,'openssl'=>extension_loaded('openssl'),'curl'=>extension_loaded('curl'),'dom'=>extension_loaded('dom')],'preferences'=>!empty($_SESSION['owner'])?setting('preferences',[]):[]]);
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
    if($route==='connection-search' && $method==='GET') { session_write_close();json_response(['items'=>connection_search((string)($_GET['q']??''),(string)($_GET['kind']??''),(string)($_GET['exclude']??''))]); }
    if($route==='connections' && $method==='GET') {
        session_write_close();
        $mode=(string)($_GET['mode']??'');$offset=(int)($_GET['offset']??0);$visibility=(string)($_GET['visibility']??'active');
        if($mode==='overview')json_response(connection_overview($offset,$visibility));
        if($mode==='items')json_response(connection_explorer_search((string)($_GET['q']??''),(string)($_GET['kind']??''),$offset,$visibility));
        json_response(connection_list((string)($_GET['id']??''),(string)($_GET['q']??''),$offset,(string)($_GET['kind']??''),(string)($_GET['group']??''),$mode==='graph',$visibility));
    }
    if($route==='connection' && $method==='POST') {
        $a=(string)($input['id']??'');$b=(string)($input['target']??'');
        if(in_array($input['action']??'',['archive','restore'],true)){
            $changed=connection_set_archived($a,$b,(string)($input['scope']??'edge'),$input['action']==='archive',(string)($input['visibility']??'active'));
            json_response(['ok'=>true,'changed'=>$changed,'connectionCounts'=>(object)connection_counts()]);
        }
        if(($input['action']??'add')==='add')connection_add($a,$b);
        elseif($input['action']==='remove'){get_record($a);get_record($b);db()->prepare('DELETE FROM connections WHERE (a=? AND b=?) OR (a=? AND b=?)')->execute([$a,$b,$b,$a]);}
        else fail('Unknown connection action.');
        json_response(['ok'=>true,'connectionCounts'=>(object)connection_counts([$a,$b])]);
    }
    if($route==='activity' && $method==='GET') { session_write_close();json_response(['entries'=>activity_rows((int)($_GET['after']??0))]); }
    if($route==='activity' && $method==='POST') {
        if(($input['action']??'')==='clear'){activity_db()->exec('DELETE FROM activity');json_response(['ok'=>true]);}
        if(!in_array($input['action']??'',['notice','diagnostic'],true)||!is_string($input['message']??null)||strlen($input['message'])>1000)fail('Invalid activity message.');
        $diagnostic=$input['action']==='diagnostic';
        activity_event($input['message'],!$diagnostic&&!empty($input['error'])?'error':'info',$diagnostic?'diagnostic':'notice');json_response(['ok'=>true]);
    }
    $activityNames=['mail-undo'=>'Undo mail deletion','save'=>'Save item','delete'=>'Delete item','preferences'=>'Save preferences','account-save'=>'Save account','account-delete'=>'Remove account','account-test'=>'Test connection','google-settings'=>'Save Google integration','google-connect'=>'Connect Google account','sync'=>'Synchronize account','send'=>'Send mail','mail-folders'=>'Discover folders','mail-folder-sync'=>'Refresh folder','mail-folder-manage'=>'Manage folder','mail-action'=>'Update mail','backup'=>'Download backup','restore'=>'Restore backup','import'=>'Import items','import-items'=>'Import items'];
    if(isset($activityNames[$route]) && ($method==='POST'||$route==='backup')) {
        $label='';$accountId=$input['account']??($route==='sync'?($input['id']??null):null);
        if($route==='mail-action'){$mail=get_record((string)($input['id']??''));$accountId=$mail['meta']['account']??null;}
        if(is_string($accountId)&&$accountId!=='')$label=account($accountId)['label'];
        $operation=$route==='mail-action'?(['trash'=>'Move to Trash','archive'=>'Archive mail','restore'=>'Restore to Inbox','read'=>'Mark mail read','unread'=>'Mark mail unread','move'=>'Move mail','discard'=>'Discard cached copy','keep-local'=>'Save local copy','label'=>'Add label','unlabel'=>'Remove label'][$input['action']??'']??'Update mail'):$activityNames[$route];
        activity_begin($operation,$label);
    }
    if ($route==='logout' && $method==='POST') { $_SESSION=[]; session_destroy(); json_response(['ok'=>true]); }
    if ($route==='records' && $method==='GET') {
        $kind=$_GET['kind']??''; if (!in_array($kind,KINDS,true)) fail('Unknown application.');
        session_write_close();
        $db=db();$q=$db->prepare('SELECT * FROM records WHERE kind=? ORDER BY updated DESC');$q->execute([$kind]);
        if($kind==='mail' && ($_GET['summaries']??'')==='1'){
            $cached=[];$files=$db->query('SELECT record_id,part,name,type,size FROM mail_files ORDER BY rowid');
            foreach($files as $file){$id=$file['record_id'];unset($file['record_id']);$cached[$id][]=$file+['available'=>true];}
            $records=[];foreach($q as $row)$records[]=mail_list_record(record_row($row,$cached[$row['id']]??[]));
        }else $records=array_map('record_row',$q->fetchAll());
        if($kind==='mail'){
            $counts=connection_counts();foreach($records as &$record)$record['connectionCount']=(int)($counts[$record['id']]??0);unset($record);
        }
        json_response(['records'=>$records]);
    }
    if ($route==='record' && $method==='GET') {session_write_close();json_response(['record'=>get_record((string)($_GET['id']??''))]);}
    if($route==='mail-files' && $method==='POST'){
        $r=get_record((string)($input['id']??''));session_write_close();
        $operation=fn()=>attachment_request($input);
        $result=!empty($r['meta']['remote'])?with_account_mail_mutation($r['meta']['account'],$operation):$operation();
        $result['record']=mail_list_record($result['record']);json_response($result);
    }
    if ($route==='mail-content' && $method==='POST') {
        $r=get_record((string)($input['id']??''));
        if($r['kind']!=='mail' || empty($r['meta']['remote']))fail('Choose synchronized mail.');
        session_write_close();
        $record=with_account_mail_mutation($r['meta']['account'],fn()=>download_mail_content($r));
        if(($input['summary']??false)===true)$record=mail_list_record($record);
        json_response(['record'=>$record]);
    }
    if ($route==='save' && $method==='POST') {
        // Only connectors may create linked provider records.
        if (!empty($input['meta']['remote'])) fail('Provider records cannot be edited locally.');
        $linkedTo=$input['linkedTo']??null;
        if($linkedTo!==null){
            if(!is_string($linkedTo)||isset($input['id']))fail('Linked creation requires a new item and a saved source.');
            $db=db();$db->beginTransaction();
            try{get_record($linkedTo);$record=save_record($input);connection_add($linkedTo,$record['id']);$db->commit();}
            catch(Throwable $e){if($db->inTransaction())$db->rollBack();throw $e;}
            $record['connectionCount']=(int)get_record($record['id'])['connectionCount'];
            json_response(['record'=>$record,'connectionCounts'=>(object)connection_counts([$linkedTo,$record['id']])]);
        }
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
        $hubTitle=$input['connectionHubTitle']??null;
        if($hubTitle!==null&&!is_string($hubTitle))fail('Invalid connection hub name.');
        if($r['kind']==='mail'&&($input['undoable']??false)===true)json_response(delete_local_mail($r,$hubTitle));
        json_response(delete_connected_record($r,$hubTitle));
    }
    if ($route==='history' && $method==='GET') { get_record((string)($_GET['id']??'')); $q=db()->prepare('SELECT revision,snapshot FROM revisions WHERE record_id=? ORDER BY revision DESC LIMIT 50'); $q->execute([$_GET['id']]); json_response(['revisions'=>array_map(static fn($r)=>['revision'=>(int)$r['revision'],'snapshot'=>json_decode($r['snapshot'],true)],$q->fetchAll())]); }
    if ($route==='preferences' && $method==='POST') {
        $p=$input['preferences']??[];
        if (!is_array($p) || strlen(json_encode($p))>10000) fail('Invalid preferences.'); set_setting('preferences',$p); json_response(['ok'=>true]);
    }
    if ($route==='backup' && $method==='GET') {
        $db=db(); $db->beginTransaction();
        $records=array_map('record_row',$db->query('SELECT * FROM records')->fetchAll()); $revisions=$db->query('SELECT * FROM revisions')->fetchAll(); $prefs=setting('preferences',[]);$files=$db->query('SELECT * FROM mail_files')->fetchAll(); $links=$db->query('SELECT a,b,created,archived FROM connections')->fetchAll(); $db->commit();
        json_response(['format'=>'portable-office','version'=>1,'created'=>gmdate('c'),'records'=>$records,'revisions'=>$revisions,'preferences'=>$prefs,'mailFiles'=>$files,'connections'=>$links]);
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
        $links=$backup['connections']??[];if(!is_array($links)||count($links)>100000)fail('Invalid connections.');
        foreach($links as $link)if(!is_array($link)||!is_string($link['a']??null)||!is_string($link['b']??null)||$link['a']===$link['b']||!isset($seen[$link['a']],$seen[$link['b']]))fail('Invalid connection endpoints.');
        foreach($links as $link)if(!in_array($link['archived']??0,[0,1,false,true],true))fail('Invalid connection archive status.');
        foreach($links as $link)if(isset($link['created'])&&!is_string($link['created']))fail('Invalid connection date.');
        $files=$backup['mailFiles']??[];if(!is_array($files)||count($files)>50000)fail('Invalid attachment backup.');
        $fileKeys=[];
        foreach($files as $file){
            if(!is_array($file)||!isset($seen[$file['record_id']??''])||!is_string($file['part']??null)||!preg_match('/^[a-zA-Z0-9_.-]{1,100}$/D',$file['part'])||!is_string($file['name']??null)||!is_string($file['type']??null)||!is_string($file['data']??null))fail('Invalid attachment backup.');
            $bytes=base64_decode($file['data'],true);if($bytes===false||strlen($bytes)>MAIL_FILE_LIMIT||strlen($bytes)!==($file['size']??null))fail('Invalid attachment backup data.');
            $key=$file['record_id'].'/'.$file['part'];if(isset($fileKeys[$key]))fail('Duplicate attachment backup.');$fileKeys[$key]=true;
        }
        $db=db(); $db->exec('BEGIN IMMEDIATE');
        try {
            // Merge only into an empty local workspace to avoid accidental overwrites.
            if ((int)$db->query('SELECT COUNT(*) FROM records')->fetchColumn()!==0) fail('Restore requires an empty workspace. Use a fresh installation to keep existing work safe.',409);
            $q=$db->prepare('INSERT INTO records VALUES(?,?,?,?,?,?,?)');
            foreach ($validated as $v) $q->execute([$v['id'],$v['kind'],$v['title'],$v['body'],json_encode($v['meta'],JSON_THROW_ON_ERROR),$v['revision'],$v['updated']]);
            $q=$db->prepare('INSERT INTO revisions VALUES(?,?,?)'); foreach ($histories as $h) $q->execute([$h['record_id'],(int)$h['revision'],$h['snapshot']]);
            foreach($files as $file)attachment_store($file['record_id'],$file,base64_decode($file['data'],true));
            connection_restore($links);
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
    if ($route==='accounts' && $method==='GET') {
        session_write_close();
        $rows=db()->query('SELECT id,label,type,last_sync,error FROM accounts ORDER BY label')->fetchAll();
        foreach ($rows as &$row) $row['folders']=setting('mail-folders:'.$row['id'],[]);
        unset($row); json_response(['accounts'=>$rows]);
    }
    if ($route==='mail-empty-junk' && $method==='POST') {
        if (($input['action']??'')==='preview') {
            unset($_SESSION['empty_junk']);
            session_write_close();
            $preview=preview_empty_junk((string)($input['account']??''),(string)($input['folder']??''));
            if (!empty($preview['authorize'])) json_response(['authorize'=>true]);
            $count=count($preview['ids']);
            $token=$count?bin2hex(random_bytes(24)):'';
            if ($count) {
                session_start();
                owner();csrf();
                $_SESSION['empty_junk']=$preview+['token'=>$token,'expires'=>time()+300];
                session_write_close();
            }
            json_response(['count'=>$count,'name'=>$preview['name'],'token'=>$token]);
        }
        if (($input['action']??'')!=='empty') fail('Unknown Junk folder action.');
        $preview=$_SESSION['empty_junk']??null;
        if (!$preview || time()>$preview['expires'] || !is_string($input['token']??null) || !hash_equals($preview['token'],$input['token'])) fail('The confirmation expired. Review the Junk folder again.',409);
        unset($_SESSION['empty_junk']);
        session_write_close();
        json_response(empty_junk($preview));
    }
    if ($route==='mail-junk-settings' && $method==='POST') {
        $a=account((string)($input['account']??''));
        if (!in_array($a['type'],['google','imap'],true)) fail('Choose a mail account.');
        session_write_close();
        $operation=(string)($input['operation']??'list');
        $read=fn()=>['rules'=>array_values(array_map(fn($rule)=>['type'=>$rule['type'],'target'=>$rule['target']],mail_block_rules($a['id']))),'folder'=>imap_folder_decode(setting('mail-junk-folder:'.$a['id'],''))];
        if ($operation==='list') json_response($read());
        json_response(with_account_mail_mutation($a['id'],function()use($a,$operation,$input,$read){
            if (in_array($operation,['add','remove'],true)) {
                update_mail_block($a['id'],(string)($input['type']??''),(string)($input['target']??''),$operation==='remove');
            } elseif ($operation==='folder' && $a['type']==='imap') {
                $name=trim((string)($input['folder']??''));
                $path=$name===''?'':imap_folder_encode($name);
                if ($path!=='') {
                    $catalog=discover_mail_folders($a);
                    $folder=mail_folder_find($catalog,$path);
                    if (!in_array($folder['role'],['Custom folder','Junk'],true) || ($folder['protected'] && !in_array($folder['role'],['Junk'],true))) fail('Choose a Junk folder or an unprotected custom folder.');
                }
                set_setting('mail-junk-folder:'.$a['id'],$path);
            } else fail('Unknown Junk settings operation.');
            return $read();
        }));
    }
    if (in_array($route,['mail-folders','mail-folder-manage','mail-folder-sync'],true) && $method==='POST') {
        $a=account((string)($input['account']??'')); session_write_close();
        $operation=function() use($route,$a,$input) {
            if ($route==='mail-folders') return ['folders'=>discover_mail_folders($a)];
            if ($route==='mail-folder-manage') return ['folders'=>manage_mail_folder($a,(string)($input['action']??''),(string)($input['folder']??''),(string)($input['name']??''))];
            return ['count'=>sync_mail_folder($a,(string)($input['folder']??''),(int)($input['limit']??MAIL_SYNC_BATCH))];
        };
        $result=$route==='mail-folder-sync'?['count'=>with_account_mail_sync($a['id'],fn()=>$operation()['count'])]
            :($route==='mail-folder-manage'?with_account_mail_mutation($a['id'],$operation):with_account_mail_lock($a['id'],$operation));
        $key=$a['type']==='google'?'label:'.($input['folder']??''):($input['folder']??'');
        if($route==='mail-folder-sync')$result['more']=(bool)(setting('mail-pending:'.$a['id'],[])[$key]??false);
        json_response($result);
    }
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
        $repair=$input['repair']??false; if (!is_bool($repair)) fail('Invalid repair option.');
        $batches=$input['batches']??1;if(!is_int($batches) || $batches<1 || $batches>4)fail('Choose between one and four sync batches.');
        $a=account((string)($input['id']??'')); session_write_close();
        try {
            $operation=function() use (&$a,$repair,$batches) {
                $count=match($a['type']) { 'google'=>sync_google($a,$repair),'imap'=>sync_imap($a,$repair,$batches),'caldav'=>sync_caldav($a) };
                if ($a['type']!=='caldav') apply_mail_blocks($a);
                return $count;
            };
            $count=$a['type']==='caldav'?with_account_mail_lock($a['id'],$operation):with_account_mail_sync($a['id'],$operation);
            db()->prepare('UPDATE accounts SET last_sync=?,error=NULL WHERE id=?')->execute([gmdate('c'),$a['id']]);
            $pending=setting('mail-pending:'.$a['id'],[]);
            $more=$pending['standard']??false;
            json_response(['count'=>$count,'more'=>$more]);
        } catch(Throwable $e) { db()->prepare('UPDATE accounts SET error=? WHERE id=?')->execute(['Sync failed. Open Sync now to retry and see details.',$a['id']]); throw $e; }
    }
    if ($route==='send' && $method==='POST') {
        $r=get_record((string)($input['id']??'')); if ($r['kind']!=='mail' || ($r['meta']['folder']??'')!=='Drafts') fail('Select a saved draft.');
        if ((int)($input['revision']??0)!==$r['revision']) fail('Draft changed. Reopen before sending.',409);
        $a=account((string)($input['account']??''));
        if (!filter_var($r['meta']['to']??'',FILTER_VALIDATE_EMAIL) || preg_match('/[\r\n]/',$r['title']) || strlen($r['body'])>1000000) fail('Use one valid recipient, a one-line subject and a plain-text message up to 1 MB.');
        // Persist an uncertain state before networking; a dropped response must not trigger an automatic resend.
        $r['meta']['folder']='Sending'; $r=save_record($r);
        try { $raw=send_mail($a,(string)($r['meta']['to']??''),$r['title'],$r['body'],attachment_draft_files($r)); $r['meta']['folder']='Sent'; $r['meta']['filePartsLocal']=true; $r['meta']['hasHtml']=false; $r['meta']['sentAt']=gmdate('c'); $r['meta']['from']=$a['config']['email']; $r['meta']['rawBase64']=base64_encode($raw); $r['meta']['read']=true; save_record($r); json_response(['ok'=>true]); }
        catch(Throwable $e) { $r['meta']['folder']='Delivery uncertain'; save_record($r); fail($e->getMessage().' Check the recipient/provider before creating another send attempt.'); }
    }
    if ($route==='mail-action' && $method==='POST') {
        $r=get_record((string)($input['id']??'')); if ((int)($input['revision']??0)!==$r['revision'])json_response(['error'=>'Message changed. Reopen it.','code'=>'mail_revision_conflict','record'=>$r],409);
        $action=(string)($input['action']??''); if (!in_array($action,['archive','trash','restore','read','unread','keep-local','discard','move','label','unlabel','junk','not-junk','block-sender','block-domain'],true))fail('Unknown mail action.');
        session_write_close();
        $result=with_account_mail_mutation((string)($r['meta']['account']??''),function() use ($r,$action,$input) {
            $current=get_record($r['id']);
            if ((int)($input['revision']??0)!==$current['revision']) json_response(['error'=>'Message changed. Reopen it.','code'=>'mail_revision_conflict','record'=>$current],409);
            $accountId=(string)($current['meta']['account']??'');
            $ids=db()->prepare("SELECT id FROM records WHERE kind='mail' AND json_extract(meta,'$.remote')=1 AND json_extract(meta,'$.account')=?");
            $ids->execute([$accountId]);$before=$ids->fetchAll(PDO::FETCH_COLUMN);
            $destination=(string)($input['destinationAccount']??'');
            $undoBefore=null;
            $undoToken=null;
            if($action==='trash'&&($input['undoable']??false)===true){
                if(($current['meta']['folder']??'')==='Trash')fail('The message is already in Trash.');
                $undoBefore=$current;$a=account($accountId);
                if($a['type']==='google'){
                    $live=google_json('https://gmail.googleapis.com/gmail/v1/users/me/messages/'.rawurlencode($current['meta']['providerId']).'?format=minimal',google_token($a));
                    if(!is_array($live['labelIds']??null)||in_array('TRASH',$live['labelIds'],true))fail('Message membership changed. Sync before deleting.',409);
                    $undoBefore['meta']['labelIds']=$live['labelIds'];
                }
                $undoBefore=['id'=>$undoBefore['id'],'meta'=>$undoBefore['meta']];
                unset($undoBefore['meta']['rawBase64'],$undoBefore['meta']['raw'],$undoBefore['meta']['headersBase64']);
                $undoToken=mail_undo_receipt(['before'=>$undoBefore],'pending');
            }
            if (in_array($action,['junk','not-junk','block-sender','block-domain'],true)) {
                if (str_starts_with($action,'block-')) {
                    $type=substr($action,6);
                    $target=mail_block_target($current['meta']['from']??'',$type);
                    if ($current['kind']!=='mail' || empty($current['meta']['remote']) || $target===null || $target!==($input['target']??null)) fail('The sender changed or has no valid address.');
                    if (in_array($current['meta']['folder']??'',['Drafts','Sending','Delivery uncertain','Recovery copies','Not in Inbox'],true)) fail('Choose a message that can be moved.');
                    update_mail_block($accountId,$type,$target);
                    try { $record=move_mail_junk($current,false); }
                    catch (HttpError $e) { fail('Block rule saved. '.$e->getMessage(),$e->getCode()?:400); }
                } else $record=move_mail_junk($current,$action==='not-junk');
            } else $record=$action==='move' && $destination!=='' && $destination!==$accountId
                ?with_account_mail_mutation($destination,fn()=>transfer_remote_mail($current,account($destination),(string)($input['folder']??'')))
                :(in_array($action,['move','label','unlabel'],true)?file_remote_mail($current,$action,(string)($input['folder']??''),$destination!=='')
                :(in_array($action,['keep-local','discard'],true)?recovery_mail_action($current,$action,$input['connectionHubTitle']??null):remote_mail_action($current,$action,$undoBefore)));
            $ids->execute([$accountId]);
            $result=['record'=>$record,'removedIds'=>array_values(array_diff($before,$ids->fetchAll(PDO::FETCH_COLUMN)))];
            if($undoBefore!==null&&($record['meta']['folder']??'')==='Trash'){
                $after=['id'=>$record['id'],'meta'=>array_intersect_key($record['meta'],array_flip(['account','providerId','serverFolder','uidValidity','source','labelIds']))];
                db()->prepare("UPDATE mail_undo SET state='ready',payload=? WHERE token=?")->execute([json_encode(['before'=>$undoBefore,'after'=>$after],JSON_THROW_ON_ERROR),$undoToken]);$result['undoToken']=$undoToken;
            }
            return $result;
        });
        if(($input['summary']??false)===true && $result['record']!==null)$result['record']=mail_list_record($result['record']);
        json_response($result);
    }
    if($route==='mail-undo'&&$method==='POST'){
        session_write_close();$result=undo_mail_delete((string)($input['token']??''));
        $result['record']=mail_list_record($result['record']);json_response($result);
    }
    fail('Route not found.',404);
} catch (HttpError $e) { json_response(['error'=>$e->getMessage()],$e->getCode() ?: 400); }
catch (Throwable $e) { error_log('Portable Office: '.$e->getMessage()); json_response(['error'=>'Server operation failed. Check the private server error log and PHP extensions.'],500); }
