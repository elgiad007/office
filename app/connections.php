<?php
declare(strict_types=1);

/** Undirected record relationships. Never mutate provider content to create a link. */
function connection_add(string $a,string $b): void {
    if($a===$b)fail('An item cannot link to itself.');
    get_record($a);get_record($b);
    [$a,$b]=strcmp($a,$b)<0?[$a,$b]:[$b,$a];
    db()->prepare('INSERT OR IGNORE INTO connections(a,b,created) VALUES(?,?,?)')->execute([$a,$b,gmdate('c')]);
}
function connection_rows(string $id): array {
    $q=db()->prepare('SELECT a,b,created FROM connections WHERE a=? OR b=?');$q->execute([$id,$id]);return $q->fetchAll();
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
        connection_add($link['a'],$link['b']);
    }
}
/** Move relationships only after a verified identity replacement, inside its transaction. */
function connection_retarget(string $old,string $new): void {
    foreach(connection_rows($old) as $link){$other=$link['a']===$old?$link['b']:$link['a'];if($other!==$new)connection_add($new,$other);}
    db()->prepare('DELETE FROM connections WHERE a=? OR b=?')->execute([$old,$old]);
}
function connection_summary(array $row): array {
    $meta=json_decode($row['meta'],true,64,JSON_THROW_ON_ERROR);
    $text=trim(preg_replace('/\s+/u',' ',html_entity_decode(strip_tags($row['body']),ENT_QUOTES|ENT_HTML5,'UTF-8'))??'');
    return ['id'=>$row['id'],'kind'=>$row['kind'],'title'=>$row['title'],'excerpt'=>function_exists('mb_substr')?mb_substr($text,0,180):substr($text,0,180),
        'meta'=>array_intersect_key($meta,array_flip(['from','to','start','location','due','email','company','phone','folder','account']))];
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
function connection_list(string $id='',string $query='',int $offset=0): array {
    if($id!=='')get_record($id);
    $q=db()->prepare("SELECT c.a,c.b,c.created FROM connections c JOIN records x ON x.id=c.a JOIN records y ON y.id=c.b WHERE (?='' OR c.a=? OR c.b=?) AND (?='' OR instr(lower(x.title),lower(?))>0 OR instr(lower(y.title),lower(?))>0) ORDER BY c.created DESC,c.a,c.b LIMIT 101 OFFSET ?");
    foreach([$id,$id,$id,$query,$query,$query] as $i=>$arg)$q->bindValue($i+1,$arg);$q->bindValue(7,max(0,$offset),PDO::PARAM_INT);$q->execute();$links=$q->fetchAll();$more=count($links)>100;$links=array_slice($links,0,100);
    $items=[];$record=db()->prepare('SELECT * FROM records WHERE id=?');
    foreach($links as $link)foreach([$link['a'],$link['b']] as $key)if(!isset($items[$key])){$record->execute([$key]);$items[$key]=connection_summary($record->fetch());}
    return ['links'=>$links,'items'=>array_values($items),'more'=>$more];
}
