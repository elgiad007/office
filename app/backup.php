<?php
declare(strict_types=1);

const OFFICE_BACKUP_TYPE = 'application/vnd.sqlite3';
const OFFICE_BACKUP_ID = 0x4F464243; // OFBC
const OFFICE_BACKUP_VERSION = 1;
const OFFICE_BACKUP_COLUMNS = [
    'records'=>'id,kind,title,body,meta,revision,updated',
    'revisions'=>'record_id,revision,snapshot',
    'connections'=>'a,b,created,archived',
    'mail_files'=>'record_id,part,name,type,size,data',
    'settings'=>'key,value',
];

function backup_temp_file(): string {
    $path=tempnam(data_dir(),'office-backup-');
    if($path===false)fail('Cannot create a temporary backup file.',500);
    return $path;
}

function stream_office_backup(): never {
    $path=backup_temp_file();
    try {
        $db=db();
        $db->prepare('ATTACH DATABASE ? AS office_backup')->execute([$path]);
        try {
            $db->beginTransaction();
            $db->exec('PRAGMA office_backup.application_id='.OFFICE_BACKUP_ID);
            $db->exec('PRAGMA office_backup.user_version='.OFFICE_BACKUP_VERSION);
            foreach(OFFICE_BACKUP_COLUMNS as $table=>$columns){
                $filter=$table==='settings'?" WHERE key='preferences'":'';
                $db->exec("CREATE TABLE office_backup.$table AS SELECT $columns FROM main.$table$filter");
            }
            $db->commit();
        } finally {
            if($db->inTransaction())$db->rollBack();
            $db->exec('DETACH DATABASE office_backup');
        }
        $size=filesize($path);
        if($size===false)fail('Cannot read the backup file.',500);
        activity_finish(true);
        header('Content-Type: '.OFFICE_BACKUP_TYPE);
        header('Content-Disposition: attachment; filename="office-backup-'.gmdate('Y-m-d').'.sqlite"');
        header('Content-Length: '.$size);
        header('X-Accel-Buffering: no');
        ignore_user_abort(true);
        readfile($path);
    } finally {
        unlink($path);
    }
    exit;
}

function office_backup_rows(PDO $archive,string $table): Generator {
    $columns=OFFICE_BACKUP_COLUMNS[$table];
    $rows=$archive->query("SELECT $columns FROM main.$table");
    foreach($rows as $row){
        if($table==='records'){
            if(!is_string($row['meta']))fail('Invalid item metadata.');
            $row['meta']=json_decode($row['meta'],true,64,JSON_THROW_ON_ERROR);
            if(!is_array($row['meta']))fail('Invalid item metadata.');
        }
        yield $row;
    }
}

function restore_sqlite_backup(): array {
    $configured=getenv('OFFICE_SQLITE_RESTORE_MAX_BYTES');
    $limit=filter_var($configured,FILTER_VALIDATE_INT,['options'=>['min_range'=>20,'max_range'=>PHP_INT_MAX-1]])?:128*1024*1024;
    if ((int)($_SERVER['CONTENT_LENGTH']??0)>$limit) fail('SQLite backup exceeds the restore upload limit.',413);
    $path=backup_temp_file();
    try {
        $input=fopen('php://input','rb');
        $file=fopen($path,'wb');
        try {
            if(!$input||!$file)fail('Cannot open the backup upload.',500);
            $header=fread($input,20);
            if(strlen($header)!==20||substr($header,0,16)!=="SQLite format 3\0")fail('Choose an Office SQLite backup.');
            if(substr($header,18,2)!=="\x01\x01")fail('Choose a standalone Office SQLite backup.');
            if(fwrite($file,$header)!==20)fail('Cannot write the backup upload.',500);
            $copied=stream_copy_to_stream($input,$file,$limit-19);
            if ($copied!==false && $copied+20>$limit) fail('SQLite backup exceeds the restore upload limit.',413);
            if($copied===false || (isset($_SERVER['CONTENT_LENGTH']) && $copied+20!==(int)$_SERVER['CONTENT_LENGTH']))fail('The backup upload was incomplete.');
        } finally {
            if($input)fclose($input);
            if($file)fclose($file);
        }
        // Read the upload on a separate connection with no access to the live database.
        $archive=new PDO('sqlite:'.$path,null,null,[
            PDO::SQLITE_ATTR_OPEN_FLAGS=>PDO::SQLITE_OPEN_READONLY,
            PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC,
        ]);
        $archive->exec('PRAGMA trusted_schema=OFF');
        if((int)$archive->query('PRAGMA application_id')->fetchColumn()!==OFFICE_BACKUP_ID ||
            (int)$archive->query('PRAGMA user_version')->fetchColumn()!==OFFICE_BACKUP_VERSION)fail('Unsupported Office SQLite backup.');
        $tables=$archive->query("SELECT name FROM sqlite_schema WHERE type='table' AND sql LIKE 'CREATE TABLE %'")->fetchAll(PDO::FETCH_COLUMN);
        if(array_diff(array_keys(OFFICE_BACKUP_COLUMNS),$tables))fail('The Office SQLite backup is missing tables.');
        $preferences=$archive->query("SELECT value FROM settings WHERE key='preferences'")->fetchColumn();
        $prefs=$preferences===false?[]:json_decode($preferences,true,64,JSON_THROW_ON_ERROR);
        return restore_office_backup(
            office_backup_rows($archive,'records'),office_backup_rows($archive,'revisions'),$prefs,
            office_backup_rows($archive,'connections'),office_backup_rows($archive,'mail_files')
        )+['preferences'=>$prefs];
    } catch(JsonException|PDOException $error) {
        // Corrupt database files and invalid row data may fail during iteration.
        if($error instanceof PDOException && !in_array((int)($error->errorInfo[1]??0),[1,11,19,26],true))throw $error;
        fail('The Office SQLite backup is invalid or damaged.');
    } finally {
        unset($archive);
        unlink($path);
    }
}

