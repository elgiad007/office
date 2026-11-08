<?php
declare(strict_types=1);

/** Separate private store: progress is readable during main-database transactions
 * and is deliberately absent from content backups. Never store IMAP transcripts. */
function activity_db(): PDO {
    static $db;
    if ($db) return $db;
    $store=new PDO('sqlite:'.data_dir().'/activity.sqlite',null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
    $store->exec('PRAGMA busy_timeout=1000; CREATE TABLE IF NOT EXISTS activity (id INTEGER PRIMARY KEY AUTOINCREMENT, time TEXT NOT NULL, level TEXT NOT NULL, account TEXT NOT NULL, operation TEXT NOT NULL, message TEXT NOT NULL, duration_ms INTEGER, run TEXT NOT NULL, phase TEXT NOT NULL, record_id TEXT)');
    $hasRecordId=static fn()=>$store->query("SELECT 1 FROM pragma_table_info('activity') WHERE name='record_id'")->fetchColumn();
    if(!$hasRecordId()){
        try{$store->exec('ALTER TABLE activity ADD COLUMN record_id TEXT');}
        catch(PDOException $error){if(!$hasRecordId())throw $error;}
    }
    @chmod(data_dir().'/activity.sqlite',0600);
    return $db=$store;
}
function activity_event(string $message,string $level='info',string $phase='progress',?int $duration=null): void {
    try {
        $loggingLevel=$GLOBALS['office_activity']['logging_level']??null;
        if($loggingLevel===null){
            $preferences=setting('preferences',[]);
            $loggingLevel=$preferences['activityLogLevel']??'summary';
            if(!in_array($loggingLevel,['summary','warnings','detailed'],true))$loggingLevel='summary';
            if(isset($GLOBALS['office_activity']))$GLOBALS['office_activity']['logging_level']=$loggingLevel;
        }
        $alert=in_array($level,['warning','error'],true);
        $save=$loggingLevel==='detailed'||$alert||($loggingLevel==='summary'&&$phase==='complete');
        $stream=!empty($GLOBALS['office_activity_stream']);
        $live=$stream&&in_array($phase,['start','sync-progress','mail-cache-ready','complete','error'],true);
        if(!$save&&!$live)return;

        $message=substr(preg_replace('/[\x00-\x1f\x7f]/',' ',$message),0,1000);
        $alertKey=null;
        if($alert&&$loggingLevel!=='detailed'&&$phase!=='error'&&isset($GLOBALS['office_activity'])){
            $alertKey=$level.':'.$message;
            if(isset($GLOBALS['office_activity']['seen_alerts'][$alertKey]))return;
        }
        $context=$GLOBALS['office_activity']??[];
        $entry=['time'=>gmdate('Y-m-d\TH:i:s\Z'),'level'=>$level,'account'=>substr($context['account']??'',0,200),
            'operation'=>$context['operation']??'Office','message'=>$message,
            'duration_ms'=>$duration,'run'=>$context['run']??'','phase'=>$phase,'record_id'=>$context['record_id']??null];
        unset($context);
        if($save){
            $db=activity_db();$db->beginTransaction();
            $db->prepare('INSERT INTO activity(time,level,account,operation,message,duration_ms,run,phase,record_id) VALUES(?,?,?,?,?,?,?,?,?)')->execute(array_values($entry));
            $id=(int)$db->lastInsertId();
            // Prune once per group and at operation boundaries.
            if($id%50===0 || in_array($phase,['complete','error'],true))$db->exec('DELETE FROM activity WHERE id NOT IN (SELECT id FROM activity ORDER BY id DESC LIMIT 500)');
            $db->commit();
            if($alertKey!==null)$GLOBALS['office_activity']['seen_alerts'][$alertKey]=true;
        }
        if($stream) {
            echo json_encode($save?['type'=>'activity','entry'=>['id'=>$id]+$entry]:['type'=>'activity-progress','entry'=>$entry],JSON_INVALID_UTF8_SUBSTITUTE)."\n";
            if(ob_get_level())@ob_flush();flush();
        }
    } catch (Throwable) { if(isset($db)&&$db->inTransaction())$db->rollBack(); /* Logging must not interrupt mail. */ }
}
function activity_begin(string $operation,string $account='',bool $stream=true,mixed $recordId=null): void {
    if($stream && ($_SERVER['HTTP_X_OFFICE_PROGRESS']??'')==='1' && !headers_sent()) {
        $GLOBALS['office_activity_stream']=true;@ini_set('zlib.output_compression','0');
        header('Content-Type: application/x-ndjson');header('X-Accel-Buffering: no');
    }
    $GLOBALS['office_activity']=['operation'=>$operation,'account'=>$account,'run'=>bin2hex(random_bytes(8)),'started'=>microtime(true)];
    if(is_string($recordId)&&preg_match('/^[a-zA-Z0-9_-]{1,100}$/D',$recordId))activity_set_record($recordId);
    activity_event('Started: '.$operation,'info','start');
}
function activity_set_record(string $recordId): void {
    if(isset($GLOBALS['office_activity']))$GLOBALS['office_activity']['record_id']=$recordId;
}
function activity_step(string $message,string $level='info',?int $duration=null): void {
    if(isset($GLOBALS['office_activity']))activity_event($message,$level,'progress',$duration);
}
/** Publish folder and batch progress for the live status bar. */
function activity_sync_progress(string $message): void {
    if(isset($GLOBALS['office_activity']))activity_event($message,'info','sync-progress');
}
function activity_finish(bool $ok,?string $reason=null): void {
    $context=$GLOBALS['office_activity']??null;if(!$context)return;
    activity_event(($ok?'Completed: ':'Stopped: ').$context['operation'].(!$ok&&$reason!==null?' — '.$reason:''),$ok?'success':'error',$ok?'complete':'error',(int)round((microtime(true)-$context['started'])*1000));
    unset($GLOBALS['office_activity']);
}
function activity_rows(int $after=0): array {
    $q=activity_db()->prepare('SELECT * FROM activity WHERE id>? ORDER BY id DESC LIMIT 500');$q->execute([max(0,$after)]);
    return array_reverse($q->fetchAll());
}
