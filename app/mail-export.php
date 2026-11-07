<?php
declare(strict_types=1);

const MAIL_EXPORT_BATCH = 16;
const MAIL_EXPORT_HEADER_ONLY = "COALESCE(json_extract(records.meta,'$.headerOnly'),0)<>0";

function stream_mail_export(bool $complete): never {
    $path=tempnam(data_dir(),'mail-export-');
    if($path===false)fail('Cannot create the mail archive.',500);
    try{
        $db=db();
        $db->prepare('ATTACH DATABASE ? AS mail_archive')->execute([$path]);
        try{
            $db->beginTransaction();
            $headerOnly=MAIL_EXPORT_HEADER_ONLY;
            $missing=(int)$db->query("SELECT COUNT(*) FROM main.records WHERE kind='mail' AND ($headerOnly)")->fetchColumn();
            $db->exec('CREATE TABLE mail_archive.records (
                id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
                meta TEXT NOT NULL, revision INTEGER NOT NULL, updated TEXT NOT NULL
            )');
            $filter=$complete?" AND NOT ($headerOnly)":"";
            $count=$db->exec("INSERT INTO mail_archive.records (id,kind,title,body,meta,revision,updated)
                SELECT id,kind,title,body,meta,revision,updated FROM main.records WHERE kind='mail'$filter");
            $db->commit();
        }finally{
            if($db->inTransaction())$db->rollBack();
            $db->exec('DETACH DATABASE mail_archive');
        }
        $size=filesize($path);
        if($size===false)fail('Cannot read the mail archive.',500);
        $name=$complete?'mail.sqlite':'mail-cached.sqlite';
        header('Content-Type: application/vnd.sqlite3');
        header('Content-Disposition: attachment; filename="'.$name.'"');
        header('Content-Length: '.$size);
        header('X-Office-Mail-Count: '.$count);
        header('X-Office-Mail-Header-Only: '.$missing);
        header('X-Accel-Buffering: no');
        // Let the file close and the temporary copy be removed after a canceled download.
        ignore_user_abort(true);
        readfile($path);
    }finally{
        unlink($path);
    }
    exit;
}

function mail_export_plan(): array {
    $headerOnly=MAIL_EXPORT_HEADER_ONLY;
    $rows=db()->query("SELECT records.id, accounts.id AS account, accounts.type,
        json_extract(records.meta,'$.serverFolder') AS folder,
        json_extract(records.meta,'$.messageSize') AS bytes
        FROM records JOIN accounts ON accounts.id=json_extract(records.meta,'$.account')
        WHERE records.kind='mail' AND ($headerOnly) AND json_extract(records.meta,'$.remote')
        AND COALESCE(json_extract(records.meta,'$.folder'),'') NOT IN ('Recovery copies','Not in Inbox')
        ORDER BY accounts.id, folder, records.id");
    $batches=[];$groups=[];
    foreach($rows as $row){
        $account=$row['account'];
        if((int)$row['bytes']>IMAP_BODY_LIMIT){
            $batches[]=['account'=>$account,'ids'=>[$row['id']]];
            continue;
        }
        $key=json_encode([$account,$row['folder']],JSON_THROW_ON_ERROR);
        $groups[$key]['account']=$account;
        $groups[$key]['limit']=$row['type']==='imap'?MAIL_EXPORT_BATCH:2;
        $groups[$key]['ids'][]=$row['id'];
    }
    foreach($groups as $group)foreach(array_chunk($group['ids'],$group['limit']) as $ids){
        $batches[]=['account'=>$group['account'],'ids'=>$ids];
    }
    return $batches;
}

/** Return full literals keyed by record ID. Keep each response within the IMAP reader limit. */
function imap_export_bodies(mixed $socket,array $rows,string $folder): array {
    $validity=imap_validity(imap_command($socket,'EXAMINE '.imap_quote($folder)));
    $uids=[];
    foreach($rows as $row){
        $uid=(string)($row['meta']['providerId']??'');
        if(preg_match('/^[1-9][0-9]*$/D',$uid) && mail_source($folder,$validity,$uid)===mail_row_source($row))$uids[$uid]=$row['id'];
    }
    if(!$uids)return [];
    $sizes=imap_fetch_responses(imap_command($socket,'UID FETCH '.imap_uid_set(array_keys($uids)).' (UID RFC822.SIZE)'));
    $groups=[];$chunk=[];$bytes=0;
    foreach(array_keys($uids) as $uid){
        if(!preg_match('/\bRFC822\.SIZE\s+(\d+)\b/i',implode('',$sizes[$uid]['lines']??[]),$match))continue;
        $size=(int)$match[1];
        if($size>IMAP_BODY_LIMIT)continue;
        if($bytes+$size>2*1024*1024){
            $groups[]=$chunk;$chunk=[];$bytes=0;
        }
        $chunk[]=$uid;$bytes+=$size;
    }
    if($chunk)$groups[]=$chunk;
    $bodies=[];
    foreach($groups as $ids){
        try{$tuples=imap_fetch_responses(imap_command($socket,'UID FETCH '.imap_uid_set($ids).' (UID BODY.PEEK[])'));}
        catch(HttpError $error){if(!$bodies)throw $error;break;}
        foreach($ids as $uid){
            $body=isset($tuples[$uid])?imap_fetch_content($tuples[$uid],(string)$uid):null;
            if($body!==null)$bodies[$uids[$uid]]=$body;
        }
    }
    return $bodies;
}

function hydrate_mail_export_batch(string $accountId,array $ids): ?string {
    return with_account_mail_mutation($accountId,function()use($accountId,$ids){
        $account=account($accountId);
        $groups=[];$fallback=[];$warning=null;
        foreach($ids as $id){
            try{$row=get_record($id);}catch(HttpError $error){$warning??=$error->getMessage();continue;}
            $meta=$row['meta'];
            if($row['kind']!=='mail'||empty($meta['remote'])||($meta['account']??'')!==$accountId||empty($meta['headerOnly']))continue;
            if(in_array($meta['folder']??'',['Recovery copies','Not in Inbox'],true))continue;
            if($account['type']==='imap' && !empty($meta['serverFolder']) && ($meta['messageSize']??0)<=IMAP_BODY_LIMIT){
                $groups[$meta['serverFolder']][]=$row;
            }else $fallback[]=$row;
        }
        foreach($groups as $folder=>$rows){
            try{
                $bodies=imap_with_connection($account,fn($socket)=>imap_export_bodies($socket,$rows,(string)$folder));
            }catch(HttpError $error){$warning??=$error->getMessage();continue;}
            foreach($rows as $row){
                $body=$bodies[$row['id']]??null;
                if($body===null){$warning??='Some message bodies are no longer available in their synchronized folder.';continue;}
                try{save_downloaded_mail_content($row,$account,$body);}
                catch(HttpError $error){$warning??=$error->getMessage();}
            }
        }
        foreach($fallback as $row){
            try{download_mail_content($row);}
            catch(HttpError $error){$warning??=$error->getMessage();}
        }
        return $warning;
    });
}
