<?php
declare(strict_types=1);
require_once __DIR__.'/mail-sync.php';
require_once __DIR__.'/activity.php';

function public_host(string $host): string {
    if (!preg_match('/^[a-zA-Z0-9.-]{1,253}$/D',$host)) fail('Use a public DNS hostname.');
    $ips=gethostbynamel($host);
    if (!$ips) fail('Cannot resolve server hostname.');
    foreach ($ips as $ip) if (!public_ipv4($ip)) fail('Private/reserved servers are not supported.');
    return $ips[0];
}
function web_request(string $url, string $method='GET', array $headers=[], ?string $body=null,int $limit=8388608): array {
    if (!extension_loaded('curl')) fail('The cURL extension is required for this connector.');
    $p=parse_url($url);
    if (!$p || ($p['scheme']??'')!=='https' || empty($p['host']) || isset($p['user']) || isset($p['pass']) || isset($p['fragment'])) fail('Use an HTTPS endpoint without embedded credentials.');
    $port=(int)($p['port']??443); if (!in_array($port,[443,8443],true)) fail('HTTPS ports 443 or 8443 are supported.');
    $ip=public_host($p['host']); $ch=curl_init($url); $response='';
    curl_setopt_array($ch,[CURLOPT_RETURNTRANSFER=>false,CURLOPT_CUSTOMREQUEST=>$method,CURLOPT_HTTPHEADER=>$headers,CURLOPT_CONNECTTIMEOUT=>5,CURLOPT_TIMEOUT=>30,CURLOPT_FOLLOWLOCATION=>false,CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS,CURLOPT_PROXY=>'',CURLOPT_RESOLVE=>[$p['host'].':'.$port.':'.$ip],CURLOPT_WRITEFUNCTION=>static function($ch,$chunk) use (&$response,$limit) { if (strlen($response)+strlen($chunk)>$limit) return 0; $response.=$chunk; return strlen($chunk); }]);
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
    $s=refresh_google_credentials($a['credentials']);
    if ($s!==$a['credentials']) {
        db()->prepare('UPDATE accounts SET secret=? WHERE id=?')->execute([encrypt_secret($s),$a['id']]);
        $a['credentials']=$s;
    }
    return $s['access_token'];
}
function refresh_google_credentials(array $s): array {
    if (empty($s['refresh_token'])) fail('Connect this Google account first.');
    if (($s['expires']??0)>time()+60) return $s;
    $r=web_request('https://oauth2.googleapis.com/token','POST',['Content-Type: application/x-www-form-urlencoded'],http_build_query(['client_id'=>$s['client_id'],'client_secret'=>$s['client_secret'],'refresh_token'=>$s['refresh_token'],'grant_type'=>'refresh_token']));
    $t=json_decode($r['body'],true,64,JSON_THROW_ON_ERROR); if (empty($t['access_token'])) fail('Google authorization expired. Reconnect.');
    $s['access_token']=$t['access_token']; $s['expires']=time()+(int)$t['expires_in'];
    return $s;
}
function remote_id(string $account,string $source): string { return 'remote_'.substr(hash('sha256',$account.'|'.$source),0,48); }
function cache_remote(array $a,string $source,string $kind,string $title,string $body,array $meta): void {
    save_record(['id'=>remote_id($a['id'],$source),'kind'=>$kind,'title'=>$title ?: '(Untitled)','body'=>$body,'meta'=>$meta+['remote'=>true,'account'=>$a['id'],'source'=>$source,'accountLabel'=>$a['label']]],true);
}
function sync_google(array &$a,bool $repair=false): int {
    $token=google_token($a); $base='https://gmail.googleapis.com/gmail/v1/users/me/messages';
    $count=sync_google_mail($a,static fn(string $path):array=>google_json($base.$path,$token),$repair);
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
    activity_step(($port===993?'IMAP':'SMTP').': connecting securely to '.$host.':'.$port.'.');
    $s=@stream_socket_client('tls://'.$ip.':'.$port,$errno,$error,10,STREAM_CLIENT_CONNECT,$context);
    if (!$s) throw new ImapTransportError('Secure connection could not be established.'); stream_set_timeout($s,20);
    activity_step($port===993?'IMAP: secure connection established.':'SMTP: secure connection established.');return $s;
}
class ImapTransportError extends HttpError {}
function imap_stage(string $command): string {
    preg_match('/^(UID\s+)?([A-Z]+)/i',$command,$m);
    return match(strtoupper($m[2]??'')) {
        'LOGIN','AUTHENTICATE'=>'signing in','CAPABILITY'=>'checking server capabilities','LIST','XLIST'=>'listing folders',
        'SELECT','EXAMINE'=>'opening folder','STATUS'=>'checking folder status','SEARCH'=>'finding messages',
        'FETCH'=>'reading message data','MOVE'=>'moving message','COPY'=>'copying message','STORE'=>'updating message flags',
        'CREATE'=>'creating folder','RENAME'=>'renaming folder','DELETE'=>'removing folder',default=>'waiting for server',
    };
}
function imap_transport_failure(mixed $s,string $stage): never {
    $meta=stream_get_meta_data($s);
    $reason=!empty($meta['timed_out'])?'timed out':(!empty($meta['eof'])?'connection closed':'connection interrupted');
    activity_step('IMAP: '.$reason.' while '.$stage.'.','error');
    throw new ImapTransportError('IMAP '.$reason.' while '.$stage.'.');
}
function write_all(mixed $s,string $data): void {
    while ($data!=='') { $n=fwrite($s,$data); if ($n===false || $n===0) fail('Provider connection interrupted.'); $data=substr($data,$n); }
}
function imap_quote(string $value): string { if (preg_match('/[\r\n\x00]/',$value)) fail('Invalid account credential.'); return '"'.addcslashes($value,'\\"').'"'; }
function imap_command(mixed $s,string $command,int $literalLimit=1400000): array {
    static $sequence=0;$stage=imap_stage($command);$started=microtime(true);
    // Batch completion retains timing; repetitive sync FETCH starts add no useful progress.
    if($stage!=='reading message data' || !in_array($GLOBALS['office_activity']['operation']??'',['Synchronize account','Refresh folder'],true))activity_step('IMAP: '.$stage.'.');
    if(preg_match('/^(?:UID\s+)?(?:MOVE|COPY|STORE|CREATE|DELETE|RENAME|EXPUNGE|APPEND)\b/i',$command))$GLOBALS['office_imap_mutated']=true;
    $remaining=($GLOBALS['office_imap_deadline']??(microtime(true)+50))-microtime(true);
    if($remaining<=0)throw new ImapTransportError('IMAP operation exceeded its time limit while '.$stage.'.');
    $tag='A'.(++$sequence);
    try{write_all($s,$tag.' '.$command."\r\n");}catch(HttpError){imap_transport_failure($s,$stage);}
    if(str_contains(stream_get_meta_data($s)['stream_type']??'','tcp_socket'))stream_set_timeout($s,max(1,min(20,(int)$remaining)));
    $lines=[]; $literals=[]; $total=0;
    while (($line=fgets($s,65536))!==false) {
        $total+=strlen($line); if ($total>max(3*1024*1024,$literalLimit+1048576)) fail('Email exceeds the download limit.');
        $lines[]=$line;
        if (preg_match('/\{(\d+)\}\r\n$/',$line,$m)) {
            $remaining=(int)$m[1]; if ($remaining>$literalLimit) fail('Email part exceeds the download limit.'); $literal='';
            while ($remaining>0) { $part=fread($s,min(65536,$remaining)); if ($part===false || $part==='') imap_transport_failure($s,$stage); $literal.=$part; $remaining-=strlen($part); }
            $literals[]=$literal; $total+=strlen($literal);
        }
        if (str_starts_with($line,$tag.' ')) {
            if (!preg_match('/^'.preg_quote($tag,'/').' OK(?:\s|$)/i',$line)) {
                // Never echo commands or arbitrary server text: either can contain credentials.
                preg_match('/^([A-Z]+)(?:\s+([A-Z]+))?/i',$command,$operation);
                $name=strtoupper($operation[1]??'command');
                if ($name==='UID') $name.=' '.strtoupper($operation[2]??'command');
                preg_match('/^'.preg_quote($tag,'/').' (NO|BAD)(?:\s+\[([A-Z]+)(?:\s[^\]]*)?\])?/i',$line,$status);
                $code=strtoupper($status[2]??'');
                if (!in_array($code,['TRYCREATE','NONEXISTENT','NOPERM','AUTHORIZATIONFAILED','OVERQUOTA','AUTHENTICATIONFAILED'],true)) $code='';
                $hint=match($code) {
                    'TRYCREATE','NONEXISTENT'=>'The destination folder does not exist. Check the archive folder path in account setup.',
                    'NOPERM','AUTHORIZATIONFAILED'=>'The server denied permission for this operation.',
                    'OVERQUOTA'=>'The mailbox storage quota is exceeded.',
                    'AUTHENTICATIONFAILED'=>'Sign-in failed. Check the username and password or app password.',
                    default=>$name==='LOGIN'?'Check the username and password or app password.':($name==='UID MOVE'?'Check archive folder permissions and available mailbox storage.':'Check the account settings and server permissions.'),
                };
                activity_step('IMAP: server refused '.$stage.'.','error');
                fail('IMAP '.$name.' refused'.(isset($status[1])?' ('.strtoupper($status[1]).($code!==''?' / '.$code:'').')':'').'. '.$hint);
            }
            activity_step('IMAP: finished '.$stage.'.','success',(int)round((microtime(true)-$started)*1000));
            return ['lines'=>$lines,'literals'=>$literals];
        }
    }
    imap_transport_failure($s,$stage);
}
function imap_open_connection(array $a): mixed {
    $s=socket_connection($a['config']['host'],993);
    try {
        $greeting=fgets($s,65536);if($greeting===false)imap_transport_failure($s,'receiving server greeting');
        if(!str_starts_with($greeting,'* OK'))fail('Unexpected IMAP greeting.');
        imap_command($s,'LOGIN '.imap_quote($a['credentials']['username']).' '.imap_quote($a['credentials']['password']));return $s;
    }catch(Throwable $e){fclose($s);throw $e;}
}
/** Retry a broken connection once, only if no mutating command was attempted. */
function imap_with_connection(array $a,callable $operation,?callable $connect=null): mixed {
    $oldMutation=$GLOBALS['office_imap_mutated']??false;$oldDeadline=$GLOBALS['office_imap_deadline']??null;
    $GLOBALS['office_imap_deadline']=$oldDeadline??microtime(true)+50;
    try {
        for($attempt=0;;$attempt++) {
            $s=null;$GLOBALS['office_imap_mutated']=false;
            try{$s=$connect?$connect($a):imap_open_connection($a);return $operation($s);}
            catch(ImapTransportError $e){
                if($attempt || $GLOBALS['office_imap_mutated'] || microtime(true)>$GLOBALS['office_imap_deadline']-5)throw $e;
                activity_step('IMAP: reconnecting once; no message change has been attempted.','warning');
            }finally{if(is_resource($s))fclose($s);}
        }
    }finally{$GLOBALS['office_imap_mutated']=$oldMutation;if($oldDeadline===null)unset($GLOBALS['office_imap_deadline']);else $GLOBALS['office_imap_deadline']=$oldDeadline;}
}
/** Read-only preflight shared by setup and archive. Never create folders or expunge mail. */
function imap_archive_folder(mixed $s,string $configured): string {
    $capabilities=imap_command($s,'CAPABILITY'); $tokens=[];
    foreach ($capabilities['lines'] as $line) if (preg_match('/^\* CAPABILITY (.*)/i',$line,$m)) $tokens=array_merge($tokens,preg_split('/\s+/',strtoupper(trim($m[1]))));
    if (!in_array('MOVE',$tokens,true) && !in_array('IMAP4REV2',$tokens,true)) fail('This IMAP server does not support MOVE. Office cannot archive messages on this server.');
    $list=imap_command($s,'LIST "" "*"'.(in_array('SPECIAL-USE',$tokens,true)?' RETURN (SPECIAL-USE)':''));
    $folders=imap_list_folders($list);
    $folder=imap_resolve_folder($folders,$configured,'archive',true,in_array('X-GM-EXT-1',$tokens,true));
    imap_command($s,'STATUS '.imap_quote($folder).' (MESSAGES)');
    return $folder;
}
function imap_search_ids(mixed $s,string $criteria): array {
    $response=imap_command($s,'UID SEARCH '.$criteria);
    foreach ($response['lines'] as $line) if (preg_match('/^\* SEARCH(?: (.*))?\r?\n$/i',$line,$m)) {
        $ids=preg_split('/\s+/',trim($m[1]??''));
        if ($ids===['']) return [];
        foreach ($ids as $id) if (!ctype_digit($id) || (int)$id<1) fail('The IMAP server returned an invalid message search result.');
        return $ids;
    }
    fail('The IMAP server did not return a message search result.');
}
function imap_message_content(mixed $s,string $id): ?string {
    $response=imap_command($s,'UID FETCH '.$id.' (UID BODY.PEEK[])');
    return imap_fetch_content($response,$id);
}
/** Index FETCH tuples once, retaining literal ownership when UID follows BODY. */
function imap_fetch_responses(array $response): array {
    $messages=[];$tuple=['lines'=>[],'literals'=>[]];$literalIndex=0;
    $finish=static function(array $tuple)use(&$messages):void {
        if(preg_match('/\bUID\s+([1-9][0-9]*)(?=\s|\))/i',implode('',$tuple['lines']),$m)){
            if(isset($messages[$m[1]])){
                $tuple=['lines'=>array_merge($messages[$m[1]]['lines'],$tuple['lines']),'literals'=>array_merge($messages[$m[1]]['literals'],$tuple['literals'])];
            }
            $messages[$m[1]]=$tuple;
        }
    };
    foreach($response['lines'] as $line){
        if(preg_match('/^\* \d+ FETCH\s*\(/i',$line) || preg_match('/^A\d+ /',$line)){
            $finish($tuple);$tuple=['lines'=>[],'literals'=>[]];
        }
        $tuple['lines'][]=$line;
        if(preg_match('/\{\d+\}\r\n$/',$line))$tuple['literals'][]=$response['literals'][$literalIndex++]??null;
    }
    $finish($tuple);return $messages;
}
function imap_fetch_content(array $response,string $id,string $section=''): ?string {
    // UID can follow the body literal. Keep unsolicited FETCH literals separate.
    $header=''; $body=null; $literalIndex=0; $seen=false;
    $matches=static fn(string $line):bool=>(bool)preg_match('/\bUID\s+'.preg_quote($id,'/').'(?=\s|\))/i',$line);
    foreach ($response['lines'] as $line) {
        if (preg_match('/^\* \d+ FETCH\s*\(/i',$line) || preg_match('/^A\d+ /',$line)) {
            if ($matches($header)) {
                $seen=true;
                if ($body!==null && ($body!=='' || $section!=='')) return $body;
            }
            $header=''; $body=null;
        }
        $header.=$line;
        if (preg_match('/\{\d+\}\r\n$/',$line)) {
            $literal=$response['literals'][$literalIndex++]??null;
            if (preg_match('/\bBODY\['.preg_quote($section,'/').'\](?:<\d+>)?\s+\{\d+\}\r\n$/i',$line)) $body=$literal;
        }
    }
    // Indexed tuples end at their closing parenthesis, without a tagged OK.
    if($matches($header)){
        $seen=true;
        if($body!==null && ($body!=='' || $section!==''))return $body;
    }
    if ($seen) fail('The IMAP server returned the message without readable content.');
    return null;
}
class ImapMessageMissing extends HttpError {}
function imap_archive(mixed $s,string $id,string $configured,?string $sourceFolder=null,bool $gmail=false,?array $account=null,?string $gmailId=null,?string $cachedRaw=null): array {
    if (!ctype_digit($id) || (int)$id<1) fail('Invalid IMAP message identifier.');
    $folder=imap_archive_folder($s,$configured);
    return imap_move_verified($s,$id,$folder,'Archive',$sourceFolder,$gmail,$account,$gmailId,$cachedRaw);
}
/** Gmail's account-wide ID is distinct from a folder UID. Never compare thread IDs. */
function imap_gmail_message_id(array $response,string $uid): string {
    $tuple=imap_fetch_responses($response)[$uid]??null;
    if($tuple && preg_match('/\bX-GM-MSGID ([1-9][0-9]*)\b/i',implode('',$tuple['lines']),$m))return $m[1];
    fail('Gmail did not confirm the message identifier. Sync before retrying.');
}
function imap_is_gmail(array $a): bool {
    return in_array(strtolower($a['config']['host']??''),['imap.gmail.com','imap.googlemail.com'],true);
}
/** Identify cached appearances before moving, including caches from older versions.
 * Body equality only selects candidates; Gmail's ID proves they are the same mail. */
