<?php
declare(strict_types=1);
$dir=sys_get_temp_dir().'/office-archive-'.bin2hex(random_bytes(8));mkdir($dir);putenv('OFFICE_DATA_DIR='.$dir);
// Start with the original schema and real legacy data to exercise migration.
$legacy=new PDO('sqlite:'.$dir.'/office.sqlite');
$legacy->exec("CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT,title TEXT,body TEXT,meta TEXT,revision INTEGER,updated TEXT);CREATE TABLE connections(a TEXT,b TEXT,created TEXT,PRIMARY KEY(a,b),CHECK(a<b));INSERT INTO records VALUES('legacy-a','tasks','Legacy task','Keep task','{}',1,'2026-11-04'),('legacy-b','mail','Legacy mail','Keep message','{}',1,'2026-11-04');INSERT INTO connections VALUES('legacy-a','legacy-b','2026-11-03');");$legacy=null;
require dirname(__DIR__).'/app/bootstrap.php';require dirname(__DIR__).'/app/connectors.php';require dirname(__DIR__).'/app/mail-undo.php';
function check(bool $ok,string $message):void{if(!$ok)throw new RuntimeException($message);echo "PASS $message\n";}
check(connection_list('legacy-a')['total']===1&&connection_rows('legacy-a')[0]['archived']===0,'legacy links migrate as active without losing data');
check(connection_set_archived('legacy-b','legacy-a','edge',true)===1,'either endpoint can archive an edge');
check(connection_list('legacy-a')['total']===0&&connection_list('legacy-a','',0,'','',true,'archived')['total']===1&&connection_list('legacy-a','',0,'','',true,'all')['total']===1,'active archived and all views filter consistently');
check((int)connection_counts(['legacy-b'])['legacy-b']===0&&(int)connection_counts()['legacy-b']===0,'mail badges count only active connections');
check(connection_explorer_search('Legacy')['total']===0&&connection_explorer_search('Legacy','',0,'archived')['total']===2,'search hides archived relationships by default');
check(get_record('legacy-b')['body']==='Keep message','archiving does not modify the underlying record');
connection_add('legacy-a','legacy-b');check(connection_rows('legacy-a')[0]['archived']===0,'intentional relinking restores an archived relationship');
db()->beginTransaction();$hub=save_record(['kind'=>'tasks','title'=>'Large archived hub','body'=>'','meta'=>[]]);$peers=[];
for($i=0;$i<1100;$i++){$peer=save_record(['kind'=>'documents','title'=>'Archive peer '.$i,'body'=>'','meta'=>[]]);$peers[]=$peer;connection_add($hub['id'],$peer['id']);}
connection_add($peers[0]['id'],$peers[1]['id']);db()->commit();
check(connection_set_archived($hub['id'],'','group',true)===1101,'group archiving covers every edge beyond loaded pages and cycles');
check(connection_list($hub['id'])['total']===0&&connection_list($hub['id'],'',0,'','',true,'archived')['total']===1100,'archived group disappears from active neighborhoods');
$archived=connection_overview(0,'archived');check($archived['groups'][0]['links']===1101&&$archived['groups'][0]['archivedLinks']===1101,'archived overview reports full groups and explicit status');
check(connection_set_archived($hub['id'],'','group',false,'archived')===1101,'group restoration restores complete archived components');
check(connection_set_archived($hub['id'],'','item',true)===1100&&connection_list($peers[0]['id'])['total']===1,'item archive leaves peer-to-peer links active');
check(connection_set_archived($hub['id'],'','item',false,'archived')===1100,'item connections can be restored');
$a=save_record(['kind'=>'tasks','title'=>'Split A','body'=>'','meta'=>[]]);$b=save_record(['kind'=>'tasks','title'=>'Split B','body'=>'','meta'=>[]]);$c=save_record(['kind'=>'tasks','title'=>'Split C','body'=>'','meta'=>[]]);$d=save_record(['kind'=>'tasks','title'=>'Split D','body'=>'','meta'=>[]]);
connection_add($a['id'],$b['id']);connection_add($b['id'],$c['id']);connection_add($c['id'],$d['id']);connection_set_archived($b['id'],$c['id'],'edge',true);
check(connection_list('','',0,'',$a['id'],true)['total']===1&&connection_list('','',0,'',$a['id'],true,'all')['total']===3,'archived bridges split active groups but all view reconnects them');
connection_set_archived($a['id'],'','group',true);check(connection_list($c['id'])['total']===1,'group archive never crosses an already archived bridge in active view');
$old=save_record(['kind'=>'mail','title'=>'Archived original','body'=>'','meta'=>['folder'=>'Local mail']]);$replacement=save_record(['kind'=>'mail','title'=>'Replacement','body'=>'','meta'=>['folder'=>'Local mail']]);connection_add($old['id'],$a['id']);connection_set_archived($old['id'],'','item',true);
connection_retarget($old['id'],$replacement['id']);check(connection_rows($replacement['id'])[0]['archived']===1,'identity replacement preserves archive status');
$snapshot=connection_rows($replacement['id']);db()->prepare('DELETE FROM connections WHERE a=? OR b=?')->execute([$replacement['id'],$replacement['id']]);connection_restore($snapshot);check(connection_rows($replacement['id'])[0]['archived']===1,'backup-style restore preserves archive status');
$deleted=delete_local_mail($replacement);undo_mail_delete($deleted['undoToken']);check(connection_rows($replacement['id'])[0]['archived']===1,'mail deletion undo preserves archived links');
$deleted=delete_local_mail(get_record($replacement['id']),'Archived context');$hubId=mail_undo_payload($deleted['undoToken'])['hubId'];check(connection_rows($hubId)[0]['archived']===1,'deletion preservation hubs retain archived links');undo_mail_delete($deleted['undoToken']);check(connection_rows($replacement['id'])[0]['archived']===1,'undo from a preserved hub retains archived state');
$oldBackup=[['a'=>$replacement['id'],'b'=>$d['id'],'created'=>'2026-11-01']];connection_restore($oldBackup);$links=connection_rows($replacement['id']);check(count(array_filter($links,fn($link)=>!$link['archived']))===1,'older backups without archive status remain active');
try{connection_set_archived($a['id'],'','group',true,'invalid');throw new RuntimeException('invalid visibility accepted');}catch(HttpError){check(true,'unknown visibility is rejected');}
