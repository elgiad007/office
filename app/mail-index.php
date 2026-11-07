<?php
declare(strict_types=1);

/** Derived query fields. JSON remains authoritative and backups stay compatible. */
function mail_index_time(array $meta): ?int {
    foreach (['date','sentAt'] as $key) {
        $value=$meta[$key]??null;
        if(!is_string($value)||trim($value)==='')continue;
        $parts=date_parse($value);
        if($parts['error_count']||$parts['warning_count']||!$parts['year']||!$parts['month']||!$parts['day'])continue;
        try {$date=new DateTimeImmutable($value,new DateTimeZone('UTC'));return (int)$date->format('U')*1000+(int)$date->format('v');}
        catch(Exception) {}
    }
    return null;
}

function mail_index_record(PDO $db,string $id,string $kind,array $meta): void {
    if($kind!=='mail')return;
    $text=static fn(string $key,string $fallback=''):string=>is_string($meta[$key]??null)?$meta[$key]:$fallback;
    $q=$db->prepare('INSERT INTO mail_index(id,account,remote,folder,server_folder,message_time,label_ids,suspected_junk) VALUES(?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET account=excluded.account,remote=excluded.remote,folder=excluded.folder,server_folder=excluded.server_folder,message_time=excluded.message_time,label_ids=excluded.label_ids,suspected_junk=excluded.suspected_junk');
    $q->execute([$id,$text('account'),empty($meta['remote'])?0:1,$text('folder')?:'Archive',
        $text('serverFolder',$text('folder')),mail_index_time($meta),json_encode(array_values(array_filter(is_array($meta['labelIds']??null)?$meta['labelIds']:[],'is_string')),JSON_THROW_ON_ERROR),
        !empty($meta['junkReason'])&&empty($meta['junkReviewed'])?1:0]);
}

function ensure_mail_index(PDO $db): void {
    if($db->query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='mail_index'")->fetchColumn())return;
    $db->exec('BEGIN IMMEDIATE');
    try {
        // Another request may have completed migration while this one waited.
        if(!$db->query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='mail_index'")->fetchColumn()){
            $db->exec('CREATE TABLE mail_index (
                id TEXT PRIMARY KEY REFERENCES records(id) ON DELETE CASCADE,
                account TEXT NOT NULL, remote INTEGER NOT NULL, folder TEXT NOT NULL,
                server_folder TEXT NOT NULL, message_time INTEGER, label_ids TEXT NOT NULL,
                suspected_junk INTEGER NOT NULL);
                CREATE INDEX mail_index_date ON mail_index(message_time DESC,id);
                CREATE INDEX mail_index_folder_date ON mail_index(folder,message_time DESC,id);
                CREATE INDEX mail_index_account_folder ON mail_index(account,remote,folder,message_time DESC,id);
                CREATE INDEX mail_index_server_folder ON mail_index(account,remote,server_folder,message_time DESC,id);');
            // Stream the backfill; never hydrate MIME, attachment data or reader records.
            foreach($db->query("SELECT id,kind,meta FROM records WHERE kind='mail'") as $row)
                mail_index_record($db,$row['id'],$row['kind'],json_decode($row['meta'],true,64,JSON_THROW_ON_ERROR));
        }
        $db->exec('COMMIT');
    } catch(Throwable $error) {$db->exec('ROLLBACK');throw $error;}
}

/** Newest-first browsing is paged; client-side search/grouping can request the full scoped view. */
function mail_list_page(array $input): array {
    $db=db();$where=[];$args=[];
    $account=(string)($input['account']??'');$folder=(string)($input['folder']??'Inbox');
    if($account!==''){
        $where[]="account=? AND remote=1 AND folder NOT IN ('Recovery copies','Not in Inbox')";$args[]=$account;
        $q=$db->prepare('SELECT type FROM accounts WHERE id=?');$q->execute([$account]);
        if($q->fetchColumn()==='google'){$where[]='EXISTS (SELECT 1 FROM json_each(label_ids) WHERE value=?)';$args[]=$folder;}
        elseif(strtoupper($folder)==='INBOX')$where[]="upper(server_folder)='INBOX'";
        else {$where[]='server_folder=?';$args[]=$folder;}
    }elseif($folder==='all')$where[]="folder NOT IN ('Recovery copies','Not in Inbox','Trash','Junk')";
    elseif($folder==='Recovery copies')$where[]="folder IN ('Recovery copies','Not in Inbox')";
    elseif($folder==='Suspected Junk')$where[]="folder='Inbox' AND suspected_junk=1";
    elseif($folder==='Local Junk')$where[]="folder='Junk' AND remote=0";
    else {$where[]='folder=?';$args[]=$folder;}
    $filter=implode(' AND ',$where);
    $paged=($input['page']??'')==='1';
    $offset=$paged?max(0,(int)($input['offset']??0)):0;
    $limit=$paged?max(1,min(10000,(int)($input['limit']??100))):-1;
    // Count, IDs and content belong to the same database snapshot.
    $db->beginTransaction();
    try {
        $q=$db->prepare('SELECT COUNT(*) FROM mail_index WHERE '.$filter);$q->execute($args);$total=(int)$q->fetchColumn();
        $q=$db->prepare('SELECT id FROM mail_index WHERE '.$filter.' ORDER BY message_time DESC,id LIMIT '.$limit.' OFFSET '.$offset);$q->execute($args);
        $ids=$q->fetchAll(PDO::FETCH_COLUMN);$records=[];
        foreach(array_chunk($ids,100) as $batch){
            $marks=implode(',',array_fill(0,count($batch),'?'));
            $files=$db->prepare('SELECT record_id,part,name,type,size FROM mail_files WHERE record_id IN ('.$marks.') ORDER BY rowid');$files->execute($batch);$cached=[];
            foreach($files as $file){$id=$file['record_id'];unset($file['record_id']);$cached[$id][]=$file+['available'=>true];}
            $rows=$db->prepare('SELECT * FROM records WHERE id IN ('.$marks.')');$rows->execute($batch);$counts=connection_counts($batch);
            foreach($rows as $row){$id=$row['id'];$record=mail_list_record(record_row($row,$cached[$id]??[]));$record['connectionCount']=(int)($counts[$id]??0);$records[$id]=$record;}
        }
        $db->commit();
        return ['records'=>array_map(static fn($id)=>$records[$id],$ids),'mailPage'=>['total'=>$total,'offset'=>$offset,'more'=>$paged&&$offset+count($ids)<$total]];
    }catch(Throwable $error){if($db->inTransaction())$db->rollBack();throw $error;}
}