function imap_gmail_move_copies(array $a,mixed $s,array $r,string $path,string $uid,?string &$identity=null): array {
    $identity=imap_gmail_message_id(imap_command($s,'UID FETCH '.$uid.' (UID X-GM-MSGID)'),$uid);
    $ids=[];
    foreach (mail_cache_rows($a['id']) as $copy) {
        $m=$copy['meta'];
        if ($copy['id']===$r['id']) continue;
        if (($m['gmailMessageId']??null)===$identity) { $ids[]=$copy['id']; continue; }
        if (!isset($m['rawBase64'],$r['meta']['rawBase64'],$m['serverFolder'],$m['uidValidity'],$m['providerId']) || $m['rawBase64']!==$r['meta']['rawBase64']) continue;
        $validity=imap_validity(imap_command($s,'EXAMINE '.imap_quote($m['serverFolder'])));
        if ($validity!==$m['uidValidity']) continue;
        $response=imap_command($s,'UID FETCH '.$m['providerId'].' (UID X-GM-MSGID)');
        if (!preg_match('/\bX-GM-MSGID\b/i',implode('',$response['lines']))) continue;
        if (imap_gmail_message_id($response,(string)$m['providerId'])===$identity) $ids[]=$copy['id'];
    }
    $validity=imap_validity(imap_command($s,'SELECT '.imap_quote($path)));
    if (mail_row_source($r)!==mail_source($path,$validity,$uid)) fail('Mailbox identifiers changed. Sync before moving this message.',409);
    return $ids;
}
function save_imap_gmail_move(array $r,array $relatedIds): array {
    $db=db(); $db->beginTransaction();
    try {
        $saved=save_record($r,true);
        foreach ($relatedIds as $id) if ($id!==$r['id']) { connection_retarget($id,$r['id']); $db->prepare('DELETE FROM records WHERE id=?')->execute([$id]); }
        $db->commit(); return $saved;
    } catch (Throwable $e) { if ($db->inTransaction()) $db->rollBack(); throw $e; }
}
function imap_verify_gmail_move(mixed $s,string $sourceFolder,string $gmailId,string $folder): array {
    activity_step('IMAP: checking source and destination after an interrupted move.','warning');
    imap_command($s,'EXAMINE '.imap_quote($sourceFolder));
    if(imap_search_ids($s,'X-GM-MSGID '.$gmailId))fail('The move remains unconfirmed: the message is still in its source folder. Sync before retrying.');
    $validity=imap_validity(imap_command($s,'EXAMINE '.imap_quote($folder)));
    $ids=imap_search_ids($s,'X-GM-MSGID '.$gmailId);
    if(count($ids)!==1)fail('The move remains unconfirmed: the message was not uniquely located in the destination. Sync before retrying.');
    $identity=imap_gmail_message_id(imap_command($s,'UID FETCH '.$ids[0].' (UID X-GM-MSGID)'),$ids[0]);
    if($identity!==$gmailId)fail('The move remains unconfirmed: destination identity could not be verified. Sync before retrying.');
    activity_step('IMAP: interrupted move confirmed in the destination; no second move was sent.','success');
    return ['serverFolder'=>$folder,'uidValidity'=>$validity,'providerId'=>$ids[0],'source'=>mail_source($folder,$validity,$ids[0]),'gmailMessageId'=>$gmailId];
}
function imap_move_verified(mixed $s,string $id,string $folder,string $operation='Move',?string $sourceFolder=null,bool $gmail=false,?array $account=null,?string $knownGmailId=null,?string $cachedRaw=null): array {
    if (!ctype_digit($id) || (int)$id<1) fail('Invalid IMAP message identifier.');
    $raw=$gmail?null:($cachedRaw??imap_message_content($s,$id));
    if (!$gmail && $raw===null) {
        if (in_array($id,imap_search_ids($s,'UID '.$id),true)) fail('The message is in its source server folder, but its content could not be read. No message was moved.');
        throw new ImapMessageMissing('This message is no longer in its server folder. Use Sync now or Repair / resync to update its location.',409);
    }
    $gmailId=$gmail?($knownGmailId??imap_gmail_message_id(imap_command($s,'UID FETCH '.$id.' (UID X-GM-MSGID)'),$id)):null;
    // Bound destination verification to UIDs allocated after this snapshot, including concurrent deliveries.
    $next='';
    if(!$gmail){
        $status=imap_command($s,'STATUS '.imap_quote($folder).' (UIDNEXT)');
        foreach ($status['lines'] as $line) if (preg_match('/^\* STATUS .*\bUIDNEXT (\d+)\b/i',$line,$m)) $next=$m[1];
        if ($next==='' || (int)$next<1) fail('The IMAP server did not provide the destination folder UIDNEXT. No message was moved.');
    }
    try {
        activity_step('IMAP: moving message to '.$folder.'.');
        $moved=imap_command($s,'UID MOVE '.$id.' '.imap_quote($folder));
        // Reopen Gmail's source to discard its session's previous label view.
        if ($gmail && $sourceFolder!==null) imap_command($s,'EXAMINE '.imap_quote($sourceFolder));
        if (in_array($id,imap_search_ids($s,'UID '.$id),true)) fail('The message is still in its source server folder.');
        activity_step('IMAP: verifying destination folder '.$folder.'.');
        $validity=imap_validity(imap_command($s,'EXAMINE '.imap_quote($folder)));
        // COPYUID gives an unambiguous destination identity for this exact UID.
        // Only accept a single-message mapping and confirm its mailbox/existence.
        if(!$gmail && preg_match('/\[COPYUID ([1-9][0-9]*) '.preg_quote($id,'/').' ([1-9][0-9]*)\]/i',implode('',$moved['lines']),$mapping) && $mapping[1]===$validity){
            $uid=$mapping[2];$confirmed=imap_command($s,'UID FETCH '.$uid.' (UID FLAGS)');
            if(imap_response_has_uid($confirmed,$uid))return ['serverFolder'=>$folder,'uidValidity'=>$validity,'providerId'=>$uid,'source'=>mail_source($folder,$validity,$uid),'read'=>imap_fetch_flags($confirmed,$uid)];
            fail('The mapped message is missing from the destination folder.');
        }
        $candidates=$gmail?imap_search_ids($s,'X-GM-MSGID '.$gmailId):array_values(array_filter(imap_search_ids($s,'UID '.$next.':*'),static fn($uid)=>(int)$uid>=(int)$next));
        if (count($candidates)>10) fail('Too many new destination messages to verify this move.');
        foreach ($candidates as $uid) {
            if($gmail){
                $identity=imap_gmail_message_id(imap_command($s,'UID FETCH '.$uid.' (UID X-GM-MSGID)'),$uid);
                if($identity===$gmailId)return ['serverFolder'=>$folder,'uidValidity'=>$validity,'providerId'=>$uid,'source'=>mail_source($folder,$validity,$uid),'gmailMessageId'=>$gmailId];
                continue;
            }
            $archived=imap_message_content($s,$uid);
            if ($archived!==null && hash_equals(hash('sha256',$raw),hash('sha256',$archived))) return ['serverFolder'=>$folder,'uidValidity'=>$validity,'providerId'=>$uid,'source'=>mail_source($folder,$validity,$uid)]+($gmail?['gmailMessageId'=>$gmailId]:[]);
        }
        fail('The message could not be found in the destination folder.');
    } catch (ImapTransportError $error) {
        if($gmail && $account!==null && $sourceFolder!==null) {
            try{return imap_with_connection($account,fn($fresh)=>imap_verify_gmail_move($fresh,$sourceFolder,$gmailId,$folder));}
            catch(HttpError $recovery){fail($operation.' could not be confirmed. '.$recovery->getMessage().' Sync before retrying.');}
        }
        fail($operation.' could not be confirmed. '.$error->getMessage().' Sync before retrying; the server may have completed the move.');
    } catch (HttpError $error) {
        fail($operation.' could not be confirmed. '.$error->getMessage().' Check the server source and destination folders, then use Sync now before retrying.');
    }
}
/** Serialize provider mutations and the brief cache-publication phase. */
function with_account_mail_lock(string $accountId,callable $operation): mixed {
    $directory=data_dir().'/locks';
    if (!is_dir($directory) && !@mkdir($directory,0700) && !is_dir($directory)) fail('Cannot create the mail lock directory.',503);
    $lock=fopen($directory.'/mail-'.hash('sha256',$accountId).'.lock','c');
    if ($lock===false) fail('Cannot lock this account for synchronization.',503);
    try {
        if (!flock($lock,LOCK_EX|LOCK_NB)) fail('This account is syncing or updating mail. Try again when it finishes.',409);
        try { return $operation(); }
        finally { flock($lock,LOCK_UN); }
    } finally { fclose($lock); }
}
class MailSyncSuperseded extends RuntimeException {}
function mail_generation(string $accountId): int {return (int)setting('mail-generation:'.$accountId,0);}
/** Provider writes remain serialized. Invalidate scans on both sides of network
 * work, including failures where a provider may have completed the operation. */
