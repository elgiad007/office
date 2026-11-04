<?php
declare(strict_types=1);

// Keep file bytes out of record metadata and normal message-list responses.
const MAIL_FILE_LIMIT = 10 * 1024 * 1024;
const MAIL_FILE_TOTAL = 20 * 1024 * 1024;
function attachment_name(string $name): string {
    $name=preg_replace('/[\x00-\x1f\x7f\\\\\/:*?"<>|]/u','_',mb_attachment_utf8($name));
    $name=trim($name," .\t");
    if($name==='')return 'attachment';$name=substr($name,0,220);
    while(!preg_match('//u',$name))$name=substr($name,0,-1);return $name;
}
function mb_attachment_utf8(string $value): string {
    return json_decode(json_encode($value,JSON_INVALID_UTF8_SUBSTITUTE|JSON_THROW_ON_ERROR),true);
}
function attachment_parameter(string $header,string $key): ?string {
    // RFC 2231 extended parameters and continuations, then ordinary MIME names.
    $value=null;$encoded=false;
    for($i=0;$i<30;$i++){
        $piece=eml_parameter($header,$key.'*'.$i.'*');$enc=$piece!==null;
        if($piece===null)$piece=eml_parameter($header,$key.'*'.$i);
        if($piece===null)break;
        if($i===0){$value='';$encoded=$enc;}
        $value.=$enc?rawurldecode($piece):$piece;
    }
    if($value===null){$value=eml_parameter($header,$key.'*');$encoded=$value!==null;if($encoded)$value=rawurldecode($value);}
    if($value===null)$value=eml_parameter($header,$key);
    if($value===null)return null;
    if($encoded && preg_match("/^([^']*)'[^']*'(.*)$/s",$value,$m)){
        $value=$m[2];if($m[1]!=='' && function_exists('iconv'))$value=@iconv($m[1],'UTF-8//IGNORE',$value)?:$value;
    }
    return function_exists('iconv_mime_decode') && str_contains($value,'=?')?(iconv_mime_decode($value,ICONV_MIME_DECODE_CONTINUE_ON_ERROR,'UTF-8')?:$value):$value;
}
function attachment_part(array $headers,string $part,int $size): array {
    $type=$headers['content-type']??'text/plain';$disposition=$headers['content-disposition']??'';
    $media=strtolower(trim(explode(';',$type,2)[0]));
    $name=attachment_parameter($disposition,'filename')??attachment_parameter($type,'name');
    $explicit=strtolower(trim(explode(';',$disposition,2)[0]))==='attachment';
    $inline=!$explicit && str_starts_with($media,'image/') && (isset($headers['content-id']) || str_starts_with(strtolower($disposition),'inline'));
    return ['part'=>$part,'name'=>attachment_name($name??('attachment-'.$part)), 'type'=>$media,'size'=>$size,
        'attachment'=>$explicit || (!$inline && ($name!==null || !in_array($media,['text/plain','text/html'],true))),
        'encoding'=>strtolower($headers['content-transfer-encoding']??''),'headers'=>$headers];
}
function attachment_decode(string $bytes,string $encoding): string {
    if(strtolower($encoding)==='base64'){$bytes=base64_decode(preg_replace('/\s+/','',$bytes),true);if($bytes===false)fail('Attachment encoding is invalid.');}
    elseif(strtolower($encoding)==='quoted-printable')$bytes=quoted_printable_decode($bytes);
    if(strlen($bytes)>MAIL_FILE_LIMIT)fail('Attachments are limited to 10 MB per file.');
    return $bytes;
}
/** Walk MIME without interpreting an attached message as its parent's body. */
function attachment_mime_parts(string $raw,string $path='',int $depth=0,?int &$remaining=null): array {
    if($remaining===null)$remaining=500;
    if($depth>20 || --$remaining<0)fail('Message MIME structure exceeds the supported limit.');
    [$headers,$body]=eml_entity($raw);$type=strtolower($headers['content-type']??'text/plain');
    if(str_starts_with($type,'multipart/') && !str_starts_with(strtolower($headers['content-disposition']??''),'attachment')){
        $boundary=eml_parameter($headers['content-type'],'boundary');
        if(!$boundary || strlen($boundary)>200 || strpbrk($boundary,"\r\n")!==false)fail('Message MIME boundary is invalid.');
        preg_match_all('/^--'.preg_quote($boundary,'/').'(--)?[ \t]*(?:\r?\n|$)/m',$body,$matches,PREG_OFFSET_CAPTURE);
        $result=[];
        for($i=0;$i<count($matches[0])-1;$i++){
            if(($matches[1][$i][0]??'')==='--')break;
            $offset=$matches[0][$i][1]+strlen($matches[0][$i][0]);$child=substr($body,$offset,$matches[0][$i+1][1]-$offset);
            $child=preg_replace('/\r?\n$/','',$child);
            array_push($result,...attachment_mime_parts($child,($path===''?'':$path.'.').($i+1),$depth+1,$remaining));
        }
        return $result;
    }
    $part=attachment_part($headers,$path?:'1',strlen($body));$part['bytes']=$body;return [$part];
}
function attachment_cached(string $id): array {
    $q=db()->prepare('SELECT part,name,type,size FROM mail_files WHERE record_id=? ORDER BY rowid');$q->execute([$id]);
    return array_map(static fn($a)=>$a+['available'=>true],$q->fetchAll());
}
function attachment_store(string $id,array $part,string $bytes): void {
    if(strlen($bytes)>MAIL_FILE_LIMIT)fail('Attachments are limited to 10 MB per file.');
    $q=db()->prepare('INSERT INTO mail_files(record_id,part,name,type,size,data) VALUES(?,?,?,?,?,?) ON CONFLICT(record_id,part) DO UPDATE SET name=excluded.name,type=excluded.type,size=excluded.size,data=excluded.data');
    $q->execute([$id,$part['part'],attachment_name($part['name']),$part['type'],strlen($bytes),base64_encode($bytes)]);
}
function attachment_raw(array $r): ?string {
    $raw=isset($r['meta']['rawBase64'])?base64_decode($r['meta']['rawBase64'],true):($r['meta']['raw']??null);
    return is_string($raw)?$raw:null;
}
function attachment_manifest(array $r,?array $cachedFiles=null): array {
    if(!empty($r['meta']['filePartsLocal']))return $cachedFiles??(isset($r['id'])?attachment_cached($r['id']):[]);
    $parts=$r['meta']['mimeParts']??null;
    if($parts===null && ($raw=attachment_raw($r))!==null)$parts=attachment_mime_parts($raw);
    $cached=$cachedFiles??(isset($r['id'])?attachment_cached($r['id']):[]);$map=array_column($cached,null,'part');$result=[];
    foreach($parts??[] as $p)if($p['attachment']){
        $a=array_intersect_key($p,array_flip(['part','name','type','size','encodedSize']));$a['available']=isset($map[$p['part']]) || isset($p['bytes']);
        if(isset($p['bytes'])){try{$a['size']=strlen(attachment_decode($p['bytes'],$p['encoding']));}catch(HttpError){$a['available']=false;}}
        $result[]=$map[$p['part']]??$a;unset($map[$p['part']]);
    }
    return array_merge($result,array_values($map));
}
function attachment_bytes(array $r,string $part): array {
    $q=db()->prepare('SELECT * FROM mail_files WHERE record_id=? AND part=?');$q->execute([$r['id'],$part]);
    if($a=$q->fetch())return [$a,base64_decode($a['data'],true)];
    if(($raw=attachment_raw($r))!==null){foreach(attachment_mime_parts($raw) as $a)if($a['part']===$part && $a['attachment'])return [$a,attachment_decode($a['bytes'],$a['encoding'])];}
    foreach($r['meta']['mimeParts']??[] as $a)if($a['part']===$part && $a['attachment']){
        if(empty($r['meta']['remote']))fail('This file was not downloaded before the message became a local copy.',404);
        $bytes=attachment_remote_bytes($r,$a);attachment_store($r['id'],$a,$bytes);return [$a,$bytes];
    }
    fail('Attachment is unavailable. Refresh attachments and retry.',404);
}
function attachment_copy(string $from,string $to): void {
    db()->prepare('INSERT INTO mail_files(record_id,part,name,type,size,data) SELECT ?,part,name,type,size,data FROM mail_files WHERE record_id=?')->execute([$to,$from]);
}
function attachment_draft_files(array $r): array {
    $result=[];foreach(attachment_cached($r['id']) as $a){[$a,$bytes]=attachment_bytes($r,$a['part']);$a['bytes']=$bytes;$result[]=$a;}return $result;
}
function attachment_mime_body(string $body,array $files): string {
    if(!$files)return "Content-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n".chunk_split(base64_encode($body),76,"\r\n");
    $boundary='office-'.bin2hex(random_bytes(18));$raw='Content-Type: multipart/mixed; boundary="'.$boundary."\"\r\n\r\n--".$boundary."\r\n".attachment_mime_body($body,[]);
    foreach($files as $a){
        $name=rawurlencode(attachment_name($a['name']));$type=preg_match('~^[a-z0-9!#$&^_.+-]+/[a-z0-9!#$&^_.+-]+$~i',$a['type'])?$a['type']:'application/octet-stream';
        $raw.='--'.$boundary."\r\nContent-Type: ".$type."\r\nContent-Disposition: attachment; filename*=UTF-8''".$name."\r\nContent-Transfer-Encoding: base64\r\n\r\n".chunk_split(base64_encode($a['bytes']),76,"\r\n");
    }
    return $raw.'--'.$boundary."--\r\n";
}

