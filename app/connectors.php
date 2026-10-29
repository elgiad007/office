<?php
declare(strict_types=1);

function public_host(string $host): string {
    if (!preg_match('/^[a-zA-Z0-9.-]{1,253}$/D',$host)) fail('Use a public DNS hostname.');
    $ips=gethostbynamel($host);
    if (!$ips) fail('Cannot resolve server hostname.');
    foreach ($ips as $ip) if (!filter_var($ip,FILTER_VALIDATE_IP,FILTER_FLAG_NO_PRIV_RANGE|FILTER_FLAG_NO_RES_RANGE)) fail('Private/reserved servers are not supported.');
    return $ips[0];
}
function web_request(string $url, string $method='GET', array $headers=[], ?string $body=null): array {
    if (!extension_loaded('curl')) fail('The cURL extension is required for this connector.');
    $p=parse_url($url);
    if (!$p || ($p['scheme']??'')!=='https' || empty($p['host']) || isset($p['user']) || isset($p['pass']) || isset($p['fragment'])) fail('Use an HTTPS endpoint without embedded credentials.');
    $port=(int)($p['port']??443); if (!in_array($port,[443,8443],true)) fail('HTTPS ports 443 or 8443 are supported.');
    $ip=public_host($p['host']); $ch=curl_init($url); $response='';
    curl_setopt_array($ch,[CURLOPT_RETURNTRANSFER=>false,CURLOPT_CUSTOMREQUEST=>$method,CURLOPT_HTTPHEADER=>$headers,CURLOPT_CONNECTTIMEOUT=>5,CURLOPT_TIMEOUT=>18,CURLOPT_FOLLOWLOCATION=>false,CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS,CURLOPT_RESOLVE=>[$p['host'].':'.$port.':'.$ip],CURLOPT_WRITEFUNCTION=>static function($ch,$chunk) use (&$response) { if (strlen($response)+strlen($chunk)>8*1024*1024) return 0; $response.=$chunk; return strlen($chunk); }]);
    if ($body!==null) curl_setopt($ch,CURLOPT_POSTFIELDS,$body);
    $ok=curl_exec($ch); $status=(int)curl_getinfo($ch,CURLINFO_RESPONSE_CODE);
    if ($ok===false) fail('Provider connection failed or exceeded its response limit.');
    if ($status<200 || $status>=300) fail('Provider returned HTTP '.$status.'. Check the account permissions and endpoint.');
    return ['status'=>$status,'body'=>$response];
}
function google_json(string $url,string $token,string $method='GET',?array $body=null): array {
    $r=web_request($url,$method,['Authorization: Bearer '.$token,'Content-Type: application/json'],$body===null?null:json_encode($body,JSON_THROW_ON_ERROR));
    return json_decode($r['body'],true,512,JSON_THROW_ON_ERROR);
}
function account(string $id): array {
    $q=db()->prepare('SELECT * FROM accounts WHERE id=?'); $q->execute([$id]); $r=$q->fetch(); if (!$r) fail('Account not found.',404);
    $r['config']=json_decode($r['config'],true,64,JSON_THROW_ON_ERROR); $r['credentials']=decrypt_secret($r['secret']); return $r;
}
function google_token(array &$a): string {
    $s=$a['credentials']; if (empty($s['refresh_token'])) fail('Connect this Google account first.');
    if (($s['expires']??0)>time()+60) return $s['access_token'];
    $r=web_request('https://oauth2.googleapis.com/token','POST',['Content-Type: application/x-www-form-urlencoded'],http_build_query(['client_id'=>$s['client_id'],'client_secret'=>$s['client_secret'],'refresh_token'=>$s['refresh_token'],'grant_type'=>'refresh_token']));
    $t=json_decode($r['body'],true,64,JSON_THROW_ON_ERROR); if (empty($t['access_token'])) fail('Google authorization expired. Reconnect.');
    $s['access_token']=$t['access_token']; $s['expires']=time()+(int)$t['expires_in'];
    db()->prepare('UPDATE accounts SET secret=? WHERE id=?')->execute([encrypt_secret($s),$a['id']]); $a['credentials']=$s; return $s['access_token'];
}
function remote_id(string $account,string $source): string { return 'remote_'.substr(hash('sha256',$account.'|'.$source),0,48); }
function cache_remote(array $a,string $source,string $kind,string $title,string $body,array $meta): void {
    save_record(['id'=>remote_id($a['id'],$source),'kind'=>$kind,'title'=>$title ?: '(Untitled)','body'=>$body,'meta'=>$meta+['remote'=>true,'account'=>$a['id'],'source'=>$source,'accountLabel'=>$a['label']]],true);
}
function sync_google(array &$a): int {
    $token=google_token($a); $base='https://gmail.googleapis.com/gmail/v1/users/me/messages';
    $list=google_json($base.'?'.http_build_query(['maxResults'=>10,'labelIds'=>'INBOX']),$token); $count=0; $deadline=microtime(true)+18;
    foreach ($list['messages']??[] as $m) {
        if (microtime(true)>$deadline) break;
        $msg=google_json($base.'/'.rawurlencode($m['id']).'?format=raw',$token);
        $raw=base64_decode(strtr($msg['raw'],'-_','+/'),true); if ($raw===false || strlen($raw)>1400000) continue;
        $parsed=parse_eml($raw);
        cache_remote($a,'gmail:'.$m['id'],'mail',$parsed['title'],$parsed['body'],$parsed['meta']+['rawBase64'=>base64_encode($raw),'providerId'=>$m['id'],'read'=>!in_array('UNREAD',$msg['labelIds']??[],true),'folder'=>'Inbox']); $count++;
    }
    if (($a['config']['calendar'] ?? true) === false) return $count;
    $start=gmdate('Y-m-d\T00:00:00\Z',time()-7*86400); $end=gmdate('Y-m-d\T00:00:00\Z',time()+90*86400);
    $events=google_json('https://www.googleapis.com/calendar/v3/calendars/primary/events?'.http_build_query(['timeMin'=>$start,'timeMax'=>$end,'singleEvents'=>'true','orderBy'=>'startTime','maxResults'=>100]),$token);
    foreach ($events['items']??[] as $e) {
        if (($e['status']??'')==='cancelled') continue;
        cache_remote($a,'google-event:'.$e['id'],'calendar',$e['summary']??'(Untitled)',$e['description']??'',['start'=>$e['start']['dateTime']??$e['start']['date']??'','end'=>$e['end']['dateTime']??$e['end']['date']??'','location'=>$e['location']??'','providerId'=>$e['id']]); $count++;
    }
    return $count;
}
function sync_caldav(array $a): int {
    if (!class_exists('DOMDocument')) fail('The DOM extension is required for CalDAV.');
    $start=gmdate('Ymd\T000000\Z',time()-7*86400); $end=gmdate('Ymd\T000000\Z',time()+90*86400);
    $xml='<?xml version="1.0"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="'.$start.'" end="'.$end.'"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>';
    $auth=base64_encode($a['credentials']['username'].':'.$a['credentials']['password']);
    $r=web_request($a['config']['url'],'REPORT',['Depth: 1','Content-Type: application/xml; charset=utf-8','Authorization: Basic '.$auth],$xml);
    $doc=new DOMDocument(); $previous=libxml_use_internal_errors(true);
    try { if (!$doc->loadXML($r['body'],LIBXML_NONET) || $doc->doctype) fail('Invalid calendar response.'); }
    finally { libxml_clear_errors(); libxml_use_internal_errors($previous); }
    $xp=new DOMXPath($doc); $xp->registerNamespace('d','DAV:'); $xp->registerNamespace('c','urn:ietf:params:xml:ns:caldav'); $count=0;
    foreach ($xp->query('//d:response') as $node) {
        $ics=$xp->evaluate('string(.//c:calendar-data)',$node); if (!$ics) continue;
        $href=$xp->evaluate('string(d:href)',$node);
        foreach (parse_ics($ics) as $index=>$e) { cache_remote($a,$href.'#'.$index,'calendar',$e['title'],$e['body'],$e['meta']+['raw'=>$ics]); $count++; if ($count>=100) break 2; }
    }
    return $count;
}
function socket_connection(string $host,int $port): mixed {
    if (!in_array($port,[993,465],true)) fail('Only implicit TLS IMAP (993) and SMTP (465) are supported initially.');
    $ip=public_host($host); $context=stream_context_create(['ssl'=>['peer_name'=>$host,'verify_peer'=>true,'verify_peer_name'=>true,'SNI_enabled'=>true]]);
    $s=@stream_socket_client('tls://'.$ip.':'.$port,$errno,$error,5,STREAM_CLIENT_CONNECT,$context);
    if (!$s) fail('TLS connection failed. Check hostname, port and hosting permissions.'); stream_set_timeout($s,8); return $s;
}
function write_all(mixed $s,string $data): void {
    while ($data!=='') { $n=fwrite($s,$data); if ($n===false || $n===0) fail('Provider connection interrupted.'); $data=substr($data,$n); }
}
function imap_quote(string $value): string { if (preg_match('/[\r\n\x00]/',$value)) fail('Invalid account credential.'); return '"'.addcslashes($value,'\\"').'"'; }
function imap_command(mixed $s,string $command): array {
    static $sequence=0; $tag='A'.(++$sequence); write_all($s,$tag.' '.$command."\r\n"); $lines=[]; $literals=[]; $total=0;
    while (($line=fgets($s,65536))!==false) {
        $total+=strlen($line); if ($total>3*1024*1024) fail('Email exceeds the initial download limit.');
        $lines[]=$line;
        if (preg_match('/\{(\d+)\}\r\n$/',$line,$m)) {
            $remaining=(int)$m[1]; if ($remaining>1400000) fail('Email exceeds the initial 1.4 MB download limit.'); $literal='';
            while ($remaining>0) { $part=fread($s,min(65536,$remaining)); if ($part===false || $part==='') fail('Incomplete email download.'); $literal.=$part; $remaining-=strlen($part); }
            $literals[]=$literal; $total+=strlen($literal);
        }
        if (str_starts_with($line,$tag.' ')) { if (!str_starts_with($line,$tag.' OK')) fail('IMAP command refused. Check account settings.'); return ['lines'=>$lines,'literals'=>$literals]; }
    }
    fail('IMAP connection timed out.');
}
function sync_imap(array $a): int {
    $deadline=microtime(true)+18;
    $s=socket_connection($a['config']['host'],993);
    try {
        if (!str_starts_with((string)fgets($s,65536),'* OK')) fail('Unexpected IMAP greeting.');
        imap_command($s,'LOGIN '.imap_quote($a['credentials']['username']).' '.imap_quote($a['credentials']['password']));
        $select=imap_command($s,'SELECT INBOX'); $validity=''; foreach ($select['lines'] as $line) if (preg_match('/UIDVALIDITY (\d+)/',$line,$m)) $validity=$m[1];
        if (!$validity) fail('IMAP server did not provide UIDVALIDITY.');
        $found=imap_command($s,'UID SEARCH ALL'); $ids=[];
        foreach ($found['lines'] as $line) if (preg_match('/^\* SEARCH (.*)/',$line,$m)) $ids=preg_split('/\s+/',trim($m[1]));
        $count=0;
        foreach (array_slice(array_filter($ids,fn($id)=>ctype_digit((string)$id)),-10) as $id) {
            if (microtime(true)>$deadline) break;
            $fetch=imap_command($s,'UID FETCH '.$id.' (FLAGS BODY.PEEK[])'); $raw=$fetch['literals'][0]??''; if (!$raw) continue; $p=parse_eml($raw);
            cache_remote($a,'imap:'.$validity.':'.$id,'mail',$p['title'],$p['body'],$p['meta']+['rawBase64'=>base64_encode($raw),'read'=>str_contains(implode('',$fetch['lines']),'\\Seen'),'folder'=>'Inbox','providerId'=>$id]); $count++;
        }
        return $count;
    } finally { fclose($s); }
}
function smtp_expect(mixed $s,array $allowed): void {
    $line=''; $count=0;
    do { $line=fgets($s,8192); if ($line===false || ++$count>100) fail('SMTP connection interrupted. Delivery may be uncertain; check Sent before retrying.'); } while (isset($line[3]) && $line[3]==='-');
    if (!in_array((int)substr($line,0,3),$allowed,true)) fail('SMTP server rejected this operation.');
}
function remote_mail_action(array $r,string $action): array {
    if ($r['kind']!=='mail' || empty($r['meta']['remote'])) fail('Choose a synced message.');
    $a=account($r['meta']['account']); $id=(string)$r['meta']['providerId'];
    if (!in_array($action,['archive','read','unread'],true)) fail('Unknown mail action.');
    if ($a['type']==='google') {
        $changes=match($action) { 'archive'=>['removeLabelIds'=>['INBOX']], 'read'=>['removeLabelIds'=>['UNREAD']], 'unread'=>['addLabelIds'=>['UNREAD']] };
        google_json('https://gmail.googleapis.com/gmail/v1/users/me/messages/'.rawurlencode($id).'/modify',google_token($a),'POST',$changes);
    } elseif ($a['type']==='imap') {
        if (($r['meta']['folder']??'')!=='Inbox') fail('IMAP operations are available on cached Inbox messages only.');
        if (!ctype_digit($id)) fail('Invalid IMAP message identifier.');
        $s=socket_connection($a['config']['host'],993);
        try {
            if (!str_starts_with((string)fgets($s,65536),'* OK')) fail('Unexpected IMAP greeting.');
            imap_command($s,'LOGIN '.imap_quote($a['credentials']['username']).' '.imap_quote($a['credentials']['password']));
            $select=imap_command($s,'SELECT INBOX'); $validity='';foreach ($select['lines'] as $line) if(preg_match('/UIDVALIDITY (\d+)/',$line,$m))$validity=$m[1];
            if ($r['meta']['source']!=='imap:'.$validity.':'.$id) fail('Mailbox identifiers changed. Remove/reconnect this account before processing cached messages.');
            // MOVE is atomic on supporting servers; never fall back to a broad EXPUNGE.
            if ($action==='archive') imap_command($s,'UID MOVE '.$id.' '.imap_quote($a['config']['archiveFolder']??'Archive'));
            else imap_command($s,'UID STORE '.$id.' '.($action==='read'?'+':'-').'FLAGS.SILENT (\\Seen)');
        } finally { fclose($s); }
    } else fail('This connector does not support email actions.');
    // Merge only this action's field, so a concurrent read/archive operation cannot undo the other.
    $path=$action==='archive'?'$.folder':'$.read'; $value=$action==='archive'?'Archive':$action==='read';
    $q=db()->prepare('UPDATE records SET meta=json_set(meta,?,json(?)),revision=revision+1,updated=? WHERE id=?');
    $q->execute([$path,json_encode($value),gmdate('c'),$r['id']]);
    if (!$q->rowCount()) fail('The cached item was removed while the provider action completed.',409);
    return get_record($r['id']);
}
function send_mail(array $a,string $to,string $subject,string $body): string {
    $from=$a['config']['email']??'';
    foreach ([$from,$to] as $address) if (!filter_var($address,FILTER_VALIDATE_EMAIL) || preg_match('/[\r\n]/',$address)) fail('A valid sender and recipient email are required.');
    if (!$subject || preg_match('/[\r\n]/',$subject)) fail('Subject must be one line.');
    $raw='From: '.$from."\r\nTo: ".$to."\r\nSubject: =?UTF-8?B?".base64_encode($subject)."?=\r\nDate: ".gmdate('D, d M Y H:i:s +0000')."\r\nMessage-ID: <".bin2hex(random_bytes(16))."@".substr(strrchr($from,'@'),1).">\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n".chunk_split(base64_encode($body),76,"\r\n");
    if ($a['type']==='google') { google_json('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',google_token($a),'POST',['raw'=>rtrim(strtr(base64_encode($raw),'+/','-_'),'=')]); return $raw; }
    if ($a['type']!=='imap') fail('This account cannot send email.');
    $s=socket_connection($a['config']['smtp'],465);
    try {
        smtp_expect($s,[220]); write_all($s,"EHLO portable-office.local\r\n"); smtp_expect($s,[250]);
        write_all($s,'AUTH PLAIN '.base64_encode("\0".$a['credentials']['username']."\0".$a['credentials']['password'])."\r\n"); smtp_expect($s,[235]);
        write_all($s,'MAIL FROM:<'.$from.">\r\n"); smtp_expect($s,[250]); write_all($s,'RCPT TO:<'.$to.">\r\n"); smtp_expect($s,[250,251]);
        write_all($s,"DATA\r\n"); smtp_expect($s,[354]); write_all($s,$raw."\r\n.\r\n"); smtp_expect($s,[250]); write_all($s,"QUIT\r\n");
    } finally { fclose($s); }
    return $raw;
}
