<?php
declare(strict_types=1);

const MAIL_FOLDERS = ['Inbox','Archive','Trash'];
function mail_cache_rows(string $account): array {
    $q=db()->prepare("SELECT * FROM records WHERE kind='mail' AND json_extract(meta,'$.remote')=1 AND json_extract(meta,'$.account')=?");
    $q->execute([$account]); return array_map('record_row',$q->fetchAll());
}
function mail_source(string $folder,string $validity,string $uid): string {
    return 'imap-folder:'.rawurlencode($folder).':'.$validity.':'.$uid;
}
function mail_row_source(array $row): string {
    $m=$row['meta']; $source=$m['source']??'';
    // Earlier releases stored Inbox UIDs even after an archive. Only trust those
    // legacy identifiers for Inbox; archived copies are matched by contents.
    if (preg_match('/^imap:(\d+):(\d+)$/D',$source,$parts) && in_array($m['folder']??'',['Inbox','Not in Inbox','Recovery copies'],true)) return mail_source('INBOX',$parts[1],$parts[2]);
    return $source;
}
function mail_deadline(float $deadline): void {
    if (microtime(true)>$deadline) fail('Mail synchronization exceeded its time budget. The previous mail view was kept. Retry Repair / resync when the connection is faster.',503);
}
function mail_download(array $a,string $source,string $raw,array $meta): array {
    $p=parse_eml($raw);
    return ['kind'=>'mail','title'=>$p['title']?:'(Untitled)','body'=>$p['body'],'meta'=>array_merge($p['meta'],$meta,['rawBase64'=>base64_encode($raw),'remote'=>true,'account'=>$a['id'],'accountLabel'=>$a['label'],'source'=>$source])];
}
/** Publish one complete account scan atomically. Downloads may be a recent window,
 * but membership is always based on complete folder identifier lists. */
