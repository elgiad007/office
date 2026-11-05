<?php
declare(strict_types=1);

/** Undirected record relationships. Never mutate provider content to create a link. */
function connection_counts(?array $ids=null): array {
    if($ids!==null){
        if(!$ids)return [];
        $q=db()->prepare('SELECT id, ((SELECT COUNT(*) FROM connections WHERE archived=0 AND a=records.id)+(SELECT COUNT(*) FROM connections WHERE archived=0 AND b=records.id)) AS total FROM records WHERE kind=\'mail\' AND id IN ('.implode(',',array_fill(0,count($ids),'?')).')');
        $q->execute($ids);return $q->fetchAll(PDO::FETCH_KEY_PAIR);
    }
    return db()->query('SELECT id, COUNT(peer) AS total FROM records LEFT JOIN (SELECT a AS source,b AS peer FROM connections WHERE archived=0 UNION ALL SELECT b,a FROM connections WHERE archived=0) links ON links.source=records.id WHERE kind=\'mail\' GROUP BY id')->fetchAll(PDO::FETCH_KEY_PAIR);
}
function connection_add(string $a,string $b,bool $archived=false,?string $created=null,bool $preserveExisting=false): void {
    if($a===$b)fail('An item cannot link to itself.');
    get_record($a);get_record($b);
    [$a,$b]=strcmp($a,$b)<0?[$a,$b]:[$b,$a];
    // Intentional linking reactivates a link; preservation merges keep an existing active link active.
    $merge=$preserveExisting?'MIN(connections.archived,excluded.archived)':'excluded.archived';
    db()->prepare('INSERT INTO connections(a,b,created,archived) VALUES(?,?,?,?) ON CONFLICT(a,b) DO UPDATE SET archived='.$merge)->execute([$a,$b,$created??gmdate('c'),(int)$archived]);
}
function connection_rows(string $id): array {
    $q=db()->prepare('SELECT a,b,created,archived FROM connections WHERE a=? OR b=?');$q->execute([$id,$id]);return $q->fetchAll();
}
/** Called inside the deletion transaction. Keep only a name and relationships. */
function connection_preserve_hub(array $record,?string $title): ?array {
    if($title===null||!connection_rows($record['id']))return null;
    $hub=save_record(['kind'=>'documents','title'=>$title,'body'=>'<p>Original item deleted. Connections preserved.</p>','meta'=>['connectionHub'=>true]]);
    connection_retarget($record['id'],$hub['id']);
    return $hub;
}
function delete_connected_record(array $record,?string $hubTitle=null): array {
    $db=db();$db->beginTransaction();
    try{
        $current=get_record($record['id']);
        if($current['revision']!==$record['revision'])fail('Item changed elsewhere. Reopen it.',409);
        $hub=connection_preserve_hub($current,$hubTitle);
        $db->prepare('DELETE FROM records WHERE id=?')->execute([$current['id']]);
        $db->commit();return ['ok'=>true,'hub'=>$hub];
    }catch(Throwable $e){if($db->inTransaction())$db->rollBack();throw $e;}
}
function connection_restore(array $links): void {
    $exists=db()->prepare('SELECT 1 FROM records WHERE id=?');
    foreach($links as $link){
        $exists->execute([$link['a']]);if(!$exists->fetchColumn())continue;
        $exists->execute([$link['b']]);if(!$exists->fetchColumn())continue;
        connection_add($link['a'],$link['b'],(bool)($link['archived']??false),$link['created']??null,true);
    }
}
/** Move relationships only after a verified identity replacement, inside its transaction. */
function connection_retarget(string $old,string $new): void {
    foreach(connection_rows($old) as $link){$other=$link['a']===$old?$link['b']:$link['a'];if($other!==$new)connection_add($new,$other,(bool)$link['archived'],$link['created'],true);}
    db()->prepare('DELETE FROM connections WHERE a=? OR b=?')->execute([$old,$old]);
}
function connection_summary(array $row): array {
    $meta=json_decode($row['meta'],true,64,JSON_THROW_ON_ERROR);
    $text=trim(preg_replace('/\s+/u',' ',html_entity_decode(strip_tags($row['body']),ENT_QUOTES|ENT_HTML5,'UTF-8'))??'');
    return ['id'=>$row['id'],'kind'=>$row['kind'],'title'=>$row['title'],'excerpt'=>function_exists('mb_substr')?mb_substr($text,0,180):substr($text,0,180),
        'meta'=>array_intersect_key($meta,array_flip(['from','to','start','location','due','email','company','phone','folder','account'])),
        ...(isset($row['degree'])?['degree'=>(int)$row['degree'],'activeDegree'=>(int)$row['activeDegree'],'archivedDegree'=>(int)$row['archivedDegree']]:[])];
}
function connection_filter(string $visibility='active',string $alias=''): string {
    $column=($alias!==''?$alias.'.':'').'archived';
    return match($visibility){'active'=>$column.'=0','archived'=>$column.'=1','all'=>'1=1',default=>fail('Unknown connection visibility.')};
}
function connection_degree_fields(string $visibility): string {
    $count=fn(string $filter)=>"((SELECT COUNT(*) FROM connections WHERE ($filter) AND a=records.id)+(SELECT COUNT(*) FROM connections WHERE ($filter) AND b=records.id))";
    return $count(connection_filter($visibility)).' AS degree, '.$count('archived=0').' AS activeDegree, '.$count('archived=1').' AS archivedDegree';
}
function connection_exists_sql(string $visibility): string {
    $filter=connection_filter($visibility);
    return "(EXISTS (SELECT 1 FROM connections WHERE a=records.id AND ($filter)) OR EXISTS (SELECT 1 FROM connections WHERE b=records.id AND ($filter)))";
}
function connection_members_sql(string $visibility): string {
    $filter=connection_filter($visibility,'c');
    return "WITH RECURSIVE members(id) AS (SELECT ? UNION SELECT c.b FROM members m CROSS JOIN connections c ON c.a=m.id WHERE $filter UNION SELECT c.a FROM members m CROSS JOIN connections c ON c.b=m.id WHERE $filter) ";
}
/** Each bulk update is one atomic statement over the complete scope, independent of UI paging. */
function connection_set_archived(string $id,string $target,string $scope,bool $archived,string $visibility='active'): int {
    get_record($id);$filter=connection_filter($visibility);$prefix='';$args=[];
    if($scope==='edge'){
        get_record($target);[$a,$b]=strcmp($id,$target)<0?[$id,$target]:[$target,$id];$where='a=? AND b=?';$args=[$a,$b];
    }elseif($scope==='item'){$where='(a=? OR b=?)';$args=[$id,$id];}
    elseif($scope==='group'){
        $prefix=connection_members_sql($visibility);
        $where='a IN (SELECT id FROM members)';$args=[$id];
    }else fail('Unknown archive scope.');
    $q=db()->prepare($prefix.'UPDATE connections SET archived='.(int)$archived.' WHERE '.$where.' AND ('.$filter.') AND archived<>'.(int)$archived);$q->execute($args);return $q->rowCount();
}
function connection_search(string $query,string $kind,string $exclude,int $limit=20): array {
    if($kind!==''&&!in_array($kind,KINDS,true))fail('Unknown item type.');
    if(strlen($query)>500)fail('Search is too long.');
    $pattern='%'.str_replace(['\\','%','_'],['\\\\','\\%','\\_'],$query).'%';
    // Only human-facing fields are searchable: exclude raw MIME, credentials and attachment data.
    $sql="SELECT * FROM records WHERE id<>? AND (?='' OR kind=?) AND (id=? OR title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\' OR json_extract(meta,'$.from') LIKE ? ESCAPE '\\' OR json_extract(meta,'$.to') LIKE ? ESCAPE '\\' OR json_extract(meta,'$.location') LIKE ? ESCAPE '\\' OR json_extract(meta,'$.email') LIKE ? ESCAPE '\\' OR json_extract(meta,'$.company') LIKE ? ESCAPE '\\') ORDER BY CASE WHEN id=? THEN 0 WHEN title=? COLLATE NOCASE THEN 1 WHEN title LIKE ? ESCAPE '\\' THEN 2 ELSE 3 END,updated DESC,id LIMIT ?";
    $q=db()->prepare($sql);$args=[$exclude,$kind,$kind,$query,$pattern,$pattern,$pattern,$pattern,$pattern,$pattern,$pattern,$query,$query,$pattern];
    foreach($args as $i=>$arg)$q->bindValue($i+1,$arg);$q->bindValue(count($args)+1,$limit,PDO::PARAM_INT);$q->execute();
    return array_map('connection_summary',$q->fetchAll());
}
function connection_list(string $id='',string $query='',int $offset=0,string $kind='',string $group='',bool $lightweight=false,string $visibility='active'): array {
    if($id!=='')get_record($id);
    if($group!=='')get_record($group);
    if($kind!==''&&!in_array($kind,KINDS,true))fail('Unknown item type.');
    if(strlen($query)>500)fail('Search is too long.');
    $filter=connection_filter($visibility,'c');
    // UNION deduplicates visited records, including cycles, before paging edges.
    $prefix=$group!==''?connection_members_sql($visibility):'';
    $where="FROM connections c JOIN records x ON x.id=c.a JOIN records y ON y.id=c.b WHERE ($filter) AND (?='' OR c.a=? OR c.b=?) AND (?='' OR instr(lower(x.title),lower(?))>0 OR instr(lower(y.title),lower(?))>0) AND (?='' OR x.kind=? OR y.kind=?)".($group!==''?' AND c.a IN (SELECT id FROM members)':'');
    $args=array_merge($group!==''?[$group]:[],[$id,$id,$id,$query,$query,$query,$kind,$kind,$kind]);
    $count=db()->prepare($prefix.'SELECT COUNT(*) AS total,COALESCE(SUM(c.archived),0) AS archivedTotal '.$where);$count->execute($args);$totals=$count->fetch();$total=(int)$totals['total'];
    $q=db()->prepare($prefix.'SELECT c.a,c.b,c.created,c.archived '.$where.' ORDER BY c.created DESC,c.a,c.b LIMIT 101 OFFSET ?');
    foreach($args as $i=>$arg)$q->bindValue($i+1,$arg);$q->bindValue(count($args)+1,max(0,$offset),PDO::PARAM_INT);$q->execute();$links=$q->fetchAll();$more=count($links)>100;$links=array_map(fn($link)=>[...$link,'archived'=>(bool)$link['archived']],array_slice($links,0,100));
    $fields=$lightweight?"id,kind,title,'' AS body,meta":'*';
    $items=[];$record=db()->prepare("SELECT $fields, ".connection_degree_fields($visibility).' FROM records WHERE id=?');
    foreach($links as $link)foreach([$link['a'],$link['b']] as $key)if(!isset($items[$key])){$record->execute([$key]);$items[$key]=connection_summary($record->fetch());}
    // Include the center even when an item has no connections or filters exclude every edge.
    $center=$id!==''?$id:$group;
    if($center!==''&&!isset($items[$center])){$record->execute([$center]);$items[$center]=connection_summary($record->fetch());}
    return ['links'=>$links,'items'=>array_values($items),'more'=>$more,'total'=>$total,'activeTotal'=>$total-(int)$totals['archivedTotal'],'archivedTotal'=>(int)$totals['archivedTotal']];
}

