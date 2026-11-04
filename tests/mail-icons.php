<?php
declare(strict_types=1);
require dirname(__DIR__).'/app/bootstrap.php';
require dirname(__DIR__).'/app/sender-favicon.php';
function check_icon(bool $condition,string $message):void{if(!$condition)throw new RuntimeException($message);}
foreach(['127.0.0.1','localhost','user@example.com','example.com:443','example.com/path','-example.com','example..com'] as $domain)check_icon(!sender_favicon_domain($domain),'Reject '.$domain);
check_icon(sender_favicon_domain('news.example.com'),'Accept DNS name');
check_icon(sender_favicon_address('127.0.0.1')===null,'Reject loopback address');
check_icon(sender_favicon_image('<svg xmlns="http://www.w3.org/2000/svg"></svg>')===null,'Reject SVG');
check_icon(sender_favicon_image('<html>Error page</html>')===null,'Reject HTML');
check_icon(sender_favicon_image("\0\0\1\0")===null,'Reject truncated ICO');
$png=base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=');
check_icon(sender_favicon_image($png)['type']==='image/png','Accept PNG');

$html='<html><head><link rel="icon" href="https://cdn.example.com/icon.png">'.str_repeat(' ',300000).'</head><body>Large page';
$body='';$complete=false;
foreach(str_split($html,16384) as $chunk)if(sender_favicon_chunk($body,$chunk,true,$complete)===0)break;
check_icon($complete && strlen($body)===262144,'Large HTML retains a bounded prefix');
check_icon(sender_favicon_links($body,'https://www.example.com/')===['https://cdn.example.com/icon.png'],'Icon survives a page larger than the byte cap');
$body='';$complete=false;
check_icon(sender_favicon_chunk($body,'<head><link rel="icon" href="/favicon.png"></head>'.str_repeat('x',10000),true,$complete)===0 && $complete,'Stop after a complete head');
$body='';$complete=false;
check_icon(sender_favicon_chunk($body,str_repeat('x',262145),false,$complete)===0 && !$complete,'Oversized binary remains a failure');
check_icon(sender_favicon_url('../icons/icon.png?size=32','https://www.example.com/app/start')==='https://www.example.com/icons/icon.png?size=32','Relative redirect/page URL resolution');
check_icon(sender_favicon_url('//cdn.example.com/icon.png','https://example.com/')==='https://cdn.example.com/icon.png','CDN links allowed with HTTPS');
foreach(['http://example.com/icon.png','https://127.0.0.1/icon.png','https://example.com:8443/icon.png','https://user:pass@example.com/icon.png','data:image/png;base64,AA==','https://example.com/\\bad'] as $unsafe)check_icon(sender_favicon_url($unsafe,'https://example.com/')===null,'Reject unsafe URL '.$unsafe);
check_icon(sender_favicon_domains('rs.email.example.co.uk')===['rs.email.example.co.uk','email.example.co.uk','example.co.uk'],'Mailing-prefix fallback keeps country-code domains intact');
check_icon(sender_favicon_domains('mail.co.uk')===['mail.co.uk'],'Never look up the registry namespace');
check_icon(sender_favicon_domains('division.example.com')===['division.example.com'],'Do not strip arbitrary organization subdomains');
$requests=[];
$icon=sender_favicon_lookup('rs.email.example.com',static function(string $url,bool $head)use(&$requests,$png):?array{
    $requests[]=$url;
    if($url==='https://example.com/')return ['body'=>'<head><link rel="icon" href="bad.svg"><link rel="icon" href="broken.png"><link rel="icon" href="//cdn.example.com/good.png"></head>','url'=>'https://www.example.com/app/start'];
    if($url==='https://www.example.com/app/broken.png')return ['body'=>'Not an image','url'=>$url];
    if($url==='https://cdn.example.com/good.png')return ['body'=>$png,'url'=>$url];
    return null;
});
check_icon(($icon['type']??null)==='image/png','Discovery handles parent domain, final page URL, CDN, and a broken first candidate');
check_icon(in_array('https://www.example.com/app/broken.png',$requests,true),'Relative candidate uses final redirected page');
check_icon(!in_array('https://www.example.com/app/bad.svg',$requests,true),'Skip unsupported SVG before downloading');
$oldMiss=['expires'=>time()+86400,'icon'=>null];
check_icon(!sender_favicon_cache_fresh($oldMiss),'Old negative cache is retried immediately');
check_icon(sender_favicon_cache_fresh($oldMiss+['version'=>2]),'Current misses respect their short TTL');
check_icon(sender_favicon_cache_fresh(['expires'=>time()+86400,'icon'=>['type'=>'image/png','body'=>base64_encode($png)]]),'Preserve existing successful cache');
$mail=save_record(['kind'=>'mail','title'=>'Sender identity','body'=>'','meta'=>['folder'=>'Inbox']]);
check_icon((int)connection_counts()[$mail['id']]===0,'Zero count included');
for($i=0;$i<102;$i++){
    $peer=save_record(['kind'=>$i%2?'tasks':'documents','title'=>'Peer '.$i,'body'=>'','meta'=>[]]);
    connection_add($mail['id'],$peer['id']);
}
check_icon((int)connection_counts()[$mail['id']]===102,'Exact count beyond connection-page limit');
check_icon((int)connection_counts([$mail['id']])[$mail['id']]===102,'Mutation counts limited to affected endpoints');
check_icon((int)get_record($mail['id'])['connectionCount']===102,'Detail response carries count');
echo "PASS large-page discovery, redirects/CDN candidates, sender subdomains, cache migration, image validation and exact connection counts.\n";
