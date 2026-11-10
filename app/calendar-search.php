<?php
declare(strict_types=1);

function calendar_search_range(mixed $from,mixed $through,mixed $timeZone='UTC'): ?array {
    if ($from==='' && $through==='') return null;
    foreach ([$from,$through] as $value) {
        if (!is_string($value) || !preg_match('/^\d{4}-\d{2}-\d{2}$/D',$value)
            || !checkdate((int)substr($value,5,2),(int)substr($value,8,2),(int)substr($value,0,4))) {
            fail('Enter both dates to search for individual occurrences.');
        }
    }
    if (!is_string($timeZone) || strlen($timeZone)>100) fail('Invalid calendar time zone.');
    try { $zone=new DateTimeZone($timeZone); }
    catch (Exception $error) { fail('Invalid calendar time zone.'); }
    $start=new DateTimeImmutable($from.' 00:00:00',$zone);
    $end=(new DateTimeImmutable($through.' 00:00:00',$zone))->modify('+1 day');
    if ($end<=$start || $end>$start->modify('+366 days') || $end->format('Y')>9999) {
        fail('Choose a date range of up to 366 days.');
    }
    return [$start,$end];
}

function calendar_search_request(array $input): array {
    $id=$input['account']??null; $source=$input['source']??null;
    $query=$input['query']??null; $page=$input['page']??'';
    if (!is_string($id) || !is_string($source) || !is_string($query) || trim($query)===''
        || strlen($query)>1024 || !is_string($page) || strlen($page)>4096) fail('Invalid calendar search.');
    $query=trim($query);
    $range=calendar_search_range($input['from']??'',$input['through']??'',$input['timeZone']??'UTC');
    $account=account($id);
    $records=[]; $next=''; $warning='';
    if ($account['type']==='google' && $source===$id && ($account['config']['calendar']??true)) {
        $parameters=['q'=>$query,'maxResults'=>100,'singleEvents'=>$range?'true':'false',
            'fields'=>'nextPageToken,timeZone,items(id,status,summary,description,location,start,end,recurrence,recurringEventId,originalStartTime)'];
        if ($range) {
            $parameters['timeMin']=$range[0]->format(DATE_ATOM);
            $parameters['timeMax']=$range[1]->format(DATE_ATOM);
        }
        if ($page!=='') $parameters['pageToken']=$page;
        $token=$account['credentials']['access_token']??'';
        if ($token==='' || ($account['credentials']['expires']??0)<=time()+60) {
            $token=with_account_mail_lock('sync:'.$id,static fn()=>with_account_mail_lock($id,static function()use($id) {
                $current=account($id);
                if ($current['type']!=='google' || !($current['config']['calendar']??true)) fail('Calendar source is unavailable.',404);
                return google_token($current);
            }));
        }
        $result=google_json('https://www.googleapis.com/calendar/v3/calendars/primary/events?'.http_build_query($parameters),$token);
        foreach ($result['items']??[] as $event) {
            if (($event['status']??'')==='cancelled') continue;
            $row=google_calendar_fields($event,false,$account,$result['timeZone']??'');
            $records[]=calendar_search_result($id,'google-event:'.$event['id'],$row);
        }
        $next=$result['nextPageToken']??'';
    } else {
        if ($account['type']==='caldav' && $source===$id) {
            $collection=$account['config']['url'];
            $calendarSource=null;
        } elseif (imap_calendar_eligible($account)) {
            $calendars=array_column(setting('caldav-discovery:'.$id,[])['calendars']??[],null,'id');
            if (!isset($calendars[$source])) fail('Calendar source is unavailable.',404);
            $collection=$calendars[$source]['url'];
            $calendarSource=$source;
        } else fail('Calendar source is unavailable.',404);
        if ($page!=='') fail('Invalid calendar search page.');
        [$records,$warning]=calendar_search_caldav($account,$collection,$calendarSource,$query,$range);
    }
    return ['matches'=>$records,'next'=>$next,'warning'=>$warning];
}

function calendar_search_caldav(array $account,string $collection,?string $source,string $query,?array $range): array {
    $utc=new DateTimeZone('UTC');
    $attributes=$range?'start="'.$range[0]->setTimezone($utc)->format('Ymd\THis\Z').'" end="'.$range[1]->setTimezone($utc)->format('Ymd\THis\Z').'"':'';
    $data=$range?'<c:calendar-data><c:expand '.$attributes.'/></c:calendar-data>':'<c:calendar-data/>';
    $time=$range?'<c:time-range '.$attributes.'/>':'';
    $xml='<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop>'.$data
        .'</d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">'.$time
        .'</c:comp-filter></c:comp-filter></c:filter></c:calendar-query>';
    $credentials=$account['credentials'];
    $auth=base64_encode($credentials['username'].':'.$credentials['password']);
    $response=web_request($collection,'REPORT',['Depth: 1','Content-Type: application/xml; charset=utf-8','Authorization: Basic '.$auth],$xml,8388608,true,20);
    return calendar_search_caldav_results($response['body'],$account['id'],$source,$query,$range!==null);
}

function calendar_search_caldav_results(string $body,string $account,?string $source,string $query,bool $expanded): array {
    $xpath=caldav_xpath($body);
    if (!$xpath->query('/d:multistatus')->length) fail('Invalid calendar search response.');
    $warning=''; $records=[];
    $matches=static fn(string $field): bool=>function_exists('mb_stripos')
        ?mb_stripos($field,$query,0,'UTF-8')!==false:preg_match('/'.preg_quote($query,'/').'/iu',$field)===1;
    foreach ($xpath->query('/d:multistatus/d:response') as $node) {
        $href=$xpath->evaluate('string(d:href)',$node);
        $ics=$xpath->evaluate('string(d:propstat[contains(d:status," 200 ")]/d:prop/c:calendar-data)',$node);
        if ($href==='' || $ics==='') {
            $warning='Some events could not be retrieved.';
            continue;
        }
        $components=calendar_ics_events(calendar_ics_lines($ics));
        foreach (parse_ics($ics) as $index=>$row) {
            $component=$components[$index]??null;
            if ($component===null || calendar_caldav_cancelled($component)) continue;
            $rules=calendar_ics_event_parts($component['lines'])['rules'];
            if ($expanded && $rules) {
                $warning='The provider did not expand some recurring events.';
                continue;
            }
            $location=$row['meta']['location']??'';
            if (!$matches($row['title']) && !$matches($row['body']) && !$matches($location)) continue;
            $row['meta']['calendarRules']=implode("\n",$rules);
            $key=($source===null?'':$source.':').$href.'#'.$index;
            // Expanded response indices are not the indices of stored CalDAV components.
            $records[]=calendar_search_result($account,$key,$row,!$expanded);
        }
    }
    return [$records,$warning];
}

function calendar_search_result(string $account,string $key,array $row,bool $storedId=true): array {
    return [
        'id'=>$storedId?remote_id($account,$key):null,
        'title'=>$row['title']?:'(Untitled)','body'=>$row['body'],
        'start'=>$row['meta']['start']??'','end'=>$row['meta']['end']??'',
        'location'=>$row['meta']['location']??'','recurring'=>!empty($row['meta']['calendarRules']),
    ];
}
