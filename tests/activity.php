<?php
declare(strict_types=1);
$testDir=sys_get_temp_dir().'/office-activity-'.bin2hex(random_bytes(8));putenv('OFFICE_DATA_DIR='.$testDir);
require __DIR__.'/imap.php';
try {
    $legacy=new PDO('sqlite:'.data_dir().'/activity.sqlite');
    $legacy->exec("CREATE TABLE activity (id INTEGER PRIMARY KEY AUTOINCREMENT, time TEXT NOT NULL, level TEXT NOT NULL, account TEXT NOT NULL, operation TEXT NOT NULL, message TEXT NOT NULL, duration_ms INTEGER, run TEXT NOT NULL, phase TEXT NOT NULL);
        INSERT INTO activity VALUES (1,'2026-11-01T00:00:00Z','info','','Office','Legacy entry',NULL,'','notice')");
    $legacy=null;
    $entries=activity_rows();
    check(count($entries)===1 && $entries[0]['message']==='Legacy entry' && $entries[0]['record_id']===null,'activity migration preserves older entries');
    activity_begin('Synchronize account','Fixture account',false);
    for($i=0;$i<550;$i++)activity_step('Finished folder batch '.$i,'success');
    activity_sync_progress('Downloading older mail');
    activity_event('Inbox ready','info','mail-cache-ready');
    activity_step('Large message retained','warning');
    activity_step('Large message retained','warning');
    activity_finish(true);
    activity_begin('Save item','',false,'task-id');
    activity_finish(true);
    $entries=activity_rows();
    check(array_column($entries,'phase')===['notice','progress','complete','complete'] && $entries[3]['record_id']==='task-id','summary preserves existing history, distinct warnings, outcomes and item links');
    set_setting('preferences',['activityLogLevel'=>'warnings']);
    activity_db()->exec('DELETE FROM activity');
    activity_begin('Synchronize account','Fixture account',false);
    activity_step('Large message retained','warning');
    activity_finish(true);
    activity_begin('Synchronize account','Fixture account',false);
    activity_step('Connection timed out','error');
    activity_step('Connection timed out','error');
    activity_finish(false,'Connection timed out');
    $entries=activity_rows();
    check(array_column($entries,'level')===['warning','error','error'] && array_column($entries,'phase')===['progress','progress','error'],'warnings level retains distinct alerts and the terminal failure');
    activity_db()->exec('DELETE FROM activity');
    set_setting('preferences',['activityLogLevel'=>'detailed']);
    activity_begin('Move mail','Fixture account',false,'source-id');
    activity_set_record('destination-id');
    activity_finish(true);
    $entries=activity_rows();
    check(array_column($entries,'record_id')===['source-id','destination-id'],'activity records the source and the resulting item ID');
    activity_db()->exec('DELETE FROM activity');

    activity_begin('Test connection','Fixture account');
    fixture([['LOGIN "private-user" "secret-password"',"{tag} OK private-server-text\r\n"]],fn($s)=>imap_command($s,'LOGIN "private-user" "secret-password"'));
    activity_finish(true);$entries=activity_rows();$json=json_encode($entries);
    check(!str_contains($json,'secret-password')&&!str_contains($json,'private-user')&&!str_contains($json,'private-server-text'),'activity excludes credentials, raw commands and server text');
    check(count($entries)===4 && $entries[0]['phase']==='start' && $entries[3]['phase']==='complete' && $entries[3]['duration_ms']!==null,'activity records stages and completion duration');
    activity_begin('Synchronize account','Fixture account');
    activity_sync_progress('Downloading older mail · Archive · batch message 4 of 100 · 296 messages still to cache.');
    activity_finish(true);$progress=array_values(array_filter(activity_rows(),fn($entry)=>$entry['phase']==='sync-progress'));
    check(count($progress)===1 && str_contains($progress[0]['message'],'Archive · batch message 4 of 100'),'folder and batch progress has its own activity phase');
    $attempts=0;
    $connect=function() use(&$attempts){$attempts++;ArchiveFixture::$script=[['CAPABILITY',$attempts===1?'':"* CAPABILITY IMAP4rev1\r\n{tag} OK done\r\n"]];return fopen('archivefixture://retry','r+');};
    activity_begin('Recover connection','Fixture account');
    imap_with_connection([],fn($s)=>imap_command($s,'CAPABILITY'),$connect);
    activity_finish(true);check($attempts===2,'pre-write interruption reconnects once');
    $attempts=0;$connect=function() use(&$attempts){$attempts++;ArchiveFixture::$script=[['UID MOVE 42 "Trash"','']];return fopen('archivefixture://uncertain','r+');};
    try{imap_with_connection([],fn($s)=>imap_command($s,'UID MOVE 42 "Trash"'),$connect);throw new RuntimeException('Expected interrupted move');}
    catch(ImapTransportError $e){check($attempts===1&&str_contains($e->getMessage(),'moving message'),'interrupted move is not blindly retried and identifies the failing stage');}
    fixture([
        ['EXAMINE "INBOX"',"* OK [UIDVALIDITY 3] valid\r\n{tag} OK done\r\n"],
        ['UID SEARCH X-GM-MSGID 9001',"* SEARCH\r\n{tag} OK done\r\n"],
        ['EXAMINE "[Gmail]/Trash"',"* OK [UIDVALIDITY 8] valid\r\n{tag} OK done\r\n"],
        ['UID SEARCH X-GM-MSGID 9001',"* SEARCH 70\r\n{tag} OK done\r\n"],
        ['UID FETCH 70 (UID X-GM-MSGID)',"* 1 FETCH (UID 70 X-GM-MSGID 9001)\r\n{tag} OK done\r\n"],
    ],function($s){$location=imap_verify_gmail_move($s,'INBOX','9001','[Gmail]/Trash');check($location['providerId']==='70'&&!array_filter(ArchiveFixture::$commands,fn($command)=>str_contains($command,' MOVE ')),'read-only recovery confirms completed Gmail move without repeating it');});
    fixture([['EXAMINE "INBOX"',"* OK [UIDVALIDITY 3] valid\r\n{tag} OK done\r\n"],['UID SEARCH X-GM-MSGID 9001',"* SEARCH 42\r\n{tag} OK done\r\n"]],function($s){refused(fn()=>imap_verify_gmail_move($s,'INBOX','9001','[Gmail]/Trash'),'still in its source folder');});
    for($i=0;$i<505;$i++)activity_event('Event '.$i);
    $entries=activity_rows();check(count($entries)===500&&$entries[0]['message']==='Event 5','activity retention is bounded to latest 500 entries');
    check(count(activity_rows((int)$entries[498]['id']))===1,'activity cursor returns only new events');
    activity_db()->exec('DELETE FROM activity');check(activity_rows()===[],'activity can be cleared');
    echo "PASS private activity store and IMAP recovery fixtures.\n";
} finally {foreach(glob($testDir.'/*')?:[] as $file)@unlink($file);@rmdir($testDir);}