function restore_json_backup(mixed $backup): array {
    if(!is_array($backup)||($backup['format']??'')!=='portable-office'||($backup['version']??0)!==1||
        !is_array($backup['records']??null)||count($backup['records'])>10000)fail('Unsupported backup.');
    $histories=$backup['revisions']??[];
    if(!is_array($histories)||count($histories)>20000)fail('Invalid revision history.');
    $links=$backup['connections']??[];
    if(!is_array($links)||count($links)>100000)fail('Invalid connections.');
    $files=$backup['mailFiles']??[];
    if(!is_array($files)||count($files)>50000)fail('Invalid attachment backup.');
    return restore_office_backup($backup['records'],$histories,$backup['preferences']??[],$links,$files);
}

function restore_office_backup(iterable $records,iterable $histories,mixed $prefs,iterable $links,iterable $files): array {
    if(!is_array($prefs)||strlen(json_encode($prefs,JSON_THROW_ON_ERROR))>10000)fail('Invalid preferences.');
    $db=db();
    $db->exec('BEGIN IMMEDIATE');
    try {
        if((int)$db->query('SELECT COUNT(*) FROM records')->fetchColumn()!==0)fail('Restore requires an empty workspace. Use an empty profile to keep existing work safe.',409);
        $seen=[];
        $insertRecord=$db->prepare('INSERT INTO records VALUES(?,?,?,?,?,?,?)');
        foreach($records as $r){
            if(!is_array($r)||!is_string($r['id']??null)||!is_string($r['title']??null)||!is_string($r['body']??null))fail('Invalid backup record.');
            $id=$r['id'];
            if(!preg_match('/^[a-zA-Z0-9_-]{1,100}$/D',$id)||isset($seen[$id]))fail('Invalid or duplicate backup ID.');
            $v=validate_record($r);
            $seen[$id]=true;
            if(!empty($v['meta']['remote'])){
                $v['meta']['importedFrom']=$v['meta']['accountLabel']??'Remote account';
                unset($v['meta']['remote'],$v['meta']['account'],$v['meta']['source']);
            }
            $updated=is_string($r['updated']??null)&&strlen($r['updated'])<=40?$r['updated']:gmdate('c');
            $insertRecord->execute([$id,$v['kind'],$v['title'],$v['body'],json_encode($v['meta'],JSON_THROW_ON_ERROR),max(1,(int)($r['revision']??1)),$updated]);
            mail_index_record($db,$id,$v['kind'],$v['meta']);
        }
        $insertRevision=$db->prepare('INSERT INTO revisions VALUES(?,?,?)');
        foreach($histories as $h){
            if(!is_array($h)||!is_string($h['record_id']??null)||!isset($seen[$h['record_id']])||
                (int)($h['revision']??0)<1||!is_string($h['snapshot']??null))fail('Invalid revision history.');
            $snapshot=json_decode($h['snapshot'],true);
            if(!is_array($snapshot))fail('Invalid revision history.');
            validate_record($snapshot);
            $insertRevision->execute([$h['record_id'],(int)$h['revision'],$h['snapshot']]);
        }
        $fileKeys=[];
        foreach($files as $file){
            if(!is_array($file)||!is_string($file['record_id']??null)||!isset($seen[$file['record_id']])||
                !is_string($file['part']??null)||!preg_match('/^[a-zA-Z0-9_.-]{1,100}$/D',$file['part'])||
                !is_string($file['name']??null)||!is_string($file['type']??null)||!is_string($file['data']??null))fail('Invalid attachment backup.');
            $bytes=base64_decode($file['data'],true);
            if($bytes===false||strlen($bytes)>MAIL_FILE_LIMIT||strlen($bytes)!==($file['size']??null))fail('Invalid attachment backup data.');
            $key=$file['record_id'].'/'.$file['part'];
            if(isset($fileKeys[$key]))fail('Duplicate attachment backup.');
            $fileKeys[$key]=true;
            attachment_store($file['record_id'],$file,$bytes);
        }
        foreach($links as $link){
            if(!is_array($link)||!is_string($link['a']??null)||!is_string($link['b']??null)||$link['a']===$link['b']||
                !isset($seen[$link['a']],$seen[$link['b']]))fail('Invalid connection endpoints.');
            if(!in_array($link['archived']??0,[0,1,false,true],true))fail('Invalid connection archive status.');
            if(isset($link['created'])&&!is_string($link['created']))fail('Invalid connection date.');
            connection_add($link['a'],$link['b'],(bool)($link['archived']??false),$link['created']??null,true);
        }
        set_setting('preferences',$prefs);
        $db->exec('COMMIT');
        return ['count'=>count($seen)];
    } catch(Throwable $error) {
        $db->exec('ROLLBACK');
        throw $error;
    }
}
