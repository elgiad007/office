<?php
declare(strict_types=1);

require_once __DIR__.'/mail-junk.php';
require_once __DIR__.'/mail-rules.php';

const MAIL_FOLDERS = ['Inbox','Archive','Trash','Junk'];
const IMAP_BODY_LIMIT = 1400000;
const IMAP_HEADER_SECTION = 'HEADER.FIELDS (SUBJECT FROM TO DATE MESSAGE-ID X-SPAM-FLAG X-SPAM-STATUS)';
const MAIL_SYNC_BATCH = 100;
const IMAP_HEADER_BATCH = 25;
const IMAP_FLAG_BATCH = 1000;
function mail_offline_download(): bool { return (setting('preferences',[])['mailOffline']??false)===true; }
function mail_pending(array $a,string $scope,bool $pending): void {
    $scopes=setting('mail-pending:'.$a['id'],[]); $scopes[$scope]=$pending;
    set_setting('mail-pending:'.$a['id'],$scopes);
}
function gmail_header_download(array $a,string $id,array $msg,array $meta): array {
    if (!is_array($msg['payload']['headers']??null)) fail('Invalid Gmail message headers.');
    $headers='';
    foreach ($msg['payload']['headers'] as $h) {
        if (!is_string($h['name']??null) || !is_string($h['value']??null)) fail('Invalid Gmail header.');
        if (in_array(strtolower($h['name']),['subject','from','to','date','message-id','x-spam-flag','x-spam-status'],true)) $headers.=$h['name'].': '.str_replace(["\r","\n"],' ',$h['value'])."\r\n";
    }
    $meta['junkArrival']=gmail_junk_arrival($msg);
    return imap_header_download($a,'gmail:'.$id,$headers."\r\n",$meta,(int)($msg['sizeEstimate']??0));
}
function imap_download_sizes(mixed $s,array $ids): array {
    $sizes=[];
    foreach(array_chunk($ids,100) as $chunk){
        $response=imap_command($s,'UID FETCH '.implode(',',$chunk).' (UID RFC822.SIZE)');
        $tuples=imap_fetch_responses($response);
        foreach($chunk as $uid){
            if(preg_match('/\bRFC822\.SIZE\s+(\d+)\b/i',implode('',$tuples[$uid]['lines']??[]),$m))$sizes[$uid]=(int)$m[1];
            if(!isset($sizes[$uid]))fail('The server did not return a message size. The previous mail view was kept; retry sync.');
        }
    }
    return $sizes;
}
/** Compact only exact UIDs: gaps must never expand the requested set. */
function imap_uid_set(array $ids): string {
    $ids=array_values(array_unique(array_map('intval',$ids)));sort($ids,SORT_NUMERIC);
    $ranges=[];$start=null;$end=null;
    foreach($ids as $id){
        if($end!==null && $id===$end+1){$end=$id;continue;}
        if($start!==null)$ranges[]=$start===$end?(string)$start:$start.':'.$end;
        $start=$end=$id;
    }
    if($start!==null)$ranges[]=$start===$end?(string)$start:$start.':'.$end;
    return implode(',',$ranges);
}
function imap_flag_batches(array $ids): array {
    $batches=[];
    foreach(array_chunk($ids,IMAP_FLAG_BATCH) as $chunk){
        // Sparse ten-digit UIDs may not compress. Keep command lines below the
        // usual 8 KB server limit as well as bounding response and parsing work.
        foreach(array_chunk($chunk,strlen(imap_uid_set($chunk))>6000?500:IMAP_FLAG_BATCH) as $bounded)$batches[]=$bounded;
    }
    return $batches;
}
function imap_header_download(array $a,string $source,string $headers,array $meta,int $size): array {
    $parsed=parse_eml($headers);
    if ($reason=mail_junk_reason($headers)) $parsed['meta']['junkReason']=$reason;
    unset($parsed['meta']['hasAttachments']); // Headers alone cannot establish attachment presence.
    return ['kind'=>'mail','title'=>$parsed['title']?:'(Untitled)','body'=>'','meta'=>array_merge($parsed['meta'],$meta,[
        'headerOnly'=>true,'messageSize'=>$size,'headersBase64'=>base64_encode($headers),'remote'=>true,
        'account'=>$a['id'],'accountLabel'=>$a['label'],'source'=>$source])];
}
function mail_cache_rows(string $account,bool $hydrate=true): array {
    $q=db()->prepare("SELECT * FROM records WHERE kind='mail' AND json_extract(meta,'$.remote')=1 AND json_extract(meta,'$.account')=?");
    $q->execute([$account]);
    // Sync needs stored state, not reader hashes, MIME parsing or attachment queries.
    return array_map($hydrate?'record_row':static function(array $row):array {
        $row['meta']=json_decode($row['meta'],true,64,JSON_THROW_ON_ERROR);
        return $row;
    },$q->fetchAll());
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
    if ($reason=mail_junk_reason($raw)) $p['meta']['junkReason']=$reason;
    return ['kind'=>'mail','title'=>$p['title']?:'(Untitled)','body'=>$p['body'],'meta'=>array_merge($p['meta'],$meta,['rawBase64'=>base64_encode($raw),'remote'=>true,'account'=>$a['id'],'accountLabel'=>$a['label'],'source'=>$source])];
}
/** Publish one complete account scan atomically. Downloads may be a recent window,
 * but membership is always based on complete folder identifier lists. */