function with_account_mail_mutation(string $accountId,callable $operation): mixed {
    return with_account_mail_lock($accountId,function()use($accountId,$operation){
        set_setting('mail-generation:'.$accountId,mail_generation($accountId)+1);
        try{return $operation();}
        finally{set_setting('mail-generation:'.$accountId,mail_generation($accountId)+1);}
    });
}
/** Sync owns a separate scan lock. Interactive writes never wait for its network
 * reads; publication briefly takes the write lock and checks the generation. */
function with_account_mail_sync(string $accountId,callable $operation): int {
    return with_account_mail_lock('sync:'.$accountId,function()use($accountId,$operation){
        $previous=$GLOBALS['office_mail_sync_context']??null;
        $GLOBALS['office_mail_sync_context']=['account'=>$accountId,'generation'=>mail_generation($accountId)];
        try{return $operation();}
        catch(MailSyncSuperseded){activity_step('Mail changed during synchronization; discarded the older scan. The next check will refresh it.');return 0;}
        finally{if($previous===null)unset($GLOBALS['office_mail_sync_context']);else $GLOBALS['office_mail_sync_context']=$previous;}
    });
}
function mail_sync_publish_guard(string $accountId,callable $publish): mixed {
    $context=$GLOBALS['office_mail_sync_context']??null;
    if($context===null)return $publish();
    if($context['account']!==$accountId)throw new LogicException('Mail scan account mismatch.');
    $entered=false;
    try{return with_account_mail_lock($accountId,function()use($accountId,$context,$publish,&$entered){
        $entered=true;
        if(mail_generation($accountId)!==$context['generation'])throw new MailSyncSuperseded();
        return $publish();
    });}catch(HttpError $error){
        if(!$entered && $error->getCode()===409)throw new MailSyncSuperseded();
        throw $error;
    }
}
function sync_imap(array $a,bool $repair=false,int $batches=1): int {
    // A continuation can consume the remaining header windows on one connection,
    // avoiding repeated TLS/login, folder discovery and membership scans.
    $windows=($repair || mail_offline_download())?1:$batches;
    return imap_with_connection($a,fn($s)=>imap_sync_stream($a,$s,$repair,null,MAIL_SYNC_BATCH*$windows));
}
function smtp_expect(mixed $s,array $allowed): void {
    $line=''; $count=0;
    do { $line=fgets($s,8192); if ($line===false || ++$count>100) fail('SMTP connection interrupted. Delivery may be uncertain; check Sent before retrying.'); } while (isset($line[3]) && $line[3]==='-');
    if (!in_array((int)substr($line,0,3),$allowed,true)) fail('SMTP server rejected this operation.');
}
function gmail_require_inbox(string $base,string $token): void {
    $live=google_json($base.'?format=minimal',$token);
    $labels=$live['labelIds']??null;
    if (!is_array($labels)) fail('Inbox membership could not be verified.');
    if (!in_array('INBOX',$labels,true) || array_intersect(['TRASH','SPAM'],$labels)) fail('The message left the Inbox. Sync before applying rules.',409);
}

