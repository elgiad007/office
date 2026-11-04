<?php
declare(strict_types=1);
$dir=sys_get_temp_dir().'/office-connections-'.bin2hex(random_bytes(8));putenv('OFFICE_DATA_DIR='.$dir);
require dirname(__DIR__).'/app/bootstrap.php';
require dirname(__DIR__).'/app/connectors.php';
require dirname(__DIR__).'/app/mail-undo.php';
function check(bool $ok,string $message): void {if(!$ok)throw new RuntimeException($message);echo "PASS $message\n";}
$a=save_record(['kind'=>'tasks','title'=>'Budget planning','body'=>'Discussion of quarterly figures','meta'=>[]]);
$b=save_record(['kind'=>'calendar','title'=>'Budget review','body'=>'','meta'=>['location'=>'Conference room']]);
$c=save_record(['kind'=>'mail','title'=>'Invoice','body'=>'100% paid','meta'=>['folder'=>'Local mail','raw'=>'secret mime']]);
connection_add($a['id'],$b['id']);connection_add($b['id'],$a['id']);
check(count(connection_rows($a['id']))===1&&count(connection_rows($b['id']))===1,'links are bidirectional and duplicate-safe');
try{connection_add($a['id'],$a['id']);throw new RuntimeException('self link accepted');}catch(HttpError){check(true,'self links rejected');}
try{connection_add($a['id'],'missing');throw new RuntimeException('missing target accepted');}catch(HttpError){check(true,'missing targets rejected');}
$b['title']='Renamed meeting';save_record($b);check(connection_list($a['id'])['items'][1]['title']!==''&&count(connection_rows($b['id']))===1,'renames preserve connections');
check(count(connection_search('quarterly','',$b['id']))===1,'descriptions searchable across types');
check(count(connection_search('Conference','calendar',''))===1,'event location searchable');
check(count(connection_search('Budget','calendar',''))===0,'type filter applied before result limit');
check(count(connection_search('100%','',''))===1&&count(connection_search('100_','',''))===0,'search treats percent and underscore literally');
check(connection_search('secret mime','','')===[],'raw MIME is not searched');
check(connection_search($a['id'],'','')[0]['id']===$a['id'],'exact IDs resolve');
$local=save_record(['kind'=>'mail','title'=>'Replacement','body'=>'','meta'=>['folder'=>'Local mail']]);
connection_add($c['id'],$a['id']);
db()->beginTransaction();connection_retarget($c['id'],$local['id']);db()->prepare('DELETE FROM records WHERE id=?')->execute([$c['id']]);db()->commit();
check(count(connection_rows($local['id']))===1,'verified replacements preserve links');
$deleted=delete_local_mail($local);check(connection_rows($a['id'])!==[]&&connection_rows($local['id'])===[],'deleting an item cleans its edges');
undo_mail_delete($deleted['undoToken']);check(count(connection_rows($local['id']))===1,'deletion undo restores links');
$links=connection_rows($a['id']);db()->exec('DELETE FROM connections');connection_restore($links);check(count(connection_rows($a['id']))===2,'backup edges restore');
db()->prepare('DELETE FROM records WHERE id=?')->execute([$local['id']]);connection_restore($links);check(count(connection_rows($a['id']))===1,'undo skips permanently missing neighbors');
for($i=0;$i<102;$i++){$r=save_record(['kind'=>'tasks','title'=>'Page '.$i,'body'=>'','meta'=>[]]);connection_add($a['id'],$r['id']);}
$first=connection_list($a['id']);$next=connection_list($a['id'],'',100);
check(count($first['links'])===100&&$first['more']&&count($next['links'])===3&&!$next['more'],'connection lists paginate without dropping edges');
check(count(connection_list('','Renamed')['links'])===1,'workspace connection filter searches both ends');
$m1=save_record(['kind'=>'mail','title'=>'Batch one','body'=>'','meta'=>['folder'=>'Local mail']]);$m2=save_record(['kind'=>'mail','title'=>'Batch two','body'=>'','meta'=>['folder'=>'Local mail']]);
connection_add($m1['id'],$m2['id']);$u1=delete_local_mail($m1);$u2=delete_local_mail($m2);undo_mail_delete($u1['undoToken']);undo_mail_delete($u2['undoToken']);
check(count(connection_rows($m1['id']))===1,'batch undo restores links between two deleted endpoints');