function publish_mail_snapshot(array $a,array $membership,array $downloads,?callable $scope=null): int {
    return mail_sync_publish_guard($a['id'],fn()=>publish_mail_snapshot_unlocked($a,$membership,$downloads,$scope));
}
function publish_mail_snapshot_unlocked(array $a,array $membership,array $downloads,?callable $scope=null): int {
    $db=db(); $db->beginTransaction();
    try {
        $q=$db->prepare('SELECT id FROM accounts WHERE id=?'); $q->execute([$a['id']]);
        if (!$q->fetch()) fail('Account was removed during synchronization.',409);
        $rows=mail_cache_rows($a['id'],false);
        if ($scope!==null) $rows=array_values(array_filter($rows,$scope));
        $bySource=[]; $missing=[]; $hashes=[];
        foreach ($rows as $r) {
            $source=mail_row_source($r); $bySource[$source]=$r;
            if (!isset($membership[$source])) {
                $missing[$r['id']]=$r;
                if (isset($r['meta']['rawBase64'])) $hashes[hash('sha256',$r['meta']['rawBase64'])][]=$r['id'];
            }
        }
        $rules=$downloads?mail_block_rules($a['id']):[];
        $routing=$downloads?mail_rules_config():['rules'=>[]];
        $incomingHashes=[];
        foreach ($downloads as $source=>$r) if (!isset($bySource[$source]) && isset($r['meta']['rawBase64'])) $incomingHashes[hash('sha256',$r['meta']['rawBase64'])][]=$source;
        foreach ($downloads as $source=>$r) {
            $old=$bySource[$source]??null;
            $hash=isset($r['meta']['rawBase64'])?hash('sha256',$r['meta']['rawBase64']):null;
            // A unique byte-identical destination proves a move. Do not merge
            // ambiguous duplicates or copies still present in the source folder.
            if (!$old && $hash!==null && count($hashes[$hash]??[])===1 && count($incomingHashes[$hash]??[])===1) $old=$missing[$hashes[$hash][0]]??null;
            $r['id']=$old['id']??remote_id($a['id'],$source);
            if($old){
                unset($old['meta']['attachments']);
                // An unchanged remote message retains discovered part metadata and cached text.
                if(mail_row_source($old)===$source){
                    if(isset($old['meta']['mimeParts']))$r['meta']['mimeParts']=$old['meta']['mimeParts'];
                    if(isset($old['meta']['bodyRawBase64']) && !empty($r['meta']['headerOnly'])){$r['meta']['bodyRawBase64']=$old['meta']['bodyRawBase64'];$r['body']=$old['body'];$r['meta']['hasHtml']=$old['meta']['hasHtml'];unset($r['meta']['headerOnly']);}
                    if(isset($old['meta']['mimeParts']))$r['meta']['hasAttachments']=$old['meta']['hasAttachments'];
                }
            }
            mail_rule_sync_meta($r,$old['meta']??null,$routing);
            mail_junk_sync_meta($r['meta'],$old['meta']??null,$rules);
            validate_record($r);
            // Re-downloading unchanged mail must not invalidate an open reader.
            if (!$old || $old['kind']!==$r['kind'] || $old['title']!==$r['title'] || $old['body']!==$r['body'] || $old['meta']!==$r['meta']) save_record($r,true,false);
            unset($missing[$r['id']]);
        }
        foreach ($rows as $r) {
            $source=mail_row_source($r);
            if (isset($downloads[$source]) || !isset($membership[$source])) continue;
            $meta=array_merge($r['meta'],$membership[$source],['source'=>$source]);
            unset($meta['recoveryFrom']);
            if ($meta['folder']!=='Inbox') unset($meta['junkPending'],$meta['junkAttempted'],$meta['rulePending'],$meta['ruleAttempted']);
            if ($meta!==$r['meta']) { $r['meta']=$meta; save_record($r,true,false); }
        }
        $keep=(setting('preferences',[])['keepRecoveryCopies']??true)!==false;
        foreach ($missing as $r) {
            if ($keep) {
                if (($r['meta']['folder']??'')!=='Recovery copies') {
                    $r['meta']['recoveryFrom']=$r['meta']['folder']??'Inbox';
                    $r['meta']['folder']='Recovery copies'; save_record($r,true,false);
                }
            } else $db->prepare('DELETE FROM records WHERE id=?')->execute([$r['id']]);
        }
        $db->commit(); return count($downloads);
    } catch (Throwable $e) { if ($db->inTransaction()) $db->rollBack(); throw $e; }
}
function recovery_mail_action(array $r,string $action,?string $hubTitle=null): ?array {
    if ($r['kind']!=='mail' || empty($r['meta']['remote']) || !in_array($r['meta']['folder']??'',['Recovery copies','Not in Inbox'],true)) fail('Choose a recovery copy.');
    if ($action==='discard') {
        delete_connected_record($r,$hubTitle); return null;
    }
    if ($action!=='keep-local') fail('Unknown recovery action.');
    foreach (['remote','account','source','providerId','serverFolder','uidValidity','accountLabel','recoveryFrom'] as $field) unset($r['meta'][$field]);
    $oldId=$r['id']; $r['id']=bin2hex(random_bytes(16)); $r['meta']['folder']='Local mail';
    $db=db(); $db->beginTransaction();
    try {
        $local=save_record($r,true);
        attachment_copy($oldId,$local['id']);
        connection_retarget($oldId,$local['id']);
        $db->prepare('DELETE FROM records WHERE id=?')->execute([$oldId]);
        $db->commit(); return get_record($local['id']);
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
        $folders[$name]=['archive'=>in_array('\\ARCHIVE',$flags,true),'all'=>in_array('\\ALL',$flags,true),'trash'=>in_array('\\TRASH',$flags,true),'junk'=>in_array('\\JUNK',$flags,true),'protected'=>(bool)array_intersect($flags,['\\ARCHIVE','\\TRASH','\\SENT','\\DRAFTS','\\JUNK','\\ALL','\\IMPORTANT','\\FLAGGED']),'delimiter'=>$m[2]==='NIL'?'':$decode($m[2])];
    }
    return $folders;
}
function imap_resolve_folder(array $folders,string $configured,string $role,bool $required=true,bool $gmail=false): ?string {
    // Gmail permits user labels called Trash/Archive. Defaults mean system roles,
    // never those labels. Explicit non-default paths still resolve exactly.
    if ($gmail && $configured===ucfirst($role)) {
        $candidates=[];
        foreach ($folders as $name=>$info) if ($info[$role]??false) $candidates[]=(string)$name;
        if (!$candidates && $role==='archive') foreach ($folders as $name=>$info) if ($info['all']??false) $candidates[]=(string)$name;
        if (count($candidates)!==1) fail('Gmail '.$role.' system folder was not found or is ambiguous. Refresh folders and check Gmail IMAP access.');
        if (strcasecmp($candidates[0],'INBOX')===0) fail('The IMAP '.$role.' folder must be different from Inbox.');
        return $candidates[0];
    }
    if (isset($folders[$configured])) $folder=$configured;
    else {
        $candidates=[]; $default=ucfirst($role);
        if ($configured===$default) {
            foreach ($folders as $name=>$info) if ($info[$role]??false) $candidates[]=(string)$name;
            // Gmail designates All Mail as \\All rather than \\Archive, in any language.
            if (!$candidates && $role==='archive') foreach ($folders as $name=>$info) if ($info['all']??false) $candidates[]=(string)$name;
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
function imap_modseq(array $response): ?string {
    foreach($response['lines'] as $line)if(preg_match('/\[HIGHESTMODSEQ ([1-9][0-9]*)\]/i',$line,$m))return $m[1];
    return null;
}
function imap_response_has_uid(array $response,string $uid): bool {
    return (bool)preg_match('/\bUID\s+'.preg_quote($uid,'/').'(?=\s|\))/i',implode('',$response['lines']));
}
function imap_sync_stream(array $a,mixed $s,bool $repair=false,?string $onlyPath=null,int $limit=MAIL_SYNC_BATCH): int {
    $started=microtime(true);$deadline=$started+45;
    $offline=mail_offline_download();
    $cap=imap_command($s,'CAPABILITY');
    $gmail=(bool)preg_match('/\bX-GM-EXT-1\b/i',implode('',$cap['lines']));
    $special=(bool)preg_match('/\bSPECIAL-USE\b/i',implode('',$cap['lines']));
    $condstore=(bool)preg_match('/\bCONDSTORE\b/i',implode('',$cap['lines']));
    $checkpoints=setting('imap-checkpoints:'.$a['id'],[]);
    $repairs=setting('imap-repair:'.$a['id'],[]);
    $folders=imap_list_folders(imap_command($s,'LIST "" "*"'.($special?' RETURN (SPECIAL-USE)':'')));
    if (!$folders) fail('The IMAP server did not return selectable folders. The previous mail view was kept.');
    $paths=['Inbox'=>'INBOX'];
    foreach (['Archive'=>'archive','Trash'=>'trash'] as $label=>$role) {
        $path=imap_resolve_folder($folders,$a['config'][$role.'Folder']??$label,$role,false,$gmail);
        if ($path!==null) $paths[$label]=$path;
    }
    if (count(array_unique($paths))!==count($paths)) fail('Inbox, Archive and Trash must use different server folders.');
    $junk=imap_junk_path($a,$folders);
    if ($junk!==null && !in_array($junk,$paths,true)) $paths['Junk']=$junk;
    $arrivalField=mail_block_rules($a['id']) || mail_rules_for_account(mail_rules_config(),$a['id'])?' INTERNALDATE':'';
    if ($onlyPath!==null) {
        if (!isset($folders[$onlyPath])) fail('Folder no longer exists. Refresh the folder list.',409);
        $label=array_search($onlyPath,$paths,true);
        $paths=[$label===false?'Custom folder':$label=>$onlyPath];
    }
    $scope=$onlyPath!==null
        ? static fn($r)=>($r['meta']['serverFolder']??null)===$onlyPath
        : static fn($r)=>in_array($r['meta']['folder']??'',MAIL_FOLDERS,true) || (in_array($r['meta']['folder']??'',['Recovery copies','Not in Inbox'],true) && in_array($r['meta']['recoveryFrom']??'Inbox',MAIL_FOLDERS,true));
    $cacheStarted=microtime(true);
    $membership=[]; $scans=[]; $downloads=[]; $cached=array_values(array_filter(mail_cache_rows($a['id'],false),$scope));
    activity_step('IMAP: cache prepared.','success',(int)round((microtime(true)-$cacheStarted)*1000));
    $cachedSources=[];
    foreach ($cached as $row) $cachedSources[mail_row_source($row)]=true;
    foreach ($paths as $label=>$path) {
        if(function_exists('activity_step'))activity_step('IMAP: refreshing folder '.$path.'.');
        mail_deadline($deadline);
        $selected=imap_command($s,'EXAMINE '.imap_quote($path).($condstore?' (CONDSTORE)':''));
        $validity=imap_validity($selected);
        $ids=imap_search_ids($s,'ALL');
        $scans[$label]=['path'=>$path,'validity'=>$validity,'ids'=>$ids,'modseq'=>imap_modseq($selected)];
        foreach ($ids as $uid) $membership[mail_source($path,$validity,$uid)]=['folder'=>$label,'serverFolder'=>$path,'uidValidity'=>$validity,'providerId'=>$uid];
    }
    foreach ($scans as $label=>$scan) {
        if(microtime(true)>$deadline-10){$scans[$label]['pending']=true;continue;}
        mail_deadline($deadline);
        if (imap_validity(imap_command($s,'EXAMINE '.imap_quote($scan['path'])))!==$scan['validity']) fail('Mailbox identifiers changed during synchronization. Retry Repair / resync.');
        // Cache membership is the durable cursor: newest unknown messages first,
        // then older history on subsequent passes. No arrival window can skip mail.
        $unknown=array_values(array_filter(array_reverse($scan['ids']),
            static fn($uid)=>!isset($cachedSources[mail_source($scan['path'],$scan['validity'],$uid)])));
        $folderName=function_exists('imap_folder_decode')?imap_folder_decode($scan['path']):$scan['path'];
        activity_sync_progress('Checking mail · '.$folderName.' · '.(count($scan['ids'])-count($unknown)).' of '.count($scan['ids']).' messages cached.');
        $ids=array_reverse(array_slice($unknown,0,$limit));$reconcileIds=[];
        // Refresh cached flags in bounded batches; repair also reloads bodies.
        $flagIds=[];
        $checkpoint=$checkpoints[$scan['path']]??null;
        $changedSince=!$repair && $scan['modseq']!==null && ($checkpoint['validity']??null)===$scan['validity'] && preg_match('/^[1-9][0-9]*$/D',(string)($checkpoint['modseq']??''))
            && (strlen($checkpoint['modseq'])<strlen($scan['modseq']) || (strlen($checkpoint['modseq'])===strlen($scan['modseq']) && strcmp($checkpoint['modseq'],$scan['modseq'])<=0)) ? $checkpoint['modseq']:null;
        foreach ($cached as $r) {
            $source=mail_row_source($r);
            if (isset($membership[$source]) && $membership[$source]['folder']===$label) {
                $uid=$membership[$source]['providerId'];
                if ($repair || ($offline && !empty($r['meta']['headerOnly']) && ($r['meta']['messageSize']??0)<=IMAP_BODY_LIMIT)) $ids[]=$uid;
                else {
                    $flagIds[]=$uid;
                    if($changedSince!==null){
                        $membership[$source]['read']=$r['meta']['read']??false;
                        if(isset($r['meta']['gmailMessageId']))$membership[$source]['gmailMessageId']=$r['meta']['gmailMessageId'];
                    }
                }
            }
        }
        $repairIds=($repairs[$scan['path']]['validity']??null)===$scan['validity']?($repairs[$scan['path']]['ids']??[]):[];
        if($repair)$repairIds=$ids;
        $repairIds=array_values(array_intersect($repairIds,$scan['ids']));
        $ids=array_merge($ids,$repairIds);
        // A moved message can be older than the recent download window. Locate
        // candidates by Message-ID, but only accept byte-identical message bodies.
        foreach ($cached as $r) if (!isset($membership[mail_row_source($r)]) && ($repair || ($r['meta']['folder']??'')!=='Recovery copies')) {
            $raw=isset($r['meta']['rawBase64'])?base64_decode($r['meta']['rawBase64'],true):false;
            if (!$raw || !preg_match('/^Message-ID:\s*(<[^\r\n<>]+>)/im',$raw,$m)) continue;
            mail_deadline($deadline);
            $candidates=imap_search_ids($s,'HEADER Message-ID '.imap_quote($m[1]));
            if (count($candidates)>10) fail('Too many matching messages to reconcile safely. The previous mail view was kept.');
            foreach ($candidates as $uid) if (in_array($uid,$scan['ids'],true)) { $ids[]=$uid;$reconcileIds[$uid]=true; }
        }
        $ids=array_values(array_unique($ids));
        $pending=count($ids)>$limit || count($unknown)>$limit;
        $ids=array_map('strval',array_values(array_unique(array_merge(array_slice($ids,0,$limit),array_keys($reconcileIds)))));
        $headerIds=array_values(array_filter($ids,static fn($uid)=>!$offline && !$repair && !in_array($uid,$repairIds,true) && !isset($reconcileIds[$uid])));
        // Larger continuation windows apply to cheap headers. Keep resumable body
        // repairs at their existing bound, plus any required move reconciliation.
        $bodyIds=array_values(array_diff($ids,$headerIds));
        $deferred=array_slice(array_values(array_filter($bodyIds,static fn($uid)=>!isset($reconcileIds[$uid]))),MAIL_SYNC_BATCH);
        if($deferred){$ids=array_values(array_diff($ids,$deferred));$bodyIds=array_values(array_diff($bodyIds,$deferred));$pending=true;}
        $headerChunks=[];
        foreach(array_chunk($headerIds,IMAP_HEADER_BATCH) as $chunk)foreach($chunk as $uid)$headerChunks[$uid]=$chunk;
        $headerResponses=[];
        // Header requests carry sizes too; body downloads still preflight their size.
        $sizes=imap_download_sizes($s,$bodyIds);
        $batchPosition=0;$remaining=count($unknown);$older=count($unknown)>$limit;$oldestUnknown=$unknown?(int)min($unknown):0;
        if(!$older && $unknown){foreach($cached as $row)if(($row['meta']['serverFolder']??null)===$scan['path'] && (int)($row['meta']['providerId']??0)>$oldestUnknown){$older=true;break;}}
        foreach ($ids as $uid) {
            if (microtime(true)>$deadline-10) { $pending=true; break; }
            $batchPosition++;
            if(($batchPosition-1)%IMAP_HEADER_BATCH===0 || $batchPosition===count($ids))activity_sync_progress(($older?'Downloading older mail':'Downloading mail').' · '.$folderName.' · batch message '.$batchPosition.' of '.count($ids).' · '.$remaining.' messages still to cache.');
            if(in_array($uid,$unknown,true))$remaining--;
            $source=mail_source($scan['path'],$scan['validity'],$uid);
            if(isset($headerChunks[$uid]) || $sizes[$uid]>IMAP_BODY_LIMIT){
                if(isset($headerChunks[$uid])){
                    if(!isset($headerResponses[$uid])){
                        $chunk=$headerChunks[$uid];
                        $response=imap_command($s,'UID FETCH '.implode(',',$chunk).' (UID FLAGS RFC822.SIZE'.$arrivalField.($gmail?' X-GM-MSGID':'').' BODY.PEEK['.IMAP_HEADER_SECTION.']<0.32768>)',32768);
                        $headerResponses=imap_fetch_responses($response);
                        // Validate the whole batch before accepting any of its headers.
                        foreach($chunk as $requested){
                            if(!isset($headerResponses[$requested]) || !preg_match('/\bRFC822\.SIZE\s+(\d+)\b/i',implode('',$headerResponses[$requested]['lines']),$sizeMatch))fail('The server did not return a message size. The previous mail view was kept; retry sync.');
                            $sizes[$requested]=(int)$sizeMatch[1];
                            if(imap_fetch_content($headerResponses[$requested],(string)$requested,IMAP_HEADER_SECTION)===null)fail('Message headers changed during synchronization. The previous mail view was kept; retry sync.');
                        }
                    }
                    $response=$headerResponses[$uid];
                }else $response=imap_command($s,'UID FETCH '.$uid.' (UID FLAGS'.$arrivalField.($gmail?' X-GM-MSGID':'').' BODY.PEEK['.IMAP_HEADER_SECTION.']<0.32768>)',32768);
                $headers=imap_fetch_content($response,(string)$uid,IMAP_HEADER_SECTION);
                if($headers===null)fail('Message headers changed during synchronization. The previous mail view was kept; retry sync.');
                $meta=$membership[$source];$meta['read']=imap_fetch_flags($response,(string)$uid);
                $meta['junkArrival']=imap_junk_arrival($response);
                if($gmail)$meta['gmailMessageId']=imap_gmail_message_id($response,(string)$uid);
                $downloads[$source]=imap_header_download($a,$source,$headers,$meta,$sizes[$uid]);
                $repairIds=array_values(array_diff($repairIds,[$uid]));
                if($sizes[$uid]>IMAP_BODY_LIMIT && function_exists('activity_step'))activity_step('IMAP: retained headers for an oversized message.','warning');
                continue;
            }
            $response=imap_command($s,'UID FETCH '.$uid.' (UID FLAGS'.$arrivalField.($gmail?' X-GM-MSGID':'').' BODY.PEEK[])');
            $raw=imap_fetch_content($response,$uid);
            if ($raw===null) fail('A message changed during synchronization. The previous mail view was kept; retry sync.');
            $source=mail_source($scan['path'],$scan['validity'],$uid);
            $meta=$membership[$source]; $meta['read']=imap_fetch_flags($response,$uid);$meta['messageSize']=$sizes[$uid];
            $meta['junkArrival']=imap_junk_arrival($response);
            if ($gmail) $meta['gmailMessageId']=imap_gmail_message_id($response,$uid);
            $downloads[$source]=mail_download($a,$source,$raw,$meta);
            $repairIds=array_values(array_diff($repairIds,[$uid]));
        }
        // Expose validated new Inbox headers while other folders are still being
        // processed. Restrict publication to these sources: never reconcile absent
        // mail or merge moved originals until the complete account snapshot is ready.
        if($label==='Inbox'){
            $arrivals=array_filter($downloads,static fn($r,$source)=>!isset($cachedSources[$source]) && !empty($r['meta']['headerOnly']) && ($r['meta']['folder']??'')==='Inbox',ARRAY_FILTER_USE_BOTH);
            if($arrivals){
                publish_mail_snapshot($a,$membership,$arrivals,static fn($r)=>isset($arrivals[mail_row_source($r)]));
                if(isset($GLOBALS['office_activity']))activity_event('Inbox ready · '.count($arrivals).' new messages cached.','info','mail-cache-ready',(int)round((microtime(true)-($GLOBALS['office_activity']['started']??$started))*1000));
            }
        }
        // Download arrivals before spending round trips on already cached mail.
        $scans[$label]['flagsComplete']=true;
        foreach (imap_flag_batches($flagIds) as $chunk) {
            if(microtime(true)>$deadline-5){$pending=true;$scans[$label]['flagsComplete']=false;break;}
            mail_deadline($deadline);
            // An equal watermark proves cached flags unchanged at the scan boundary.
            if($changedSince!==null && $changedSince===$scan['modseq'])continue;
            $response=imap_command($s,'UID FETCH '.imap_uid_set($chunk).' (UID FLAGS'.($gmail?' X-GM-MSGID':'').')'.($changedSince!==null?' (CHANGEDSINCE '.$changedSince.')':''));
            $tuples=imap_fetch_responses($response);
            foreach ($chunk as $uid) {
                if($changedSince!==null && !isset($tuples[$uid]))continue;
                $source=mail_source($scan['path'],$scan['validity'],$uid);
                $membership[$source]['read']=imap_fetch_flags($tuples[$uid]??['lines'=>[]],$uid);
                if ($gmail) $membership[$source]['gmailMessageId']=imap_gmail_message_id($tuples[$uid],$uid);
            }
        }
        $repairs[$scan['path']]=['validity'=>$scan['validity'],'ids'=>$repairIds];
        $scans[$label]['pending']=$pending || (bool)$repairIds;
    }
    mail_deadline($deadline);
    $publishStarted=microtime(true);
    $count=publish_mail_snapshot($a,$membership,$downloads,$scope);
    activity_step('IMAP: cache published.','success',(int)round((microtime(true)-$publishStarted)*1000));
    set_setting('imap-repair:'.$a['id'],$repairs);
    foreach($scans as $scan) mail_pending($a,$scan['path'],$scan['pending']??false);
    if($onlyPath===null)mail_pending($a,'standard',(bool)array_filter($scans,fn($scan)=>$scan['pending']??false));
    // Advance only after publishing a complete scan. Use the first SELECT's
    // watermark so changes arriving during the scan are fetched next time.
    foreach($scans as $scan){
        if(empty($scan['flagsComplete']))continue;
        if($scan['modseq']!==null)$checkpoints[$scan['path']]=['validity'=>$scan['validity'],'modseq'=>$scan['modseq']];
        else unset($checkpoints[$scan['path']]);
    }
    set_setting('imap-checkpoints:'.$a['id'],$checkpoints);
    return $count;
}
function imap_fetch_flags(array $response,string $uid): bool {
    // FLAGS and UID belong to the same FETCH tuple, including UID-after-body.
    $text=implode('',$response['lines']);
    foreach (preg_split('/(?=^\* \d+ FETCH)/mi',$text) as $tuple) if (preg_match('/\bUID\s+'.preg_quote($uid,'/').'(?=\s|\))/i',$tuple) && preg_match('/\bFLAGS\s*\(([^)]*)\)/i',$tuple,$m)) return in_array('\\SEEN',preg_split('/\s+/',strtoupper(trim($m[1]))),true);
    fail('The IMAP server did not return message flags. The previous mail view was kept.');
}
function gmail_folder(array $labels): ?string {
    if (in_array('TRASH',$labels,true)) return 'Trash';
    if (in_array('SPAM',$labels,true)) return 'Junk';
    if (in_array('INBOX',$labels,true)) return 'Inbox';
    if (in_array('DRAFT',$labels,true)) return null;
    return 'Archive';
}
/** Callable transport makes pagination and failure behavior testable without accounts. */
function sync_google_mail(array $a,callable $request,bool $repair=false): int {
    $deadline=microtime(true)+45; $membership=[]; $recent=[]; $pending=false;$unknownCounts=[];$olderFolders=[];
    $known=[]; foreach(mail_cache_rows($a['id']) as $row)$known[mail_row_source($row)]=$row;
    $repairIds=$repair?array_map(fn($r)=>(string)$r['meta']['providerId'],array_values($known)):setting('gmail-repair:'.$a['id'],[]);
    foreach (['Inbox'=>'in:inbox','Archive'=>'-in:inbox -in:trash -in:spam -in:drafts','Trash'=>'in:trash','Junk'=>'in:spam'] as $folder=>$query) {
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
        $unknown=array_values(array_filter($ids,fn($id)=>!isset($known['gmail:'.$id])));
        $unknownCounts[$folder]=count($unknown);$olderFolders[$folder]=count($unknown)>MAIL_SYNC_BATCH;
        $seenCached=false;foreach($ids as $id){if(isset($known['gmail:'.$id]))$seenCached=true;elseif($seenCached)$olderFolders[$folder]=true;}
        activity_sync_progress('Checking mail · '.$folder.' · '.(count($ids)-count($unknown)).' of '.count($ids).' messages cached.');
        $pending=$pending || count($unknown)>MAIL_SYNC_BATCH;
        $recent=array_merge($recent,array_slice($unknown,0,MAIL_SYNC_BATCH));
    }
    $downloads=[];
    $cache=mail_cache_rows($a['id']);
    $cursor=(int)setting('gmail-flags-cursor:'.$a['id'],0);$flagReads=0;$nextCursor=$cursor;
    if($cache){$cursor=$cursor%count($cache);$cache=array_merge(array_slice($cache,$cursor),array_slice($cache,0,$cursor));}
    foreach ($cache as $r) {
        $source=$r['meta']['source']??'';
        if (!isset($membership[$source])) continue;
        mail_deadline($deadline);
        if ($repair || (mail_offline_download() && !empty($r['meta']['headerOnly']) && ($r['meta']['messageSize']??0)<=IMAP_BODY_LIMIT)) $recent[]=$membership[$source]['providerId'];
        elseif($flagReads<MAIL_SYNC_BATCH && microtime(true)<$deadline-37) {
            $flagReads++;$nextCursor++;
            $msg=$request('/'.rawurlencode($membership[$source]['providerId']).'?format=minimal');
            if (!is_array($msg['labelIds']??null)) fail('Invalid Gmail message labels. The previous mail view was kept.');
            $folder=gmail_folder($msg['labelIds']);
            if ($folder===null) unset($membership[$source]);
            else $membership[$source]=['folder'=>$folder,'providerId'=>$membership[$source]['providerId'],'labelIds'=>$msg['labelIds'],'read'=>!in_array('UNREAD',$msg['labelIds'],true)];
        }
    }
    $repairIds=array_values(array_filter($repairIds,fn($id)=>isset($membership['gmail:'.$id])));
    $recent=array_merge($recent,$repairIds);
    $recent=array_values(array_unique($recent));
    if(count($recent)>MAIL_SYNC_BATCH*3){$pending=true;$recent=array_slice($recent,0,MAIL_SYNC_BATCH*3);}
    $batchPosition=0;
    foreach ($recent as $id) {
        if (microtime(true)>$deadline-10) { $pending=true; break; }
        $folder=$membership['gmail:'.$id]['folder'];$batchPosition++;
        activity_sync_progress((($olderFolders[$folder]??false)?'Downloading older mail':'Downloading mail').' · '.$folder.' · batch message '.$batchPosition.' of '.count($recent).' · '.($unknownCounts[$folder]??0).' messages still to cache.');
        if(!isset($known['gmail:'.$id]))$unknownCounts[$folder]--;
        $full=mail_offline_download() || $repair || in_array($id,$repairIds,true);
        mail_deadline($deadline); $msg=$request('/'.rawurlencode($id).'?format='.($full?'raw':'metadata'));
        if (!$full) {
            if (!is_array($msg['labelIds']??null)) fail('Invalid Gmail message labels.');
            $folder=gmail_folder($msg['labelIds']);$source='gmail:'.$id;
            if($folder===null){unset($membership[$source]);continue;}
            $meta=['folder'=>$folder,'providerId'=>$id,'labelIds'=>$msg['labelIds'],'read'=>!in_array('UNREAD',$msg['labelIds'],true)];
            $membership[$source]=$meta;$downloads[$source]=gmail_header_download($a,$id,$msg,$meta);continue;
        }
        if (!is_string($msg['raw']??null) || !is_array($msg['labelIds']??null)) fail('Invalid Gmail message content. The previous mail view was kept.');
        $raw=base64_decode(strtr($msg['raw'],'-_','+/'),true);
        if ($raw===false) fail('Invalid Gmail message encoding.');
        if (strlen($raw)>IMAP_BODY_LIMIT) {
            $header=$request('/'.rawurlencode($id).'?format=metadata');
            $meta=['folder'=>gmail_folder($msg['labelIds'])??'Archive','providerId'=>$id,'labelIds'=>$msg['labelIds'],'read'=>!in_array('UNREAD',$msg['labelIds'],true)];
            $downloads['gmail:'.$id]=gmail_header_download($a,$id,$header,$meta);$repairIds=array_values(array_diff($repairIds,[$id]));continue;
        }
        $folder=gmail_folder($msg['labelIds']); $source='gmail:'.$id;
        if ($folder===null) { unset($membership[$source]);$repairIds=array_values(array_diff($repairIds,[$id]));continue; }
        $meta=['folder'=>$folder,'providerId'=>$id,'labelIds'=>$msg['labelIds'],'read'=>!in_array('UNREAD',$msg['labelIds'],true)];
        $membership[$source]=$meta; $meta['junkArrival']=gmail_junk_arrival($msg);
        $downloads[$source]=mail_download($a,$source,$raw,$meta);
        $repairIds=array_values(array_diff($repairIds,[$id]));
    }
    mail_deadline($deadline);
    $count=publish_mail_snapshot($a,$membership,$downloads,static fn($r)=>in_array($r['meta']['folder']??'',array_merge(MAIL_FOLDERS,['Recovery copies','Not in Inbox']),true));
    set_setting('gmail-flags-cursor:'.$a['id'],$nextCursor);
    set_setting('gmail-repair:'.$a['id'],$repairIds);
    mail_pending($a,'standard',$pending || (bool)$repairIds);return $count;
}

/** Caller holds the account mutation lock; reload before saving to preserve flags/location. */
function imap_mail_content(array $r,mixed $s): string {
    $meta=$r['meta'];$path=$meta['serverFolder'];$uid=(string)$meta['providerId'];
    $validity=imap_validity(imap_command($s,'EXAMINE '.imap_quote($path)));
    if(mail_source($path,$validity,$uid)!==mail_row_source($r))fail('Mailbox identifiers changed. Sync before opening this message.',409);
    $sizes=imap_download_sizes($s,[$uid]);if($sizes[$uid]>IMAP_BODY_LIMIT)fail('This message exceeds the 1.4 MB body download limit.');
    $response=imap_command($s,'UID FETCH '.$uid.' (UID BODY.PEEK[])');
    $raw=imap_fetch_content($response,$uid);if($raw===null)fail('Message is no longer available. Refresh the folder.',409);
    return $raw;
}
function download_mail_content(array $r): array {
    $r=get_record($r['id']);
    if ($r['kind']!=='mail' || empty($r['meta']['remote'])) fail('Choose synchronized mail.');
    if (empty($r['meta']['headerOnly'])) return $r;
    if (in_array($r['meta']['folder']??'',['Recovery copies','Not in Inbox'],true)) fail('This message is no longer in its synchronized folder.');
    if (($r['meta']['messageSize']??0)>IMAP_BODY_LIMIT) return attachment_large_body($r);
    $a=account($r['meta']['account']);$meta=$r['meta'];
    if($a['type']==='imap')$raw=imap_with_connection($a,fn($s)=>imap_mail_content($r,$s));
    elseif($a['type']==='google'){
        $msg=google_json('https://gmail.googleapis.com/gmail/v1/users/me/messages/'.rawurlencode($meta['providerId']).'?format=raw',google_token($a));
        $raw=base64_decode(strtr($msg['raw']??'','-_','+/'),true);
        if($raw===false || $raw==='')fail('Invalid Gmail message content.');
    }else fail('Choose a mail account.');
    return save_downloaded_mail_content($r,$a,$raw);
}
function save_downloaded_mail_content(array $r,array $a,string $raw): array {
    if(strlen($raw)>IMAP_BODY_LIMIT)fail('This message exceeds the 1.4 MB body download limit.');
    get_record($r['id']); // Account removal must not resurrect a deleted cache row.
    $meta=$r['meta'];
    unset($meta['headerOnly'],$meta['headersBase64'],$meta['hasHtml']);
    $full=mail_download($a,mail_row_source($r),$raw,$meta);$full['id']=$r['id'];
    return save_record($full,true);
}