/** Connected components use only identity and titles; message bodies never enter the overview. */
function connection_overview(int $offset=0,string $visibility='active'): array {
    $filter=connection_filter($visibility);
    $edges=db()->query('SELECT a,b,archived FROM connections WHERE '.$filter)->fetchAll();$parents=[];$sizes=[];
    $find=function(string $id)use(&$parents):string{ $root=$id;while($parents[$root]!==$root)$root=$parents[$root];while($parents[$id]!==$id){$next=$parents[$id];$parents[$id]=$root;$id=$next;}return $root;};
    foreach($edges as $edge){foreach([$edge['a'],$edge['b']] as $id)if(!isset($parents[$id])){$parents[$id]=$id;$sizes[$id]=1;}
        $a=$find($edge['a']);$b=$find($edge['b']);if($a!==$b){if($sizes[$a]<$sizes[$b])[$a,$b]=[$b,$a];$parents[$b]=$a;$sizes[$a]+=$sizes[$b];}}
    $groups=[];
    foreach($parents as $id=>$_){$root=$find($id);if(!isset($groups[$root]))$groups[$root]=['id'=>$root,'title'=>'','kind'=>'','items'=>0,'links'=>0,'archivedLinks'=>0];$groups[$root]['items']++;}
    foreach($edges as $edge){$root=$find($edge['a']);$groups[$root]['links']++;$groups[$root]['archivedLinks']+=(int)$edge['archived'];}
    $titles=db()->query('SELECT id,title,kind FROM records WHERE '.connection_exists_sql($visibility).' ORDER BY title COLLATE NOCASE,id');
    foreach($titles as $row){if(!isset($parents[$row['id']]))continue;$root=$find($row['id']);if($groups[$root]['title']===''){$groups[$root]['title']=$row['title'];$groups[$root]['kind']=$row['kind'];}}
    $groups=array_values($groups);usort($groups,fn($a,$b)=>($b['items']<=>$a['items'])?:strcmp($a['id'],$b['id']));
    return ['links'=>[],'items'=>[],'groups'=>array_slice($groups,max(0,$offset),60),'more'=>max(0,$offset)+60<count($groups),'total'=>count($edges),'itemTotal'=>count($parents),'groupTotal'=>count($groups)];
}