function remote_mail_action(array $r,string $action,?array &$undoBefore=null,bool $ruleMove=false): array {
    if ($r['kind']!=='mail' || empty($r['meta']['remote'])) fail('Choose a synchronized message.');
    if (!in_array($action,['archive','trash','restore','read','unread'],true)) fail('Unknown mail action.');
    if (in_array($r['meta']['folder']??'',['Recovery copies','Not in Inbox'],true)) fail('This is a recovery copy. Save it locally or discard it.');
    $a=account($r['meta']['account']); $id=(string)$r['meta']['providerId'];
    $destination=match($action) { 'archive'=>'Archive','trash'=>'Trash','restore'=>'Inbox',default=>null };
    $relatedIds=[];
    if ($destination!==null && $r['meta']['folder']===$destination) return $r;
    if ($a['type']==='google') {
        $base='https://gmail.googleapis.com/gmail/v1/users/me/messages/'.rawurlencode($id);
        $token=google_token($a);
        if ($ruleMove) gmail_require_inbox($base,$token);
        $msg=match($action) {
            'trash'=>google_json($base.'/trash',$token,'POST'),
            'restore'=>google_json($base.'/modify',$token,'POST',['removeLabelIds'=>['TRASH'],'addLabelIds'=>['INBOX']]),
            'archive'=>google_json($base.'/modify',$token,'POST',['removeLabelIds'=>['INBOX','TRASH']]),
            'read'=>google_json($base.'/modify',$token,'POST',['removeLabelIds'=>['UNREAD']]),
            'unread'=>google_json($base.'/modify',$token,'POST',['addLabelIds'=>['UNREAD']]),
        };
        if (!is_array($msg['labelIds']??null)) fail('The provider action could not be confirmed. Use Repair / resync before retrying.');
        if ($ruleMove && gmail_folder($msg['labelIds'])!=='Archive') fail('Archive could not be confirmed. Sync before retrying.');
        $r['meta']['folder']=gmail_folder($msg['labelIds'])??'Recovery copies';
        $r['meta']['labelIds']=$msg['labelIds'];
        $r['meta']['read']=!in_array('UNREAD',$msg['labelIds'],true);
    } elseif ($a['type']==='imap') {
        if (!ctype_digit($id)) fail('Invalid IMAP message identifier.');
        $path=$r['meta']['serverFolder']??(($r['meta']['folder']==='Inbox')?'INBOX':null);
        if ($path===null) fail('This cached message needs Repair / resync before processing.');
        $r=imap_with_connection($a,function($s) use($a,$r,$path,$id,$destination,$action,&$relatedIds,&$undoBefore) {
            activity_step('IMAP: opening source folder '.$path.'.');
            $validity=imap_validity(imap_command($s,'SELECT '.imap_quote($path)));
            if (mail_row_source($r)!==mail_source($path,$validity,$id)) fail('Mailbox identifiers changed. Use Repair / resync before processing this message.',409);
            if ($destination!==null) {
                $gmail=imap_is_gmail($a);
                if($gmail&&$undoBefore!==null)$undoBefore['meta']['imapLabels']=imap_undo_labels($s,$id);
                $gmailId=null;if ($gmail) $relatedIds=imap_gmail_move_copies($a,$s,$r,$path,$id,$gmailId);
                // The archive preflight checks MOVE and never creates or expunges folders.
                $cachedRaw=isset($r['meta']['rawBase64'])?base64_decode($r['meta']['rawBase64'],true):false;
                if ($destination==='Archive') $location=imap_archive($s,$id,$a['config']['archiveFolder']??'Archive',$path,$gmail,$a,$gmailId,$cachedRaw===false?null:$cachedRaw);
                else {
                    $cap=imap_command($s,'CAPABILITY');
                    if (!preg_match('/\b(?:MOVE|IMAP4REV2)\b/i',implode('',$cap['lines']))) fail('This IMAP server does not support MOVE.');
                    if ($destination==='Inbox') $target='INBOX';
                    else {
                        $special=(bool)preg_match('/\bSPECIAL-USE\b/i',implode('',$cap['lines']));
                        $folders=imap_list_folders(imap_command($s,'LIST "" "*"'.($special?' RETURN (SPECIAL-USE)':'')));
                        $target=imap_resolve_folder($folders,$a['config']['trashFolder']??'Trash','trash',true,$gmail);
                    }
                    if ($target===$path) fail('Source and destination folders must be different.');
                    imap_command($s,'STATUS '.imap_quote($target).' (MESSAGES)');
                    $location=imap_move_verified($s,$id,$target,'Move',$path,$gmail,$a,$gmailId,$cachedRaw===false?null:$cachedRaw);
                }
                $r['meta']=array_merge($r['meta'],$location,['folder'=>$destination]);
                if($gmail&&$undoBefore!==null)$undoBefore['meta']['imapTrashLabels']=imap_undo_labels($s,(string)$location['providerId']);
            } else {
                if (!in_array($id,imap_search_ids($s,'UID '.$id),true)) fail('This message left its server folder. Use Sync now to update its location.',409);
                imap_command($s,'UID STORE '.$id.' '.($action==='read'?'+':'-').'FLAGS.SILENT (\\Seen)');
                $r['meta']['read']=$action==='read';
            }
            return $r;
        });
    } else fail('This connector does not support email actions.');
    return $relatedIds?save_imap_gmail_move($r,$relatedIds):save_record($r,true);
}
function send_mail(array $a,string $to,string $subject,string $body,array $files=[]): string {
    $from=$a['config']['email']??'';
    foreach ([$from,$to] as $address) if (!filter_var($address,FILTER_VALIDATE_EMAIL) || preg_match('/[\r\n]/',$address)) fail('A valid sender and recipient email are required.');
    if (!$subject || preg_match('/[\r\n]/',$subject)) fail('Subject must be one line.');
    $raw='From: '.$from."\r\nTo: ".$to."\r\nSubject: =?UTF-8?B?".base64_encode($subject)."?=\r\nDate: ".gmdate('D, d M Y H:i:s +0000')."\r\nMessage-ID: <".bin2hex(random_bytes(16))."@".substr(strrchr($from,'@'),1).">\r\nMIME-Version: 1.0\r\n".attachment_mime_body($body,$files);
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