function publish_mail_snapshot(array $a,array $membership,array $downloads): int {
    $db=db(); $db->beginTransaction();
    try {
        $q=$db->prepare('SELECT id FROM accounts WHERE id=?'); $q->execute([$a['id']]);
        if (!$q->fetch()) fail('Account was removed during synchronization.',409);
        $rows=mail_cache_rows($a['id']); $bySource=[]; $missing=[]; $hashes=[];
        foreach ($rows as $r) {
            $source=mail_row_source($r); $bySource[$source]=$r;
            if (!isset($membership[$source])) {
                $missing[$r['id']]=$r;
                if (isset($r['meta']['rawBase64'])) $hashes[hash('sha256',$r['meta']['rawBase64'])][]=$r['id'];
            }
        }
        $incomingHashes=[];
        foreach ($downloads as $source=>$r) if (!isset($bySource[$source])) $incomingHashes[hash('sha256',$r['meta']['rawBase64'])][]=$source;
        foreach ($downloads as $source=>$r) {
            $old=$bySource[$source]??null;
            $hash=hash('sha256',$r['meta']['rawBase64']);
            // A unique byte-identical destination proves a move. Do not merge
            // ambiguous duplicates or copies still present in the source folder.
            if (!$old && count($hashes[$hash]??[])===1 && count($incomingHashes[$hash]??[])===1) $old=$missing[$hashes[$hash][0]]??null;
            $r['id']=$old['id']??remote_id($a['id'],$source);
            save_record($r,true); unset($missing[$r['id']]);
        }
        foreach ($rows as $r) {
            $source=mail_row_source($r);
            if (isset($downloads[$source]) || !isset($membership[$source])) continue;
            $meta=array_merge($r['meta'],$membership[$source],['source'=>$source]);
            unset($meta['recoveryFrom']);
            if ($meta!==$r['meta']) { $r['meta']=$meta; save_record($r,true); }
        }
        $keep=(setting('preferences',[])['keepRecoveryCopies']??true)!==false;
        foreach ($missing as $r) {
            if ($keep) {
                if (($r['meta']['folder']??'')!=='Recovery copies') {
                    $r['meta']['recoveryFrom']=$r['meta']['folder']??'Inbox';
                    $r['meta']['folder']='Recovery copies'; save_record($r,true);
                }
            } else $db->prepare('DELETE FROM records WHERE id=?')->execute([$r['id']]);
        }
        $db->commit(); return count($downloads);
    } catch (Throwable $e) { if ($db->inTransaction()) $db->rollBack(); throw $e; }
}
function recovery_mail_action(array $r,string $action): ?array {
    if ($r['kind']!=='mail' || empty($r['meta']['remote']) || !in_array($r['meta']['folder']??'',['Recovery copies','Not in Inbox'],true)) fail('Choose a recovery copy.');
    if ($action==='discard') {
        db()->prepare('DELETE FROM records WHERE id=?')->execute([$r['id']]); return null;
    }
    if ($action!=='keep-local') fail('Unknown recovery action.');
    foreach (['remote','account','source','providerId','serverFolder','uidValidity','accountLabel','recoveryFrom'] as $field) unset($r['meta'][$field]);
    $oldId=$r['id']; $r['id']=bin2hex(random_bytes(16)); $r['meta']['folder']='Local mail';
    $db=db(); $db->beginTransaction();
    try {
        $local=save_record($r,true);
        $db->prepare('DELETE FROM records WHERE id=?')->execute([$oldId]);
        $db->commit(); return $local;
    } catch (Throwable $e) { if ($db->inTransaction()) $db->rollBack(); throw $e; }
}
/** Decode LIST once for synchronization and MOVE preflight. */
function imap_list_folders(array $list): array {
    $folders=[]; $literalIndex=0; $quoted='"(?:[^"\\\\]|\\\\.)*"';
    foreach ($list['lines'] as $line) {
        $literal=null;
        if (preg_match('/\{\d+\}\r\n$/',$line)) $literal=$list['literals'][$literalIndex++]??null;
        if (!preg_match('/^\* LIST \(([^)]*)\) (NIL|'.$quoted.') (.*)$/i',rtrim($line,"\r\n"),$m)) {
            if (preg_match('/^\* LIST\b/i',$line)) fail('The IMAP server returned an unreadable folder list. The previous mail view was kept.');
            continue;
        }
        $flags=preg_split('/\s+/',strtoupper(trim($m[1])));
        if (in_array('\\NOSELECT',$flags,true) || in_array('\\NONEXISTENT',$flags,true)) continue;
        $decode=static fn(string $v):string=>preg_replace('/\\\\(["\\\\])/','$1',substr($v,1,-1));
        $name=str_starts_with($m[3],'{')?$literal:(str_starts_with($m[3],'"')?$decode($m[3]):$m[3]);
        if (!is_string($name) || $name==='' || preg_match('/[\r\n\x00]/',$name)) fail('The IMAP server returned an invalid folder name. The previous mail view was kept.');
        $folders[$name]=['archive'=>in_array('\\ARCHIVE',$flags,true),'trash'=>in_array('\\TRASH',$flags,true),'delimiter'=>$m[2]==='NIL'?'':$decode($m[2])];
    }
    return $folders;
}
function imap_resolve_folder(array $folders,string $configured,string $role,bool $required=true): ?string {
    if (isset($folders[$configured])) $folder=$configured;
    else {
        $candidates=[]; $default=ucfirst($role);
        if ($configured===$default) {
            foreach ($folders as $name=>$info) if ($info[$role]??false) $candidates[]=(string)$name;
            if (!$candidates) foreach ($folders as $name=>$info) if ($info['delimiter']!=='' && str_ends_with((string)$name,$info['delimiter'].$default)) $candidates[]=(string)$name;
        }
        if (!$candidates && !$required && $configured===$default) return null;
        if (count($candidates)!==1) fail('IMAP '.$role.' folder was not found or is ambiguous. Enter the exact existing folder path in account setup (for example, '.$default.' or INBOX.'.$default.').');
        $folder=$candidates[0];
    }
    if (strcasecmp($folder,'INBOX')===0) fail('The IMAP '.$role.' folder must be different from Inbox.');
    return $folder;
}
function imap_validity(array $response): string {
    foreach ($response['lines'] as $line) if (preg_match('/\[UIDVALIDITY (\d+)\]/i',$line,$m) && (int)$m[1]>0) return $m[1];
    fail('IMAP server did not provide UIDVALIDITY.');
}
function imap_sync_stream(array $a,mixed $s,bool $repair=false): int {
    $deadline=microtime(true)+45;
    $cap=imap_command($s,'CAPABILITY');
    $special=(bool)preg_match('/\bSPECIAL-USE\b/i',implode('',$cap['lines']));
    $folders=imap_list_folders(imap_command($s,'LIST "" "*"'.($special?' RETURN (SPECIAL-USE)':'')));
    if (!$folders) fail('The IMAP server did not return selectable folders. The previous mail view was kept.');
    $paths=['Inbox'=>'INBOX'];
    foreach (['Archive'=>'archive','Trash'=>'trash'] as $label=>$role) {
        $path=imap_resolve_folder($folders,$a['config'][$role.'Folder']??$label,$role,false);
        if ($path!==null) $paths[$label]=$path;
    }
    if (count(array_unique($paths))!==count($paths)) fail('Inbox, Archive and Trash must use different server folders.');
    $membership=[]; $scans=[]; $downloads=[]; $cached=mail_cache_rows($a['id']);
    foreach ($paths as $label=>$path) {
        mail_deadline($deadline);
        $validity=imap_validity(imap_command($s,'EXAMINE '.imap_quote($path)));
        $ids=imap_search_ids($s,'ALL');
        $scans[$label]=['path'=>$path,'validity'=>$validity,'ids'=>$ids];
        foreach ($ids as $uid) $membership[mail_source($path,$validity,$uid)]=['folder'=>$label,'serverFolder'=>$path,'uidValidity'=>$validity,'providerId'=>$uid];
    }
    foreach ($scans as $label=>$scan) {
        mail_deadline($deadline);
        if (imap_validity(imap_command($s,'EXAMINE '.imap_quote($scan['path'])))!==$scan['validity']) fail('Mailbox identifiers changed during synchronization. Retry Repair / resync.');
        $ids=array_slice($scan['ids'],-10);
        // Refresh cached flags in bounded batches; repair also reloads bodies.
        $flagIds=[];
        foreach ($cached as $r) {
            $source=mail_row_source($r);
            if (isset($membership[$source]) && $membership[$source]['folder']===$label) {
                $uid=$membership[$source]['providerId'];
                if ($repair) $ids[]=$uid;
                else $flagIds[]=$uid;
            }
        }
        foreach (array_chunk($flagIds,100) as $chunk) {
            mail_deadline($deadline);
            $response=imap_command($s,'UID FETCH '.implode(',',$chunk).' (UID FLAGS)');
            foreach ($chunk as $uid) $membership[mail_source($scan['path'],$scan['validity'],$uid)]['read']=imap_fetch_flags($response,$uid);
        }
        // A moved message can be older than the recent download window. Locate
        // candidates by Message-ID, but only accept byte-identical message bodies.
        foreach ($cached as $r) if (!isset($membership[mail_row_source($r)]) && ($repair || ($r['meta']['folder']??'')!=='Recovery copies')) {
            $raw=isset($r['meta']['rawBase64'])?base64_decode($r['meta']['rawBase64'],true):false;
            if (!$raw || !preg_match('/^Message-ID:\s*(<[^\r\n<>]+>)/im',$raw,$m)) continue;
            mail_deadline($deadline);
            $candidates=imap_search_ids($s,'HEADER Message-ID '.imap_quote($m[1]));
            if (count($candidates)>10) fail('Too many matching messages to reconcile safely. The previous mail view was kept.');
            foreach ($candidates as $uid) if (in_array($uid,$scan['ids'],true)) $ids[]=$uid;
        }
        foreach (array_unique($ids) as $uid) {
            mail_deadline($deadline);
            $response=imap_command($s,'UID FETCH '.$uid.' (UID FLAGS BODY.PEEK[])');
            $raw=imap_fetch_content($response,$uid);
            if ($raw===null) fail('A message changed during synchronization. The previous mail view was kept; retry sync.');
            $source=mail_source($scan['path'],$scan['validity'],$uid);
            $meta=$membership[$source]; $meta['read']=imap_fetch_flags($response,$uid);
            $downloads[$source]=mail_download($a,$source,$raw,$meta);
        }
    }
    mail_deadline($deadline);
    return publish_mail_snapshot($a,$membership,$downloads);
}
function imap_fetch_flags(array $response,string $uid): bool {
    // FLAGS and UID belong to the same FETCH tuple, including UID-after-body.
    $text=implode('',$response['lines']);
    foreach (preg_split('/(?=^\* \d+ FETCH)/mi',$text) as $tuple) if (preg_match('/\bUID\s+'.preg_quote($uid,'/').'(?=\s|\))/i',$tuple) && preg_match('/\bFLAGS\s*\(([^)]*)\)/i',$tuple,$m)) return in_array('\\SEEN',preg_split('/\s+/',strtoupper(trim($m[1]))),true);
    fail('The IMAP server did not return message flags. The previous mail view was kept.');
}
function gmail_folder(array $labels): ?string {
    if (in_array('TRASH',$labels,true)) return 'Trash';
    if (in_array('INBOX',$labels,true)) return 'Inbox';
    if (array_intersect(['SPAM','DRAFT'],$labels)) return null;
    return 'Archive';
}
/** Callable transport makes pagination and failure behavior testable without accounts. */
function sync_google_mail(array $a,callable $request,bool $repair=false): int {
    $deadline=microtime(true)+45; $membership=[]; $recent=[];
    foreach (['Inbox'=>'in:inbox','Archive'=>'-in:inbox -in:trash -in:spam -in:drafts','Trash'=>'in:trash'] as $folder=>$query) {
        $pageToken=''; $seen=[]; $ids=[];
        do {
            mail_deadline($deadline);
            $params=['maxResults'=>500,'q'=>$query,'includeSpamTrash'=>'true'];
            if ($pageToken!=='') $params['pageToken']=$pageToken;
            $page=$request('?'.http_build_query($params));
            if (!is_array($page['messages']??[]) || !is_string($page['nextPageToken']??'')) fail('Invalid Gmail message list. The previous mail view was kept.');
            foreach ($page['messages']??[] as $m) {
                if (!is_string($m['id']??null) || !preg_match('/^[a-zA-Z0-9_-]+$/D',$m['id'])) fail('Invalid Gmail message identifier.');
                $ids[]=$m['id']; $membership['gmail:'.$m['id']]=['folder'=>$folder,'providerId'=>$m['id']];
            }
            $pageToken=$page['nextPageToken']??'';
            if ($pageToken!=='' && (isset($seen[$pageToken]) || count($seen)>=100)) fail('Gmail pagination did not complete. The previous mail view was kept.');
            $seen[$pageToken]=true;
        } while ($pageToken!=='');
        $recent=array_merge($recent,array_slice($ids,0,10));
    }
    $downloads=[];
    foreach (mail_cache_rows($a['id']) as $r) {
        $source=$r['meta']['source']??'';
        if (!isset($membership[$source])) continue;
        mail_deadline($deadline);
        if ($repair) $recent[]=$membership[$source]['providerId'];
        else {
            $msg=$request('/'.rawurlencode($membership[$source]['providerId']).'?format=minimal');
            if (!is_array($msg['labelIds']??null)) fail('Invalid Gmail message labels. The previous mail view was kept.');
            $folder=gmail_folder($msg['labelIds']);
            if ($folder===null) unset($membership[$source]);
            else $membership[$source]=['folder'=>$folder,'providerId'=>$membership[$source]['providerId'],'read'=>!in_array('UNREAD',$msg['labelIds'],true)];
        }
    }
    foreach (array_unique($recent) as $id) {
        mail_deadline($deadline); $msg=$request('/'.rawurlencode($id).'?format=raw');
        if (!is_string($msg['raw']??null) || !is_array($msg['labelIds']??null)) fail('Invalid Gmail message content. The previous mail view was kept.');
        $raw=base64_decode(strtr($msg['raw'],'-_','+/'),true);
        if ($raw===false) fail('Invalid Gmail message encoding.');
        if (strlen($raw)>1400000) continue;
        $folder=gmail_folder($msg['labelIds']); $source='gmail:'.$id;
        if ($folder===null) { unset($membership[$source]); continue; }
        $meta=['folder'=>$folder,'providerId'=>$id,'read'=>!in_array('UNREAD',$msg['labelIds'],true)];
        $membership[$source]=$meta; $downloads[$source]=mail_download($a,$source,$raw,$meta);
    }
    mail_deadline($deadline);
    return publish_mail_snapshot($a,$membership,$downloads);
}