/** Global connected-item search is independent of the currently loaded map. */
function connection_explorer_search(string $query='',string $kind='',int $offset=0,string $visibility='active'): array {
    $filter=connection_filter($visibility);
    if($kind!==''&&!in_array($kind,KINDS,true))fail('Unknown item type.');
    if(strlen($query)>500)fail('Search is too long.');
    $where="FROM records WHERE ".connection_exists_sql($visibility)." AND (?='' OR instr(lower(title),lower(?))>0 OR id=?) AND (?='' OR kind=?)";
    $args=[$query,$query,$query,$kind,$kind];$count=db()->prepare('SELECT COUNT(*) '.$where);$count->execute($args);$total=(int)$count->fetchColumn();
    $q=db()->prepare("SELECT id,kind,title,'' AS body,meta,".connection_degree_fields($visibility)." ".$where.' ORDER BY title COLLATE NOCASE,id LIMIT 51 OFFSET ?');
    foreach($args as $i=>$arg)$q->bindValue($i+1,$arg);$q->bindValue(6,max(0,$offset),PDO::PARAM_INT);$q->execute();$rows=$q->fetchAll();
    return ['links'=>[],'items'=>array_map('connection_summary',array_slice($rows,0,50)),'more'=>count($rows)>50,'total'=>$total];
}
