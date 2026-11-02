<?php
declare(strict_types=1);

/** Separate private store: progress is readable during main-database transactions
 * and is deliberately absent from content backups. Never store IMAP transcripts. */
function activity_db(): PDO {
    static $db;
    if ($db) return $db;
    $db=new PDO('sqlite:'.data_dir().'/activity.sqlite',null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
    $db->exec('PRAGMA busy_timeout=1000; CREATE TABLE IF NOT EXISTS activity (id INTEGER PRIMARY KEY AUTOINCREMENT, time TEXT NOT NULL, level TEXT NOT NULL, account TEXT NOT NULL, operation TEXT NOT NULL, message TEXT NOT NULL, duration_ms INTEGER, run TEXT NOT NULL, phase TEXT NOT NULL)');
    @chmod(data_dir().'/activity.sqlite',0600);
    return $db;
}
function activity_event(string $message,string $level='info',string $phase='progress',?int $duration=null): void {
    $context=$GLOBALS['office_activity']??[];
    try {
        $db=activity_db();$db->beginTransaction();
        $db->prepare('INSERT INTO activity(time,level,account,operation,message,duration_ms,run,phase) VALUES(?,?,?,?,?,?,?,?)')->execute([
            gmdate('Y-m-d\TH:i:s\Z'),$level,substr($context['account']??'',0,200),$context['operation']??'Office',
            substr(preg_replace('/[\x00-\x1f\x7f]/',' ',$message),0,1000),$duration,$context['run']??'', $phase]);
        $id=(int)$db->lastInsertId();
        $db->exec('DELETE FROM activity WHERE id NOT IN (SELECT id FROM activity ORDER BY id DESC LIMIT 500)');$db->commit();
        if(!empty($GLOBALS['office_activity_stream'])) {
            echo json_encode(['type'=>'activity','entry'=>['id'=>$id,'time'=>gmdate('Y-m-d\TH:i:s\Z'),'level'=>$level,'account'=>$context['account']??'','operation'=>$context['operation']??'Office','message'=>substr(preg_replace('/[\x00-\x1f\x7f]/',' ',$message),0,1000),'duration_ms'=>$duration,'run'=>$context['run']??'','phase'=>$phase]],JSON_INVALID_UTF8_SUBSTITUTE)."\n";
            if(ob_get_level())@ob_flush();flush();
        }
    } catch (Throwable) { if(isset($db)&&$db->inTransaction())$db->rollBack(); /* Logging must not interrupt mail. */ }
}
function activity_begin(string $operation,string $account=''): void {
    if(($_SERVER['HTTP_X_OFFICE_PROGRESS']??'')==='1' && !headers_sent()) {
        $GLOBALS['office_activity_stream']=true;@ini_set('zlib.output_compression','0');
        header('Content-Type: application/x-ndjson');header('X-Accel-Buffering: no');
    }
    $GLOBALS['office_activity']=['operation'=>$operation,'account'=>$account,'run'=>bin2hex(random_bytes(8)),'started'=>microtime(true)];
    activity_event('Started: '.$operation,'info','start');
}
function activity_step(string $message,string $level='info',?int $duration=null): void {
    if(isset($GLOBALS['office_activity']))activity_event($message,$level,'progress',$duration);
}
/** Keep useful folder/batch progress visible while transport details fill the log. */
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
