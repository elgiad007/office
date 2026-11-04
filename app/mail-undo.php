<?php
declare(strict_types=1);

// Receipts never accept message snapshots from the browser. Keep at most 100
// recent deletions, for fifteen minutes, with a 64 MB total payload budget.
function mail_undo_prune(): void {
    db()->exec('CREATE TABLE IF NOT EXISTS mail_undo (token TEXT PRIMARY KEY, expires INTEGER NOT NULL, state TEXT NOT NULL, payload TEXT NOT NULL)');
    db()->prepare('DELETE FROM mail_undo WHERE expires<?')->execute([time()]);
}
function imap_undo_labels(mixed $s,string $uid): array {
    $response=imap_command($s,'UID FETCH '.$uid.' (UID X-GM-LABELS)');
    foreach(preg_split('/(?=\* \d+ FETCH)/',implode('',$response['lines'])) as $tuple){
        if(!preg_match('/\bUID '.preg_quote($uid,'/').'(?=\s|\))/i',$tuple))continue;
        if(!preg_match('/\bX-GM-LABELS\s*\(((?:"(?:[^"\\\\]|\\\\.)*"|[^()"\r\n])*)\)/s',$tuple,$m))continue;
        preg_match_all('/"((?:[^"\\\\]|\\\\.)*)"|([^\s"]+)/',$m[1],$tokens,PREG_SET_ORDER);
        return array_map(static fn($t)=>isset($t[2])?$t[2]:preg_replace('/\\\\(["\\\\])/','$1',$t[1]),$tokens);
    }
    fail('Gmail label membership could not be read. Sync before deleting or undoing.');
}
function imap_undo_restore_labels(mixed $s,string $uid,array $before,array $after): void {
    $live=imap_undo_labels($s,$uid);
    $lost=array_values(array_diff($before,$after,$live,['\\All','\\Trash']));
    if(!$lost)return;
    $encoded=array_map(static fn($label)=>preg_match('/^\\\\[A-Za-z]+$/D',$label)?$label:imap_quote($label),$lost);
    imap_command($s,'UID STORE '.$uid.' +X-GM-LABELS ('.implode(' ',$encoded).')');
    if(array_diff($lost,imap_undo_labels($s,$uid)))fail('Restored message labels could not be confirmed. Sync and check the provider.');
}
function mail_undo_receipt(array $payload,string $state='ready'): string {
    mail_undo_prune();
    $db=db();$ownTransaction=!$db->inTransaction();
    if($ownTransaction)$db->beginTransaction();
    try{
        $json=json_encode($payload,JSON_THROW_ON_ERROR);
        if((int)$db->query('SELECT COUNT(*) FROM mail_undo')->fetchColumn()>=100||(int)$db->query('SELECT COALESCE(SUM(length(payload)),0) FROM mail_undo')->fetchColumn()+strlen($json)>64*1024*1024)fail('Deletion undo storage is full. Wait fifteen minutes before deleting more mail.',409);
        $token=bin2hex(random_bytes(24));
        $db->prepare('INSERT INTO mail_undo VALUES(?,?,?,?)')->execute([$token,time()+900,$state,$json]);
        if($ownTransaction)$db->commit();return $token;
    }catch(Throwable $e){if($ownTransaction&&$db->inTransaction())$db->rollBack();throw $e;}
}
function delete_local_mail(array $r): array {
    if($r['kind']!=='mail'||!empty($r['meta']['remote']))fail('Choose local mail.');
    $db=db();$db->beginTransaction();
    try {
        $q=$db->prepare('SELECT * FROM records WHERE id=? AND revision=?');$q->execute([$r['id'],$r['revision']]);$raw=$q->fetch();
        if(!$raw)fail('Item changed elsewhere.',409);
        $q=$db->prepare('SELECT * FROM revisions WHERE record_id=?');$q->execute([$r['id']]);$history=$q->fetchAll();
        $q=$db->prepare('SELECT * FROM mail_files WHERE record_id=?');$q->execute([$r['id']]);$files=$q->fetchAll();
        $token=mail_undo_receipt(['local'=>$raw,'history'=>$history,'files'=>$files,'connections'=>connection_rows($r['id'])]);
        $db->prepare('DELETE FROM records WHERE id=?')->execute([$r['id']]);$db->commit();return ['ok'=>true,'undoToken'=>$token];
    }catch(Throwable $e){if($db->inTransaction())$db->rollBack();throw $e;}
}
function mail_undo_payload(string $token): array {
    mail_undo_prune();$q=db()->prepare('SELECT * FROM mail_undo WHERE token=?');$q->execute([$token]);$receipt=$q->fetch();
    if(!$receipt)fail('Deletion undo expired. Receipts are kept for fifteen minutes.',410);
    if($receipt['state']!=='ready')fail('This undo was already used or its outcome is uncertain. Sync and check the mailbox before taking another action.',409);
    return json_decode($receipt['payload'],true,512,JSON_THROW_ON_ERROR);
}
function undo_mail_delete(string $token,?callable $googleRequest=null,?callable $imapConnect=null): array {
    $payload=mail_undo_payload($token);
    $accountId=(string)($payload['before']['meta']['account']??'');
    return with_account_mail_mutation($accountId,function()use($token,$googleRequest,$imapConnect){
        $p=mail_undo_payload($token);$db=db();
        if(isset($p['local'])){
            $db->beginTransaction();
            try{
                $r=$p['local'];$q=$db->prepare('SELECT 1 FROM records WHERE id=?');$q->execute([$r['id']]);if($q->fetchColumn())fail('A record already uses this message ID. Undo did not overwrite it.',409);
                $db->prepare('INSERT INTO records(id,kind,title,body,meta,revision,updated) VALUES(?,?,?,?,?,?,?)')->execute(array_values($r));
                $q=$db->prepare('INSERT INTO revisions(record_id,revision,snapshot) VALUES(?,?,?)');foreach($p['history'] as $h)$q->execute(array_values($h));
                $q=$db->prepare('INSERT INTO mail_files(record_id,part,name,type,size,data) VALUES(?,?,?,?,?,?)');foreach($p['files'] as $f)$q->execute(array_values($f));
                connection_restore($p['connections']??[]);
                // A selected batch may delete both ends of an edge. Its snapshot
                // can live in the first receipt, so revisit it when either end returns.
                $receipts=$db->prepare("SELECT payload FROM mail_undo WHERE expires>=? AND state IN ('ready','done')");$receipts->execute([time()]);
                foreach($receipts->fetchAll(PDO::FETCH_COLUMN) as $snapshot){
                    $links=json_decode($snapshot,true,512,JSON_THROW_ON_ERROR)['connections']??[];
                    connection_restore(array_values(array_filter($links,static fn($link)=>$link['a']===$r['id']||$link['b']===$r['id'])));
                }
                $db->prepare("UPDATE mail_undo SET state='done' WHERE token=?")->execute([$token]);$db->commit();return ['record'=>get_record($r['id'])];
            }catch(Throwable $e){if($db->inTransaction())$db->rollBack();throw $e;}
        }
        $before=$p['before'];$after=$p['after'];$r=get_record($after['id']);
        foreach(['account','providerId','serverFolder','uidValidity','source'] as $key)if(($r['meta'][$key]??null)!==($after['meta'][$key]??null))fail('The message moved since deletion. Sync and check its location before undoing.',409);
        if(($r['meta']['folder']??'')!=='Trash')fail('The message is no longer in Trash.',409);
        $a=account($r['meta']['account']);
        if($a['type']==='google'){
            $auth=$googleRequest===null?google_token($a):'';$base='https://gmail.googleapis.com/gmail/v1/users/me/messages/'.rawurlencode($r['meta']['providerId']);
            $request=$googleRequest??fn($url,$method='GET',$body=null)=>google_json($url,$auth,$method,$body);
            $live=$request($base.'?format=minimal');$labels=$live['labelIds']??null;
            if(!is_array($labels)||!in_array('TRASH',$labels,true))fail('The provider message is no longer in Trash.',409);
            // Restore memberships removed by trash, preserving unrelated changes.
            $add=array_values(array_diff($before['meta']['labelIds']??[], $after['meta']['labelIds']??[], ['TRASH']));
            $db->prepare("UPDATE mail_undo SET state='uncertain' WHERE token=?")->execute([$token]);
            $msg=$request($base.'/modify','POST',['removeLabelIds'=>['TRASH'],'addLabelIds'=>$add]);
            if(!is_array($msg['labelIds']??null)||in_array('TRASH',$msg['labelIds'],true)||array_diff($add,$msg['labelIds']))fail('Undo could not be confirmed. Sync and check the provider.');
            $r['meta']['labelIds']=$msg['labelIds'];$r['meta']['folder']=gmail_folder($msg['labelIds'])??'Custom folder';$r['meta']['read']=!in_array('UNREAD',$msg['labelIds'],true);$r=save_record($r,true);
        }elseif($a['type']==='imap'){
            $target=$before['meta']['serverFolder']??(($before['meta']['folder']??'')==='Inbox'?'INBOX':null);
            if(!$target)fail('The original server folder is unavailable.');
            $r=imap_with_connection($a,function($s)use($a,$r,$before,$target,$token,$db){
                $path=$r['meta']['serverFolder'];$uid=(string)$r['meta']['providerId'];
                $validity=imap_validity(imap_command($s,'SELECT '.imap_quote($path)));
                if(mail_row_source($r)!==mail_source($path,$validity,$uid))fail('Mailbox identifiers changed. Sync before undoing.',409);
                if(!in_array($uid,imap_search_ids($s,'UID '.$uid),true))fail('The message left Trash. Sync before undoing.',409);
                $cap=imap_command($s,'CAPABILITY');if(!preg_match('/\b(?:MOVE|IMAP4REV2)\b/i',implode('',$cap['lines'])))fail('The server does not support MOVE.');
                imap_command($s,'STATUS '.imap_quote($target).' (MESSAGES)');
                $gmail=imap_is_gmail($a);$gmailId=null;$related=$gmail?imap_gmail_move_copies($a,$s,$r,$path,$uid,$gmailId):[];
                $raw=isset($r['meta']['rawBase64'])?base64_decode($r['meta']['rawBase64'],true):false;
                $db->prepare("UPDATE mail_undo SET state='uncertain' WHERE token=?")->execute([$token]);
                $location=imap_move_verified($s,$uid,$target,'Undo deletion',$path,$gmail,$a,$gmailId,$raw===false?null:$raw);
                $r['meta']=array_merge($r['meta'],$location,['folder'=>$before['meta']['folder']]);
                if($gmail&&isset($before['meta']['imapLabels'])){
                    imap_command($s,'SELECT '.imap_quote($target));
                    imap_undo_restore_labels($s,(string)$location['providerId'],$before['meta']['imapLabels'],$before['meta']['imapTrashLabels']??[]);
                }
                return $gmail?save_imap_gmail_move($r,$related):save_record($r,true);
            },$imapConnect);
        }else fail('This connector cannot undo mail deletion.');
        $db->prepare("UPDATE mail_undo SET state='done' WHERE token=?")->execute([$token]);return ['record'=>$r];
    });
}
