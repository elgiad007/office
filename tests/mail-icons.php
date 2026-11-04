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
$mail=save_record(['kind'=>'mail','title'=>'Sender identity','body'=>'','meta'=>['folder'=>'Inbox']]);
check_icon((int)connection_counts()[$mail['id']]===0,'Zero count included');
for($i=0;$i<102;$i++){
    $peer=save_record(['kind'=>$i%2?'tasks':'documents','title'=>'Peer '.$i,'body'=>'','meta'=>[]]);
    connection_add($mail['id'],$peer['id']);
}
check_icon((int)connection_counts()[$mail['id']]===102,'Exact count beyond connection-page limit');
check_icon((int)connection_counts([$mail['id']])[$mail['id']]===102,'Mutation counts limited to affected endpoints');
check_icon((int)get_record($mail['id'])['connectionCount']===102,'Detail response carries count');
echo "PASS sender favicon validation and exact batched connection counts.\n";
