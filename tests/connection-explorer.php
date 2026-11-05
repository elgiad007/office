<?php
declare(strict_types=1);
$dir=sys_get_temp_dir().'/office-explorer-'.bin2hex(random_bytes(8));putenv('OFFICE_DATA_DIR='.$dir);
require dirname(__DIR__).'/app/bootstrap.php';
function check(bool $ok,string $message):void{if(!$ok)throw new RuntimeException($message);echo "PASS $message\n";}
$start=microtime(true);db()->beginTransaction();
$hub=save_record(['kind'=>'documents','title'=>'Large project','body'=>str_repeat('PRIVATE BODY ',100),'meta'=>[]]);
$neighbors=[];
for($i=0;$i<1200;$i++){
 $r=save_record(['kind'=>$i%2?'tasks':'mail','title'=>sprintf('Neighbor %04d',$i),'body'=>'PRIVATE BODY','meta'=>[]]);
 $neighbors[]=$r;connection_add($hub['id'],$r['id']);
}
// A cycle and disconnected components must not duplicate groups or loop in recursive queries.
connection_add($neighbors[0]['id'],$neighbors[1]['id']);
for($i=0;$i<65;$i++){
 $a=save_record(['kind'=>'tasks','title'=>'Separate '.$i,'body'=>'','meta'=>[]]);$b=save_record(['kind'=>'contacts','title'=>'Peer '.$i,'body'=>'','meta'=>[]]);connection_add($a['id'],$b['id']);
}
$isolated=save_record(['kind'=>'tasks','title'=>'Isolated','body'=>'','meta'=>[]]);db()->commit();
$overview=connection_overview();
check($overview['groupTotal']===66&&$overview['itemTotal']===1331&&$overview['total']===1266,'overview counts complete components across thousands of edges');
check(count($overview['groups'])===60&&$overview['more']&&count(connection_overview(60)['groups'])===6,'overview pages groups');
check($overview['groups'][0]['items']===1201&&$overview['groups'][0]['links']===1201,'large cyclic component grouped correctly');
check($overview['groups'][0]['title']==='Large project'&&$overview['groups'][0]['kind']==='documents','group type matches the item supplying its displayed title');
foreach(array_merge($overview['groups'],connection_overview(60)['groups']) as $summary)if($summary['items']===2)check($summary['kind']==='contacts'&&str_starts_with($summary['title'],'Peer '),'mixed-type group uses its named representative type');
$group=$overview['groups'][0]['id'];$page=connection_list('','',0,'',$group,true);
check($page['total']===1201&&count($page['links'])===100&&$page['more'],'group drilldown pages actual component edges');
$seen=[];for($offset=0;$offset<1201;$offset+=100)foreach(connection_list('','',$offset,'',$group,true)['links'] as $link)$seen[$link['a'].'|'.$link['b']]=true;
check(count($seen)===1201,'group paging neither loses nor duplicates edges');
$center=connection_list($hub['id'],'',0,'','',true);
check($center['total']===1200&&max(array_column($center['items'],'degree'))===1200,'neighborhood exposes complete degrees and total');
check(!str_contains(json_encode($center),'PRIVATE BODY'),'graph payload omits record bodies');
$search=connection_explorer_search('Neighbor 1199');check($search['total']===1&&$search['items'][0]['id']===$neighbors[1199]['id'],'global search finds items outside loaded pages');
check(connection_explorer_search('Neighbor','mail')['total']===600,'type filtering happens before paging');
check(connection_explorer_search('Isolated')['total']===0,'global search excludes unconnected items');
check(count(connection_explorer_search('Neighbor')['items'])===50&&connection_explorer_search('Neighbor')['more'],'item search pages results');
$empty=connection_list($isolated['id'],'',0,'','',true);check($empty['total']===0&&$empty['items'][0]['id']===$isolated['id'],'isolated center remains available');
echo 'Explorer fixture and checks: '.round((microtime(true)-$start)*1000)." ms\n";