/** Small bounded IMAP BODYSTRUCTURE reader (lists, quoted strings, NIL and literals). */
function attachment_imap_tree(string $source,array $literals=[]): array {
    $offset=0;$nodes=0;$literal=0;
    $read=function(int $depth) use (&$read,&$offset,&$nodes,&$literal,$source,$literals): mixed {
        if($depth>30 || ++$nodes>10000)fail('Message MIME structure exceeds the supported limit.');
        $length=strlen($source);while($offset<$length && ctype_space($source[$offset]))$offset++;
        if($offset>=$length)fail('Incomplete IMAP MIME structure.');
        $char=$source[$offset++];
        if($char==='('){$items=[];while(true){while($offset<$length && ctype_space($source[$offset]))$offset++;if($offset>=$length)fail('Incomplete IMAP MIME structure.');if($source[$offset]===')'){$offset++;return $items;}$items[]=$read($depth+1);}}
        if($char==='"'){$value='';while($offset<$length){$char=$source[$offset++];if($char==='"')return $value;if($char==='\\' && $offset<$length)$char=$source[$offset++];$value.=$char;}fail('Invalid IMAP MIME string.');}
        if($char==='{'){$end=strpos($source,"\r\n",$offset);if($end===false)fail('Invalid IMAP MIME literal.');$offset=$end+2;return $literals[$literal++]??throw new HttpError('Missing MIME literal.',400);}
        $start=$offset-1;while($offset<$length && !ctype_space($source[$offset]) && !str_contains('()',$source[$offset]))$offset++;
        $value=substr($source,$start,$offset-$start);return strtoupper($value)==='NIL'?null:$value;
    };
    $tree=$read(0);if(!is_array($tree))fail('Invalid IMAP MIME structure.');return $tree;
}
function attachment_imap_parts(array $tree,string $path='',int $depth=0): array {
    if($depth>20)fail('Message MIME structure exceeds the supported limit.');
    if(is_array($tree[0]??null)){
        $parts=[];foreach($tree as $i=>$child){if(!is_array($child))break;array_push($parts,...attachment_imap_parts($child,($path===''?'':$path.'.').($i+1),$depth+1));}return $parts;
    }
    $media=strtolower(($tree[0]??'application').'/'.($tree[1]??'octet-stream'));
    $parameter=static function(mixed $values): string {$text='';if(is_array($values))for($i=0;$i<count($values)-1;$i+=2){if(is_string($values[$i]) && is_string($values[$i+1]))$text.='; '.$values[$i].'="'.addcslashes($values[$i+1],'\\"').'"';}return $text;};
    $headers=['content-type'=>$media.$parameter($tree[2]??null),'content-transfer-encoding'=>strtolower((string)($tree[5]??''))];
    if(is_string($tree[3]??null))$headers['content-id']=$tree[3];
    $dispositionIndex=$media==='message/rfc822'?11:(str_starts_with($media,'text/')?9:8);
    $disposition=$tree[$dispositionIndex]??null;
    if(is_array($disposition))$headers['content-disposition']=strtolower((string)($disposition[0]??'')).$parameter($disposition[1]??null);
    $part=attachment_part($headers,$path?:'1',(int)($tree[6]??0));
    // The server reports encoded octets. Make that distinction explicit in the UI.
    $part['encodedSize']=true;return [$part];
}
function attachment_gmail_parts(array $payload,int $depth=0,?int &$remaining=null): array {
    if($remaining===null)$remaining=500;if($depth>20 || --$remaining<0)fail('Message MIME structure exceeds the supported limit.');
    if(!empty($payload['parts']) && str_starts_with(strtolower($payload['mimeType']??''),'multipart/')){
        $result=[];foreach($payload['parts'] as $p)array_push($result,...attachment_gmail_parts($p,$depth+1,$remaining));return $result;
    }
    $headers=[];foreach($payload['headers']??[] as $h)$headers[strtolower($h['name'])]=$h['value'];
    $headers['content-type']??=$payload['mimeType']??'application/octet-stream';
    if(!empty($payload['filename']) && !isset($headers['content-disposition']))$headers['content-disposition']='attachment; filename="'.addcslashes($payload['filename'],'\\"').'"';
    $p=attachment_part($headers,(string)($payload['partId']??'0'),(int)($payload['body']['size']??0));
    $p['gmailAttachment']=$payload['body']['attachmentId']??null;
    // Gmail's inline data is already base64url encoded, irrespective of MIME transfer encoding.
    if(isset($payload['body']['data']))$p['gmailData']=$payload['body']['data'];
    return [$p];
}
function attachment_imap_open(array $r,mixed $s): string {
    $m=$r['meta'];$uid=(string)($m['providerId']??'');$path=$m['serverFolder']??'';
    if(!ctype_digit($uid) || !$path)fail('Message identifiers are unavailable. Refresh the folder.');
    $validity=imap_validity(imap_command($s,'EXAMINE '.imap_quote($path)));
    if(mail_source($path,$validity,$uid)!==mail_row_source($r))fail('Mailbox identifiers changed. Sync before downloading attachments.',409);
    return $uid;
}
function attachment_imap_metadata(array $r,mixed $s): array {
    $uid=attachment_imap_open($r,$s);$response=imap_command($s,'UID FETCH '.$uid.' (UID BODYSTRUCTURE)');
    $text=implode('',$response['lines']);
    $literalOffset=0;
    foreach(preg_split('/(?=^\* \d+ FETCH)/mi',$text) as $tuple){
        $literalCount=preg_match_all('/\{\d+\}\r\n/',$tuple);
        if(preg_match('/\bUID\s+'.preg_quote($uid,'/').'(?=\s|\))/i',$tuple) && preg_match('/\bBODYSTRUCTURE\s+(\(.*)/is',$tuple,$match))return attachment_imap_parts(attachment_imap_tree($match[1],array_slice($response['literals'],$literalOffset,$literalCount)));
        $literalOffset+=$literalCount;
    }
    fail('Message structure is unavailable. Refresh the folder.');
}
function attachment_imap_file(array $r,mixed $s,array $part): string {
    $uid=attachment_imap_open($r,$s);if(!preg_match('/^\d+(?:\.\d+)*$/D',$part['part']))fail('Invalid MIME part.');
    $response=imap_command($s,'UID FETCH '.$uid.' (UID BODY.PEEK['.$part['part'].'])',15*1024*1024);
    $bytes=imap_fetch_content($response,$uid,$part['part']);if($bytes===null)fail('Attachment is no longer available. Refresh the folder.',409);
    return attachment_decode($bytes,$part['encoding']);
}
function attachment_discover(array $record): array {
    $r=get_record($record['id']);if($r['kind']!=='mail')fail('Choose a mail message.');
    if(attachment_raw($r)!==null || isset($r['meta']['mimeParts']) || empty($r['meta']['remote']))return $r;
    if(in_array($r['meta']['folder']??'',['Recovery copies','Not in Inbox'],true))fail('Message is no longer in its synchronized folder.');
    $a=account($r['meta']['account']);
    if($a['type']==='imap')$parts=imap_with_connection($a,fn($s)=>attachment_imap_metadata($r,$s));
    elseif($a['type']==='google'){
        $msg=google_json('https://gmail.googleapis.com/gmail/v1/users/me/messages/'.rawurlencode($r['meta']['providerId']).'?format=full',google_token($a));
        if(!isset($msg['payload']))fail('Message structure is unavailable.');$parts=attachment_gmail_parts($msg['payload']);
    }else fail('Choose a mail account.');
    if(count($parts)>500)fail('Too many MIME parts.');
    $r['meta']['mimeParts']=$parts;$r['meta']['hasAttachments']=(bool)array_filter($parts,fn($p)=>$p['attachment']);
    return save_record($r,true);
}
function attachment_remote_bytes(array $r,array $part): string {
    $a=account($r['meta']['account']);
    if($part['size']>MAIL_FILE_LIMIT*1.4+1024)fail('Attachments are limited to 10 MB per file.');
    if($a['type']==='imap')return imap_with_connection($a,fn($s)=>attachment_imap_file($r,$s,$part));
    if($a['type']==='google'){
        if(isset($part['gmailAttachment'])){
            $url='https://gmail.googleapis.com/gmail/v1/users/me/messages/'.rawurlencode($r['meta']['providerId']).'/attachments/'.rawurlencode($part['gmailAttachment']);
            $response=web_request($url,'GET',['Authorization: Bearer '.google_token($a)],null,15*1024*1024);
            $data=json_decode($response['body'],true,64,JSON_THROW_ON_ERROR)['data']??null;
        }else $data=$part['gmailData']??null;
        if(!is_string($data))fail('Attachment data is unavailable.');
        return attachment_decode(strtr($data,'-_','+/'),'base64');
    }
    fail('Choose a mail account.');
}
function attachment_large_body(array $r): array {
    $r=attachment_discover($r);$bodies=[];$remaining=IMAP_BODY_LIMIT;
    foreach($r['meta']['mimeParts']??[] as $p)if(!$p['attachment'] && in_array($p['type'],['text/plain','text/html'],true)){
        if($p['size']>$remaining)continue;
        $bytes=attachment_remote_bytes($r,$p);$remaining-=strlen($bytes);if($remaining<0)fail('Message text exceeds the body download limit.');
        $bodies[$p['type']]='Content-Type: '.$p['headers']['content-type']."\r\nContent-Transfer-Encoding: base64\r\n\r\n".chunk_split(base64_encode($bytes),76,"\r\n");
    }
    if(!$bodies)$bodies['text/plain']="Content-Type: text/plain\r\n\r\nNo readable message body was found. Files are available in Attachments.\r\n";
    $boundary='office-body-'.bin2hex(random_bytes(12));$raw='Content-Type: multipart/alternative; boundary="'.$boundary."\"\r\n\r\n";
    foreach($bodies as $body)$raw.='--'.$boundary."\r\n".$body;$raw.='--'.$boundary."--\r\n";
    $parsed=parse_eml($raw);$r['body']=$parsed['body'];$r['meta']['hasHtml']=$parsed['meta']['hasHtml'];$r['meta']['bodyRawBase64']=base64_encode($raw);unset($r['meta']['headerOnly']);
    return save_record($r,true);
}
function attachment_prepare(array $r,?string $part=null): array {
    $files=attachment_manifest($r);$total=0;
    foreach($files as $a){if($part!==null && $a['part']!==$part)continue;$total+=$a['size'];if($total>MAIL_FILE_TOTAL*1.4)fail('Save all is limited to 20 MB. Download files individually.');}
    $found=false;$total=0;
    foreach($files as $a){if($part!==null && $a['part']!==$part)continue;[$a,$bytes]=attachment_bytes($r,$a['part']);$total+=strlen($bytes);if($total>MAIL_FILE_TOTAL)fail('Save all is limited to 20 MB. Download files individually.');attachment_store($r['id'],$a,$bytes);$found=true;}
    if($part!==null && !$found)fail('Attachment was not found.',404);
    return attachment_manifest(get_record($r['id']));
}
function attachment_zip(array $r): string {
    $zip='';$directory='';$used=[];$count=0;$total=0;
    foreach(attachment_manifest($r) as $a){
        if(empty($a['available']))fail('Prepare all attachments before downloading the ZIP.');
        [$a,$bytes]=attachment_bytes($r,$a['part']);$total+=strlen($bytes);if($total>MAIL_FILE_TOTAL || ++$count>500)fail('Save all exceeds its supported limit.');
        $name=attachment_name($a['name']);$base=$name;$suffix=1;while(isset($used[strtolower($name)])){$name=pathinfo($base,PATHINFO_FILENAME).' ('.(++$suffix).')'.(($ext=pathinfo($base,PATHINFO_EXTENSION))!==''?'.'.$ext:'');}$used[strtolower($name)]=true;
        $offset=strlen($zip);$size=strlen($bytes);$crc=crc32($bytes);
        $zip.=pack('VvvvvvVVVvv',0x04034b50,20,0x800,0,0,33,$crc,$size,$size,strlen($name),0).$name.$bytes;
        $directory.=pack('VvvvvvvVVVvvvvvVV',0x02014b50,20,20,0x800,0,0,33,$crc,$size,$size,strlen($name),0,0,0,0,0,$offset).$name;
    }
    return $zip.$directory.pack('VvvvvVVv',0x06054b50,0,0,$count,$count,strlen($directory),strlen($zip),0);
}
function attachment_request(array $input): array {
    $r=get_record((string)($input['id']??''));if($r['kind']!=='mail')fail('Choose mail.');$action=$input['action']??'list';
    if(in_array($action,['upload','remove'],true)){
        $db=db();$db->beginTransaction();
        try{
            $r=get_record($r['id']);if(!empty($r['meta']['remote']) || ($r['meta']['folder']??'')!=='Drafts')fail('Choose a saved draft.');
            if($r['revision']!==(int)($input['revision']??0))fail('Draft changed. Reopen it before changing attachments.',409);
            if($action==='remove')$db->prepare('DELETE FROM mail_files WHERE record_id=? AND part=?')->execute([$r['id'],(string)($input['part']??'')]);
            else {
                $bytes=base64_decode((string)($input['data']??''),true);if($bytes===false)fail('Invalid attachment upload.');
                $files=attachment_cached($r['id']);if(count($files)>=100 || array_sum(array_column($files,'size'))+strlen($bytes)>MAIL_FILE_TOTAL)fail('A draft supports up to 100 attachments and 20 MB total.');
                $type=(string)($input['type']??'application/octet-stream');if(!preg_match('~^[a-z0-9!#$&^_.+-]+/[a-z0-9!#$&^_.+-]+$~i',$type))$type='application/octet-stream';
                attachment_store($r['id'],['part'=>'file-'.bin2hex(random_bytes(12)),'name'=>(string)($input['name']??'attachment'),'type'=>$type],$bytes);
            }
            unset($r['meta']['attachments']);$r['meta']['hasAttachments']=(bool)attachment_cached($r['id']);$r=save_record($r);$db->commit();
        }catch(Throwable $e){if($db->inTransaction())$db->rollBack();throw $e;}
        return ['record'=>$r,'attachments'=>attachment_manifest($r)];
    }
    $r=attachment_discover($r);
    if($action==='prepare')$files=attachment_prepare($r,isset($input['part'])?(string)$input['part']:null);
    elseif($action==='forward'){
        attachment_prepare($r);
        $db=db();$db->beginTransaction();
        try{
            $draft=save_record(['kind'=>'mail','title'=>preg_match('/^Fwd:/i',$r['title'])?$r['title']:'Fwd: '.$r['title'],'body'=>"\n\n---------- Forwarded message ----------\nFrom: ".($r['meta']['from']??'')."\nDate: ".($r['meta']['date']??'')."\nSubject: ".$r['title']."\n\n".$r['body'],'meta'=>['folder'=>'Drafts','sendAccount'=>$r['meta']['account']??$r['meta']['sendAccount']??'','hasAttachments'=>(bool)attachment_manifest($r)]]);
            attachment_copy($r['id'],$draft['id']);$db->commit();$draft=get_record($draft['id']);
        }catch(Throwable $e){if($db->inTransaction())$db->rollBack();throw $e;}
        return ['record'=>$draft,'attachments'=>attachment_manifest($draft)];
    }elseif($action==='list')$files=attachment_manifest($r);else fail('Unknown attachment action.');
    return ['record'=>$r,'attachments'=>$files];
}
