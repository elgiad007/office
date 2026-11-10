<?php
declare(strict_types=1);

const CALDAV_PORTS = [443, 8443, 2080];

function repair_cached_caldav_dates(): void {
    $key='caldav-date-repair';
    $version=class_exists('IntlTimeZone')?2:1;
    if ((int)setting($key,0)>=$version) return;
    $db=db(); $db->exec('BEGIN IMMEDIATE');
    try {
        if ((int)setting($key,0)<$version) {
            $ids=$db->query("SELECT id FROM records WHERE kind='calendar' AND json_extract(meta,'$.remote')=1
                AND COALESCE(json_extract(meta,'$.rawIcs'),json_extract(meta,'$.raw'),'')<>''
                AND (COALESCE(json_extract(meta,'$.start'),'')='' OR COALESCE(json_extract(meta,'$.end'),'')='')")->fetchAll(PDO::FETCH_COLUMN);
            $read=$db->prepare('SELECT meta FROM records WHERE id=?');
            $write=$db->prepare('UPDATE records SET meta=?,revision=revision+1 WHERE id=?');
            foreach ($ids as $id) {
                $read->execute([$id]);
                $meta=json_decode($read->fetchColumn(),true,64,JSON_THROW_ON_ERROR);
                if (!preg_match('/#(\d+)$/D',$meta['source']??'',$part)) continue;
                $raw=$meta['rawIcs']??$meta['raw'];
                $parsed=parse_ics($raw)[(int)$part[1]]['meta']??[];
                $changed=false;
                foreach (['start','end'] as $field) {
                    if (empty($meta[$field]) && !empty($parsed[$field])) {
                        $meta[$field]=$parsed[$field];
                        $changed=true;
                    }
                }
                if ($changed) $write->execute([json_encode($meta,JSON_THROW_ON_ERROR),$id]);
            }
            set_setting($key,$version);
        }
        $db->exec('COMMIT');
    } catch (Throwable $e) {
        $db->exec('ROLLBACK');
        throw $e;
    }
}

function imap_calendar_eligible(array $a): bool {
    return $a['type']==='imap' && !imap_is_gmail($a)
        && !preg_match('/@(?:gmail|googlemail)\.com$/i',$a['config']['email']??'');
}

function caldav_validate_url(string $url,string $name='CalDAV endpoint'): array {
    $p=parse_url($url);
    if (strlen($url)>2048 || preg_match('~[\x00-\x20\x7f\\\\]~',$url) || !$p || ($p['scheme']??'')!=='https'
        || !preg_match('/^[a-zA-Z0-9.-]{1,253}$/D',$p['host']??'') || isset($p['user']) || isset($p['pass'])
        || isset($p['fragment']) || !in_array($p['port']??443,CALDAV_PORTS,true)) {
        fail('Use an HTTPS '.$name.' URL on port 443, 8443, or 2080, without embedded credentials.');
    }
    return $p;
}

function caldav_origin(string $url): string {
    $p=caldav_validate_url($url);
    $port=$p['port']??443;
    return 'https://'.strtolower(rtrim($p['host'],'.')).($port===443?'':':'.$port);
}

function caldav_url_key(string $url): string {
    $p=caldav_validate_url($url);
    return caldav_origin($url).rtrim($p['path']??'','/').(isset($p['query'])?'?'.$p['query']:'');
}

function caldav_href(string $base,string $href): string {
    if ($href==='' || preg_match('~[\x00-\x20\x7f\\\\]~',$href)) fail('Invalid CalDAV resource address.');
    if (str_starts_with($href,'//')) $href='https:'.$href;
    if (preg_match('/^[a-z][a-z0-9+.-]*:/i',$href)) {
        caldav_validate_url($href);
        return $href;
    }
    $path=parse_url($base,PHP_URL_PATH)?:'/';
    if ($href[0]==='?') return caldav_origin($base).$path.$href;
    [$relative,$query]=array_pad(explode('?',$href,2),2,null);
    if ($relative[0]!=='/') $relative=substr($path,0,strrpos($path,'/')+1).$relative;
    $segments=[];
    foreach (explode('/',substr($relative,1)) as $part) {
        if ($part==='..') array_pop($segments);
        elseif ($part!=='.') $segments[]=$part;
    }
    $resolved=caldav_origin($base).'/'.implode('/',$segments).($query===null?'':'?'.$query);
    caldav_validate_url($resolved);
    return $resolved;
}

function caldav_xpath(string $body): DOMXPath {
    if (!class_exists('DOMDocument')) fail('The DOM extension is required for CalDAV.');
    $doc=new DOMDocument(); $previous=libxml_use_internal_errors(true);
    try {
        if ($body==='' || !$doc->loadXML($body,LIBXML_NONET) || $doc->doctype) fail('Invalid calendar response.');
    } finally { libxml_clear_errors(); libxml_use_internal_errors($previous); }
    $xp=new DOMXPath($doc);
    $xp->registerNamespace('d','DAV:'); $xp->registerNamespace('c','urn:ietf:params:xml:ns:caldav');
    if (!$xp->query('/d:multistatus')->length) fail('The server did not return CalDAV properties.');
    return $xp;
}

function caldav_candidates(array $a): array {
    if (!empty($a['config']['calendarUrl'])) return [$a['config']['calendarUrl']=>true];
    $domain=strtolower(substr(strrchr($a['config']['email']??'','@')?:'@',1));
    $host=strtolower(rtrim($a['config']['host'],'.'));
    $candidates=[];
    if (preg_match('/^[a-z0-9.-]{1,253}$/D',$domain)) {
        $service='_caldavs._tcp.'.$domain;
        $srv=function_exists('dns_get_record')?(@dns_get_record($service,DNS_SRV)?:[]):[];
        usort($srv,static fn($left,$right)=>[$left['pri'],-$left['weight']]<=>[$right['pri'],-$right['weight']]);
        $path='/.well-known/caldav';
        if ($srv) {
            foreach (@dns_get_record($service,DNS_TXT)?:[] as $txt) {
                if (preg_match('~^path=(/[^/#\s][^#\s]*|/)$~',$txt['txt']??'',$match)) { $path=$match[1]; break; }
            }
        }
        foreach (array_slice($srv,0,4) as $record) {
            $target=strtolower(rtrim($record['target'],'.')); $port=$record['port'];
            if (!preg_match('/^[a-z0-9.-]{1,253}$/D',$target) || !in_array($port,CALDAV_PORTS,true)) continue;
            $origin='https://'.$target.($port===443?'':':'.$port);
            $candidates[$origin.$path]=true;
            if ($path==='/.well-known/caldav') $candidates[$origin.'/']=true;
        }
        $candidates['https://'.$domain.'/.well-known/caldav']??=false;
    }
    $candidates['https://'.$host.'/.well-known/caldav']??=false;
    // Some cPanel installations expose DAV on the mail host without SRV records.
    $candidates['https://'.$host.':2080/']??=false;
    if ($domain!=='') {
        $proxy='https://cpcalendars.'.$domain;
        $candidates[$proxy.'/.well-known/caldav']??=false;
        $candidates[$proxy.'/']??=true;
    }
    return $candidates;
}

function caldav_propfind(string $url,int $depth,array $a,float $deadline,callable $request): array {
    $headers=['Depth: '.$depth,'Content-Type: application/xml; charset=utf-8'];
    $explicit=$a['config']['calendarUrl']??'';
    $host=strtolower(rtrim(caldav_validate_url($url)['host'],'.'));
    $trusted=$explicit!=='' ? caldav_origin($url)===caldav_origin($explicit)
        : $host===strtolower(rtrim($a['config']['host'],'.'));
    if ($trusted) $headers[]='Authorization: Basic '.base64_encode($a['credentials']['username'].':'.$a['credentials']['password']);
    $remaining=(int)ceil($deadline-microtime(true));
    if ($remaining<1) fail('Calendar discovery timed out.');
    $body='<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:current-user-principal/><c:calendar-home-set/><d:resourcetype/><d:displayname/><c:supported-calendar-component-set/></d:prop></d:propfind>';
    $response=$request($url,'PROPFIND',$headers,$body,1048576,true,min(4,$remaining),true);
    return $response+['trusted'=>$trusted];
}

function caldav_property_url(DOMXPath $xp,string $path,string $base): ?string {
    $href=trim($xp->evaluate('string('.$path.'/d:href)'));
    return $href===''?null:caldav_href($base,$href);
}

function caldav_collections(DOMXPath $xp,string $url): array {
    $calendars=[];
    foreach ($xp->query('/d:multistatus/d:response') as $node) {
        $props='d:propstat[contains(d:status," 200 ")]/d:prop';
        if (!$xp->query($props.'/d:resourcetype/c:calendar',$node)->length) continue;
        $components=$props.'/c:supported-calendar-component-set';
        if ($xp->query($components,$node)->length && !$xp->query($components.'/c:comp[@name="VEVENT"]',$node)->length) continue;
        $href=trim($xp->evaluate('string(d:href)',$node));
        try {
            $collection=caldav_href($url,$href);
            if (caldav_origin($collection)!==caldav_origin($url)) continue;
        } catch (HttpError) { continue; }
        $key=caldav_url_key($collection);
        $name=trim($xp->evaluate('string('.$props.'/d:displayname)',$node));
        preg_match('/^.{1,160}/us',$name,$label);
        $calendars[$key]=['id'=>'caldav-'.substr(hash('sha256',$key),0,32),'label'=>$label[0]??'Calendar','url'=>$collection];
        if (count($calendars)>=32) break;
    }
    return array_values($calendars);
}

function discover_caldav(array $a,array $candidates,float $deadline,?callable $request=null): array {
    $request??='web_request';
    $approval=null; $error=null;
    foreach ($candidates as $start=>$advertised) {
        if (microtime(true)>=$deadline) break;
        $url=$start; $depth=0; $visited=[];
        try {
            for ($step=0;$step<7;$step++) {
                $key=$depth.' '.$url;
                if (isset($visited[$key])) break;
                $visited[$key]=true;
                $result=caldav_propfind($url,$depth,$a,$deadline,$request);
                $status=$result['status'];
                if ($status>=300 && $status<400 && $result['location']!=='') {
                    $url=caldav_href($url,$result['location']);
                    $advertised=true;
                    continue;
                }
                if (!$result['trusted'] && ($status===207 || ($status===401 && ($advertised || str_ends_with($url,'/.well-known/caldav'))))) {
                    $approval??=$url;
                    break;
                }
                if ($status!==207) {
                    if (!empty($a['config']['calendarUrl']) || ($result['trusted'] && $status===401)) $error='Calendar server returned HTTP '.$status.'. Check its URL and login.';
                    break;
                }
                $xp=caldav_xpath($result['body']);
                $calendars=caldav_collections($xp,$url);
                if ($calendars || $depth===1) return ['calendars'=>$calendars];
                $props='/d:multistatus/d:response/d:propstat[contains(d:status," 200 ")]/d:prop';
                $home=caldav_property_url($xp,$props.'/c:calendar-home-set',$url);
                $principal=caldav_property_url($xp,$props.'/d:current-user-principal',$url);
                if ($home!==null) { $url=$home; $depth=1; $advertised=true; }
                elseif ($principal!==null) { $url=$principal; $advertised=true; }
                else break;
            }
        } catch (HttpError $e) {
            if (!empty($a['config']['calendarUrl'])) $error=$e->getMessage();
        }
    }
    return array_filter(['approval'=>$approval,'error'=>$error],static fn($value)=>$value!==null);
}

function manual_caldav_urls(): array {
    $urls=[];
    foreach (db()->query("SELECT config FROM accounts WHERE type='caldav'")->fetchAll(PDO::FETCH_COLUMN) as $config) {
        $url=json_decode($config,true)['url']??'';
        try { $urls[caldav_url_key($url)]=true; } catch (HttpError) { continue; }
    }
    return $urls;
}

function imap_calendar_status(string $id): array {
    $state=setting('caldav-discovery:'.$id,[]);
    $sources=array_map(static fn($calendar)=>['id'=>$calendar['id'],'label'=>$calendar['label']],$state['calendars']??[]);
    return ['calendars'=>$sources,'error'=>$state['error']??$state['syncError']??null]
        +array_intersect_key($state,array_flip(['checked','approval']));
}

// Caller holds the account's scan lock, including during cache publication.
function sync_imap_calendars(array $a,bool $force=false): int {
    if (!imap_calendar_eligible($a)) return 0;
    $key='caldav-discovery:'.$a['id'];
    $state=setting($key,[]);
    $now=time(); $deadline=microtime(true)+16;
    if (!$force && ($state['synced']??0)>$now-300) return 0;
    $calendars=$state['discovered']??[];
    if ($force || ($state['checked']??0)<$now-($calendars?604800:86400)) {
        $result=discover_caldav($a,caldav_candidates($a),min($deadline-5,microtime(true)+10));
        $state['checked']=$now;
        unset($state['approval'],$state['error']);
        $state=array_replace($state,array_intersect_key($result,array_flip(['approval','error'])));
        $calendars=$result['calendars']??$calendars;
        $state['discovered']=$calendars;
    }
    $manual=manual_caldav_urls();
    foreach ($calendars as &$calendar) {
        // The same collection may be accessible to more than one mailbox.
        $calendar['id'].='-'.$a['id'];
    }
    unset($calendar);
    $calendars=array_values(array_filter($calendars,static fn($calendar)=>!isset($manual[caldav_url_key($calendar['url'])])));
    $removed=array_diff(array_column($state['calendars']??[],'id'),array_column($calendars,'id'));
    $state['calendars']=$calendars;
    $state['synced']=$now;
    $state['syncError']=null;
    $db=db(); $db->beginTransaction();
    try {
        if ($removed) {
            $delete=$db->prepare("DELETE FROM records WHERE kind='calendar' AND json_extract(meta,'$.account')=? AND json_extract(meta,'$.calendarSource')=?");
            foreach ($removed as $id) $delete->execute([$a['id'],$id]);
        }
        set_setting($key,$state);
        $db->commit();
    } catch (Throwable $e) { $db->rollBack(); throw $e; }
    $count=0;
    $size=count($calendars);
    $offset=$size?($state['cursor']??0)%$size:0;
    for ($i=0;$i<$size && microtime(true)<$deadline;$i++) {
        $calendar=$calendars[($offset+$i)%$size];
        try { $count+=sync_caldav($a,$calendar,max(1,min(6,(int)ceil($deadline-microtime(true))))); }
        catch (HttpError $e) { $state['syncError']=$e->getMessage(); }
        $state['cursor']=($offset+$i+1)%$size;
    }
    set_setting($key,$state);
    return $count;
}
