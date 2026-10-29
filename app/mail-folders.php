<?php
declare(strict_types=1);

// Provider IDs are kept separate from display names and from Office's local views.
function folder_name(string $name): string {
    if (trim($name)==='' || strlen($name)>500 || preg_match('/[\x00-\x1f\x7f]/',$name) || !preg_match('//u',$name)) fail('Use a folder name of 1–500 bytes without control characters.');
    return $name;
}
function imap_folder_encode(string $name): string {
    folder_name($name);
    return preg_replace_callback('/[^\x20-\x7e]+|&/u',static function($m) {
        if ($m[0]==='&') return '&-';
        if (!function_exists('iconv')) fail('The iconv extension is required for international folder names.');
        return '&'.rtrim(str_replace('/',',',base64_encode(iconv('UTF-8','UTF-16BE',$m[0]))),'=').'-';
    },$name);
}
function imap_folder_decode(string $name): string {
    return preg_replace_callback('/&([A-Za-z0-9+,]*)-/',static function($m) {
        if ($m[1]==='') return '&';
        if (!function_exists('iconv')) return $m[0];
        $bytes=base64_decode(str_replace(',','/',$m[1]),true);
        return $bytes===false?$m[0]:(@iconv('UTF-16BE','UTF-8',$bytes)?:$m[0]);
    },$name);
}
function imap_folder_catalog(array $a,mixed $s): array {
    $cap=imap_command($s,'CAPABILITY');
    $special=(bool)preg_match('/\bSPECIAL-USE\b/i',implode('',$cap['lines']));
    $folders=imap_list_folders(imap_command($s,'LIST "" "*"'.($special?' RETURN (SPECIAL-USE)':'')));
    $protected=['INBOX']; $roles=['INBOX'=>'Inbox'];
    foreach (['archive','trash'] as $role) {
        $path=imap_resolve_folder($folders,$a['config'][$role.'Folder']??ucfirst($role),$role,false);
        if ($path!==null) { $protected[]=$path; $roles[$path]=ucfirst($role); }
    }
    $result=[];
    foreach ($folders as $path=>$info) {
        $name=imap_folder_decode((string)$path);
        $result[]=['id'=>(string)$path,'name'=>$name,'delimiter'=>$info['delimiter'],'role'=>$roles[$path]??'Custom folder','protected'=>$info['protected'] || in_array($path,$protected,true) || in_array(strtolower($name),['inbox','sent','sent items','sent mail','drafts','trash','deleted items','junk','spam','archive','all mail'],true)];
    }
    return $result;
}
function gmail_folder_catalog(array $response): array {
    if (!is_array($response['labels']??null)) fail('Invalid Gmail label list.');
    $result=[];
    foreach ($response['labels'] as $label) {
        if (!is_string($label['id']??null) || !is_string($label['name']??null) || !in_array($label['type']??'', ['system','user'],true)) fail('Invalid Gmail label.');
        if ($label['type']==='system' && !in_array($label['id'],['INBOX','SENT','TRASH','SPAM'],true)) continue;
        $result[]=['id'=>$label['id'],'name'=>$label['name'],'delimiter'=>'/','protected'=>$label['type']==='system'];
    }
    return $result;
}
function mail_folder_find(array $folders,string $id): array {
    foreach ($folders as $folder) if ($folder['id']===$id) return $folder;
    fail('Folder no longer exists. Refresh the folder list.',409);
}
function mail_folder_cache(array $a,array $folders): array {
    usort($folders,static fn($x,$y)=>strnatcasecmp($x['name'],$y['name']));
    set_setting('mail-folders:'.$a['id'],$folders); return $folders;
}
function with_imap_folders(array $a,callable $run): mixed {
    $s=socket_connection($a['config']['host'],993);
    try {
        if (!str_starts_with((string)fgets($s,65536),'* OK')) fail('Unexpected IMAP greeting.');
        imap_command($s,'LOGIN '.imap_quote($a['credentials']['username']).' '.imap_quote($a['credentials']['password']));
        return $run($s);
    } finally { fclose($s); }
}
function discover_mail_folders(array $a): array {
    if ($a['type']==='imap') $folders=with_imap_folders($a,fn($s)=>imap_folder_catalog($a,$s));
    elseif ($a['type']==='google') $folders=gmail_folder_catalog(google_json('https://gmail.googleapis.com/gmail/v1/users/me/labels',google_token($a)));
    else fail('Choose a mail account.');
    return mail_folder_cache($a,$folders);
}
function imap_manage_folder(array $a,mixed $s,string $action,string $id,string $name): array {
    $folders=imap_folder_catalog($a,$s); $folder=null;
    if ($action!=='create') {
        $folder=mail_folder_find($folders,$id);
        if ($folder['protected']) fail('Standard system folders cannot be renamed or deleted.');
        if ($folder['delimiter']!=='') foreach ($folders as $other) {
            if ($other['protected'] && str_starts_with($other['id'],$id.$folder['delimiter'])) fail('A parent of a system folder cannot be renamed or deleted.');
        }
        // Refuse deleting a parent: deleting a hierarchy varies between servers.
        if ($action==='delete' && $folder['delimiter']!=='') foreach ($folders as $other) {
            if (str_starts_with($other['id'],$id.$folder['delimiter'])) fail('Move or delete subfolders first.');
        }
    }
    $target=$action==='delete'?'':imap_folder_encode($name);
    if ($action!=='delete') foreach ($folders as $other) if (strcasecmp($other['id'],$target)===0) fail('A folder with that name already exists.');
    if ($action==='create') imap_command($s,'CREATE '.imap_quote($target));
    elseif ($action==='rename') {
        if ($folder['delimiter']!=='' && str_starts_with($target,$id.$folder['delimiter'])) fail('A folder cannot be moved inside itself.');
        imap_command($s,'RENAME '.imap_quote($id).' '.imap_quote($target));
    } elseif ($action==='delete') {
        imap_command($s,'EXAMINE '.imap_quote($id));
        if (imap_search_ids($s,'ALL')) fail('Only empty IMAP folders can be deleted. Move their messages first.');
        // Leave the target without CLOSE or EXPUNGE before DELETE.
        imap_command($s,'EXAMINE "INBOX"');
        imap_command($s,'DELETE '.imap_quote($id));
    } else fail('Unknown folder action.');
    // Refresh rather than assuming the server's resulting hierarchy.
    $after=imap_folder_catalog($a,$s);
    if ($action!=='delete') mail_folder_find($after,$target);
    if ($action==='delete') foreach ($after as $other) if ($other['id']===$id) fail('Folder deletion could not be confirmed. Refresh folders before retrying.');
    if ($action==='rename') {
        $db=db(); $db->beginTransaction();
        try {
            foreach (mail_cache_rows($a['id']) as $r) {
                $old=$r['meta']['serverFolder']??''; $delimiter=$folder['delimiter'];
                if ($old===$id || ($delimiter!=='' && str_starts_with($old,$id.$delimiter))) {
                    $path=$target.substr($old,strlen($id));
                    $r['meta']['serverFolder']=$path;
                    $r['meta']['source']=mail_source($path,$r['meta']['uidValidity'],$r['meta']['providerId']);
                    save_record($r,true);
                }
            }
            $db->commit();
        } catch (Throwable $e) { $db->rollBack(); throw $e; }
    }
    if ($action==='delete') foreach (mail_cache_rows($a['id']) as $r) if (($r['meta']['serverFolder']??null)===$id) {
        $r['meta']['recoveryFrom']=$r['meta']['folder']; $r['meta']['folder']='Recovery copies'; save_record($r,true);
    }
    return $after;
}
function manage_mail_folder(array $a,string $action,string $id,string $name): array {
    if (!in_array($action,['create','rename','delete'],true)) fail('Unknown folder action.');
    if ($action!=='delete') folder_name($name);
    if ($a['type']==='imap') $folders=with_imap_folders($a,fn($s)=>imap_manage_folder($a,$s,$action,$id,$name));
    elseif ($a['type']==='google') {
        $token=google_token($a); $base='https://gmail.googleapis.com/gmail/v1/users/me/labels';
        $before=gmail_folder_catalog(google_json($base,$token));
        if ($action!=='create' && mail_folder_find($before,$id)['protected']) fail('Standard system labels cannot be renamed or deleted.');
        if ($action==='create') google_json($base,$token,'POST',['name'=>$name,'labelListVisibility'=>'labelShow','messageListVisibility'=>'show']);
        elseif ($action==='rename') google_json($base.'/'.rawurlencode($id),$token,'PATCH',['name'=>$name]);
        else {
            web_request($base.'/'.rawurlencode($id),'DELETE',['Authorization: Bearer '.$token]);
            foreach (mail_cache_rows($a['id']) as $r) if (in_array($id,$r['meta']['labelIds']??[],true)) {
                $r['meta']['labelIds']=array_values(array_diff($r['meta']['labelIds'],[$id])); save_record($r,true);
            }
        }
        $folders=gmail_folder_catalog(google_json($base,$token));
    } else fail('Choose a mail account.');
    return mail_folder_cache($a,$folders);
}
/** A complete label membership scan, with a bounded body window and no reconciliation of unrelated messages. */
function sync_gmail_folder(array $a,string $label,int $limit,callable $request): int {
    $deadline=microtime(true)+45; $ids=[]; $seen=[]; $token='';
    do {
        mail_deadline($deadline);
        $page=$request('?'.http_build_query(['labelIds'=>$label,'maxResults'=>500,'includeSpamTrash'=>'true']+($token!==''?['pageToken'=>$token]:[])));
        if (!is_array($page['messages']??[]) || !is_string($page['nextPageToken']??'')) fail('Invalid Gmail folder response. The previous view was kept.');
        foreach ($page['messages']??[] as $message) {
            if (!is_string($message['id']??null) || !preg_match('/^[a-zA-Z0-9_-]+$/D',$message['id'])) fail('Invalid Gmail message identifier.');
            $ids[]=$message['id'];
        }
        $token=$page['nextPageToken']??'';
        if ($token!=='' && (isset($seen[$token]) || count($seen)>=100)) fail('Gmail folder pagination did not complete.');
        $seen[$token]=true;
    } while ($token!=='');
    $recent=array_slice(array_values(array_unique($ids)),0,$limit); $updates=[];
    $cached=[]; foreach (mail_cache_rows($a['id']) as $r) $cached[$r['meta']['providerId']]=$r;
    foreach (array_unique(array_merge($recent,array_keys(array_filter($cached,fn($r)=>in_array($label,$r['meta']['labelIds']??[],true) || in_array($r['meta']['providerId'],$ids,true))))) as $id) {
        mail_deadline($deadline); $full=in_array($id,$recent,true);
        $msg=$request('/'.rawurlencode((string)$id).'?format='.($full?'raw':'minimal'));
        if (!is_array($msg['labelIds']??null)) fail('Invalid Gmail message labels.');
        $meta=['providerId'=>(string)$id,'folder'=>gmail_folder($msg['labelIds'])??'Custom folder','labelIds'=>$msg['labelIds'],'read'=>!in_array('UNREAD',$msg['labelIds'],true)];
        if ($full) {
            if (!is_string($msg['raw']??null)) fail('Invalid Gmail content.');
            $raw=base64_decode(strtr($msg['raw'],'-_','+/'),true); if ($raw===false) fail('Invalid Gmail encoding.');
            if (strlen($raw)>1400000) continue;
            $r=mail_download($a,'gmail:'.$id,$raw,$meta);
            $r['id']=$cached[$id]['id']??remote_id($a['id'],'gmail:'.$id);
        } elseif (isset($cached[$id])) { $r=$cached[$id]; $r['meta']=array_merge($r['meta'],$meta); unset($r['meta']['recoveryFrom']); }
        else continue;
        $updates[]=$r;
    }
    mail_deadline($deadline); $db=db(); $db->beginTransaction();
    try { foreach ($updates as $r) save_record($r,true); $db->commit(); }
    catch (Throwable $e) { $db->rollBack(); throw $e; }
    return count($recent);
}
function sync_mail_folder(array $a,string $id,int $limit): int {
    if ($limit<10 || $limit>500 || $limit%10!==0) fail('Load between 10 and 500 messages in steps of 10.');
    mail_folder_find(setting('mail-folders:'.$a['id'],[]),$id);
    if ($a['type']==='imap') return with_imap_folders($a,fn($s)=>imap_sync_stream($a,$s,false,$id,$limit));
    if ($a['type']==='google') {
        $token=google_token($a); return sync_gmail_folder($a,$id,$limit,fn($path)=>google_json('https://gmail.googleapis.com/gmail/v1/users/me/messages'.$path,$token));
    }
    fail('Choose a mail account.');
}
function file_remote_mail(array $r,string $action,string $folder): array {
    if ($r['kind']!=='mail' || empty($r['meta']['remote']) || in_array($r['meta']['folder']??'',['Recovery copies','Not in Inbox'],true)) fail('Choose a synchronized message.');
    $a=account($r['meta']['account']);
    mail_folder_find(setting('mail-folders:'.$a['id'],[]),$folder);
    if ($a['type']==='google') {
        $token=google_token($a);
        $labels=gmail_folder_catalog(google_json('https://gmail.googleapis.com/gmail/v1/users/me/labels',$token));
        if (mail_folder_find($labels,$folder)['protected']) fail('Choose a custom label. Use the standard mail actions for Inbox and Trash.');
        $body=$action==='unlabel'?['removeLabelIds'=>[$folder]]:['addLabelIds'=>[$folder]];
        if ($action==='move') $body['removeLabelIds']=['INBOX','TRASH'];
        $msg=google_json('https://gmail.googleapis.com/gmail/v1/users/me/messages/'.rawurlencode($r['meta']['providerId']).'/modify',$token,'POST',$body);
        if (!is_array($msg['labelIds']??null) || (in_array($folder,$msg['labelIds'],true)===($action==='unlabel'))) fail('Label action could not be confirmed. Sync before retrying.');
        $r['meta']['labelIds']=$msg['labelIds']; $r['meta']['folder']=gmail_folder($msg['labelIds'])??'Custom folder'; $r['meta']['read']=!in_array('UNREAD',$msg['labelIds'],true);
    } elseif ($a['type']==='imap') {
        if ($action!=='move') fail('IMAP supports moving messages; labels are available for Gmail.');
        $path=$r['meta']['serverFolder']??null; $uid=(string)($r['meta']['providerId']??'');
        if ($path===null || !ctype_digit($uid)) fail('Repair / resync this message before moving it.');
        if ($path===$folder) return $r;
        $r=with_imap_folders($a,function($s) use($a,$r,$path,$uid,$folder) {
            $destination=mail_folder_find(imap_folder_catalog($a,$s),$folder);
            $cap=imap_command($s,'CAPABILITY');
            if (!preg_match('/\b(?:MOVE|IMAP4REV2)\b/i',implode('',$cap['lines']))) fail('This IMAP server does not support MOVE.');
            $validity=imap_validity(imap_command($s,'SELECT '.imap_quote($path)));
            if (mail_row_source($r)!==mail_source($path,$validity,$uid)) fail('Mailbox identifiers changed. Sync before moving this message.',409);
            imap_command($s,'STATUS '.imap_quote($folder).' (MESSAGES)');
            $location=imap_move_verified($s,$uid,$folder);
            $r['meta']=array_merge($r['meta'],$location,['folder'=>$destination['role']]);
            return $r;
        });
    } else fail('Choose a mail account.');
    return save_record($r,true);
}
