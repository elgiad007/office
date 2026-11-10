<?php
declare(strict_types=1);

const GOOGLE_CALENDAR_WRITE_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const CALENDAR_CORE_ICS = ['SUMMARY','DESCRIPTION','LOCATION','DTSTART','DTEND','DURATION'];
const CALENDAR_RECURRENCE_ICS = ['RRULE','RDATE','EXDATE'];
const CALENDAR_MANAGED_ICS = ['UID','RECURRENCE-ID','DTSTAMP','CREATED','LAST-MODIFIED','SEQUENCE','ORGANIZER'];
const CALENDAR_EXTRA_LIMIT = 1000000;

function google_can_edit_calendar(array $account): bool {
    return ($account['config']['calendar']??true) && in_array(GOOGLE_CALENDAR_WRITE_SCOPE,explode(' ',$account['credentials']['scope']??''),true);
}

function google_calendar_fields(array $event,bool $writable,array $account,string $zone=''): array {
    $recurrence=$event['recurrence']??[];
    $meta=[
        'start'=>$event['start']['dateTime']??$event['start']['date']??'',
        'end'=>$event['end']['dateTime']??$event['end']['date']??'',
        'location'=>$event['location']??'', 'providerId'=>$event['id'], 'calendarEtag'=>$event['etag']??'',
        'calendarZone'=>$event['start']['timeZone']??$zone, 'calendarRules'=>implode("\n",$recurrence),
        'calendarSeries'=>$event['recurringEventId']??($recurrence?$event['id']:''),
        'calendarOccurrence'=>$event['originalStartTime']['dateTime']??$event['originalStartTime']['date']??'',
        'calendarGuests'=>!empty($event['attendees']),
        'calendarWritable'=>$writable && google_can_edit_calendar($account) && ($event['eventType']??'default')==='default'
            && empty($event['locked']) && (($event['organizer']['self']??true)||!empty($event['guestsCanModify'])) && !empty($event['etag']),
    ];
    return ['title'=>$event['summary']??'(Untitled)','body'=>$event['description']??'','meta'=>$meta];
}

function caldav_report_events(string $body): array {
    $xpath=caldav_xpath($body); $resources=[];
    foreach ($xpath->query('/d:multistatus/d:response') as $node) {
        $href=$xpath->evaluate('string(d:href)',$node);
        $props='d:propstat[contains(d:status," 200 ")]/d:prop/';
        $ics=$xpath->evaluate('string('.$props.'c:calendar-data)',$node);
        if ($href==='' || $ics==='') continue;
        $privileges=$xpath->query($props.'d:current-user-privilege-set',$node);
        $writes=$xpath->query($props.'d:current-user-privilege-set/d:privilege/*[self::d:all or self::d:write or self::d:write-content]',$node);
        $resources[$href]=['ics'=>$ics,'etag'=>trim($xpath->evaluate('string('.$props.'d:getetag)',$node)),'writable'=>!$privileges->length || (bool)$writes->length];
    }
    return $resources;
}

function calendar_etag(string $etag): bool {
    return preg_match('/^"[\x21\x23-\x7e\x80-\xff]*"$/D',$etag)===1;
}

function caldav_strong_etag(string $etag): string {
    if (calendar_etag($etag)) return $etag;
    // Some CalDAV servers omit quotes in both DAV:getetag and the HTTP header.
    // Accept a single bare token, excluding weak tags, wildcards and tag lists.
    return preg_match('/^[A-Za-z0-9][A-Za-z0-9._:+-]*$/D',$etag) ? '"'.$etag.'"' : '';
}

function caldav_event_address(string $collection,string $href): string {
    $base=explode('?',$collection,2)[0];
    $url=caldav_href(rtrim($base,'/').'/',$href);
    $path=rawurldecode(parse_url($url,PHP_URL_PATH)??'');
    $parent=rtrim(rawurldecode(parse_url($base,PHP_URL_PATH)??''),'/').'/';
    $name=substr($path,strlen($parent));
    if (caldav_origin($collection)!==caldav_origin($url) || !str_starts_with($path,$parent)
        || $name==='' || str_contains($name,'/') || str_contains($name,'\\') || in_array($name,['.','..'],true)
        || preg_match('/[\x00-\x1f\x7f]/',$name)) fail('The event is outside the connected CalDAV collection.');
    return $url;
}

function calendar_ics_lines(string $text): array {
    return preg_split('/\r\n|\n|\r/',rtrim(preg_replace('/(?:\r\n|\n|\r)[ \t]/','',$text),"\r\n"));
}

function calendar_ics_property(string $line): array {
    if (!preg_match('/^((?:[^":]++|"[^"]*")*+):(.*)$/D',$line,$parts)) return ['','',''];
    return [strtoupper(explode(';',$parts[1],2)[0]),$parts[1],$parts[2]];
}

function calendar_ics_events(array $lines): array {
    $events=[]; $start=null;
    foreach ($lines as $index=>$line) {
        if (strcasecmp($line,'BEGIN:VEVENT')===0) $start=$index;
        if ($start!==null && strcasecmp($line,'END:VEVENT')===0) {
            $events[]=['offset'=>$start,'length'=>$index-$start+1,'lines'=>array_slice($lines,$start+1,$index-$start-1)];
            $start=null;
        }
    }
    return $events;
}

function calendar_ics_event_parts(array $lines): array {
    $parts=['core'=>[],'rules'=>[],'managed'=>[],'extra'=>[]]; $depth=0;
    foreach ($lines as $line) {
        [$key]=calendar_ics_property($line);
        if ($key==='BEGIN') $depth++;
        if ($depth>0) $parts['extra'][]=$line;
        elseif (in_array($key,CALENDAR_CORE_ICS,true)) $parts['core'][$key]=$line;
        elseif (in_array($key,CALENDAR_RECURRENCE_ICS,true)) $parts['rules'][]=$line;
        elseif (in_array($key,CALENDAR_MANAGED_ICS,true)) $parts['managed'][$key]=$line;
        else $parts['extra'][]=$line;
        if ($key==='END') $depth--;
    }
    return $parts;
}

function calendar_ics_zone(string $line): string {
    [, $name]=calendar_ics_property($line);
    return preg_match('/;TZID=(?:"([^"]+)"|([^;]+))/i',$name,$match)?($match[1]?:$match[2]):'';
}

function calendar_caldav_fields(array $parsed,array $component,array $metadata): array {
    $parts=calendar_ics_event_parts($component['lines']);
    $parsed['meta']+= [
        'calendarZone'=>calendar_ics_zone($parts['core']['DTSTART']??''),
        'calendarRules'=>implode("\n",$parts['rules']),
        'calendarExtra'=>implode("\n",$parts['extra']),
        'calendarManaged'=>implode("\n",$parts['managed']),
        'calendarGuests'=>preg_match('/^ATTENDEE[;:]/mi',implode("\n",$parts['extra']))===1,
    ]+$metadata;
    $meta=&$parsed['meta'];
    if (strlen($meta['calendarExtra'])>CALENDAR_EXTRA_LIMIT) {
        unset($meta['calendarExtra']);
        $meta['calendarExtraOmitted']=true;
    }
    // Leave room for the account and source fields appended at publication.
    $limit=2*1024*1024-8192;
    if (strlen(json_encode($meta))>$limit) {
        if (isset($meta['rawIcs'])) {
            unset($meta['rawIcs']);
            $meta['calendarOriginalRemote']=true;
        }
        if (isset($meta['calendarExtra']) && strlen(json_encode($meta))>$limit) {
            unset($meta['calendarExtra']);
            $meta['calendarExtraOmitted']=true;
        }
    }
    return $parsed;
}

function caldav_calendar_rows(array $resources,array $expanded,string $collection,?string $source): array {
    $rows=[]; $prefix=$source===null?'':$source.':';
    foreach ($resources as $href=>$resource) {
        $original=parse_ics($resource['ics']);
        $components=calendar_ics_events(calendar_ics_lines($resource['ics']));
        $repeat=count($components)>1 || preg_match('/^(?:RRULE|RDATE|RECURRENCE-ID)[;:]/mi',$resource['ics']);
        try { caldav_event_address($collection,$href); $safe=true; } catch (HttpError) { $safe=false; }
        $etag=caldav_strong_etag($resource['etag']);
        $meta=['calendarHref'=>$href,'calendarEtag'=>$etag,'calendarWritable'=>$safe && $resource['writable'] && $etag!=='',
            'calendarSeries'=>$repeat?$href:'','calendarOccurrence'=>''];
        if ($source!==null) $meta['calendarSource']=$source;
        $expansion=$expanded[$href]??null;
        $sameVersion=$expansion && ($expansion['etag']===$resource['etag'] || ($etag!=='' && caldav_strong_etag($expansion['etag'])===$etag));
        $instances=$repeat && $sameVersion && !preg_match('/^(?:RRULE|RDATE|EXDATE)[;:]/mi',$expansion['ics'])?parse_ics($expansion['ics']):[];
        if (!$instances) {
            foreach ($original as $index=>$event) {
                if (!isset($components[$index])) continue;
                if (calendar_caldav_cancelled($components[$index])) continue;
                $key=$prefix.$href.'#'.$index;
                $rows[$key]=calendar_caldav_fields($event,$components[$index],$meta);
                if (!empty($event['meta']['recurrenceId'])) {
                    $rows[$key]['meta']['calendarOccurrence']=calendar_caldav_occurrence($components[$index],ics_timezones($resource['ics']));
                }
            }
            continue;
        }
        $zones=ics_timezones(implode("\n",calendar_ics_lines($resource['ics'])));
        $master=null; $masterIndex=null; $initial=''; $exceptions=[];
        foreach ($components as $index=>$component) {
            $identity=calendar_caldav_occurrence($component,$zones);
            if ($identity==='') {
                $master=$component; $masterIndex=$index;
                $initial=calendar_occurrence_key($original[$index]['meta']['start']??'');
            }
            else $exceptions[$identity]=$component;
        }
        $expandedComponents=calendar_ics_events(calendar_ics_lines($expanded[$href]['ics']));
        foreach ($instances as $index=>$event) {
            if (!isset($expandedComponents[$index]) || calendar_caldav_cancelled($expandedComponents[$index])) continue;
            $identity=calendar_caldav_occurrence($expandedComponents[$index],[])?:calendar_occurrence_key($event['meta']['start']??'');
            if ($identity==='') continue;
            $component=$exceptions[$identity]??$master;
            if ($component===null) continue;
            $event['meta']['rawIcs']=$resource['ics'];
            $instanceMeta=array_replace($meta,['calendarOccurrence'=>$identity]);
            $key=$prefix.$href.($identity===$initial?'#'.$masterIndex:'#instance:'.$identity);
            $rows[$key]=calendar_caldav_fields($event,$component,$instanceMeta);
        }
    }
    return $rows;
}

function calendar_caldav_occurrence(array $component,array $zones): string {
    $line=calendar_ics_event_parts($component['lines'])['managed']['RECURRENCE-ID']??'';
    [,, $value]=calendar_ics_property($line);
    return calendar_occurrence_key(ics_date($value,calendar_ics_zone($line)?:null,$zones));
}

function calendar_occurrence_key(string $date): string {
    return str_contains($date,'T') && preg_match('/(?:Z|[+-]\d\d:\d\d)$/D',$date)?gmdate('Y-m-d\TH:i:s\Z',strtotime($date)):$date;
}

function calendar_caldav_cancelled(array $component): bool {
    return preg_match('/^STATUS(?:;[^:\r\n]*)?:CANCELLED$/mi',implode("\n",$component['lines']))===1;
}

function publish_calendar_rows(array $account,?string $source,array $rows,bool $complete,string $start,string $end): int {
    $from=strtotime($start); $until=strtotime($end);
    return mail_sync_publish_guard($account['id'],function()use($account,$source,$rows,$complete,$from,$until){
        $db=db(); $db->beginTransaction();
        try {
            $q=$db->prepare("SELECT * FROM records WHERE kind='calendar' AND json_extract(meta,'$.account')=? AND json_extract(meta,'$.calendarSource') IS ?");
            $q->execute([$account['id'],$source]);
            $count=count($rows);
            foreach ($q->fetchAll() as $stored) {
                $old=record_row($stored); $key=$old['meta']['source']??'';
                if (isset($rows[$key])) {
                    $row=$rows[$key];
                    if ($row['title']===$old['title'] && $row['body']===$old['body'] && empty($old['meta']['calendarAbsent'])
                        && $row['meta']+['remote'=>true,'account'=>$account['id'],'source'=>$key,'accountLabel'=>$account['label']]==$old['meta']) unset($rows[$key]);
                } elseif ($complete && empty($old['meta']['calendarAbsent']) && calendar_in_sync_window($old['meta'],$from,$until)) {
                    $old['meta']['calendarAbsent']=true;
                    save_record($old,true,false);
                }
            }
            foreach ($rows as $key=>$row) cache_remote($account,$key,'calendar',$row['title'],$row['body'],$row['meta']);
            $db->commit();
        } catch (Throwable $error) { $db->rollBack(); throw $error; }
        return $count;
    });
}

function calendar_in_sync_window(array $meta,int $from,int $until): bool {
    $start=strtotime($meta['start']??'');
    if ($start===false || $start>=$until) return false;
    $end=strtotime($meta['end']??'');
    return ($end===false?$start>=$from:$end>$from);
}

function calendar_provider_response(array $response): array {
    $status=$response['status'];
    if ($status===404 || $status===410 || $status===412) fail('The provider event changed or was removed. Refresh it before saving again.',409);
    if ($status===401 || $status===403) fail('The provider denied calendar access. Check sharing permissions or authorize the account again.',403);
    if ($status<200 || $status>=300) fail('The calendar provider returned HTTP '.$status.'. Check the event and try again.');
    return $response;
}

function calendar_checked_changes(mixed $input): array {
    if (!is_array($input) || !$input) fail('There are no event changes to save.');
    $limits=['title'=>500,'body'=>1000000,'location'=>2000,'start'=>40,'end'=>40,'calendarZone'=>200,'calendarRules'=>16384,'calendarExtra'=>CALENDAR_EXTRA_LIMIT];
    foreach ($input as $key=>$value) {
        if (!isset($limits[$key]) || !is_string($value) || strlen($value)>$limits[$key] || str_contains($value,"\0")) fail('Invalid calendar field.');
    }
    if (isset($input['title']) && trim($input['title'])==='') fail('Enter an event title.');
    return $input;
}

function calendar_date_value(string $value): DateTimeImmutable {
    if (!preg_match('/^\d{4}-\d\d-\d\d(?:T\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)?)?$/D',$value)) fail('Enter valid event dates.');
    try { $date=new DateTimeImmutable($value,new DateTimeZone('UTC')); }
    catch (Exception) { fail('Enter valid event dates.'); }
    if (DateTimeImmutable::getLastErrors()!==false) fail('Enter valid event dates.');
    return $date;
}

function calendar_change_dates(array $current,array $changes): array {
    $start=$changes['start']??$current['start']??'';
    $end=$changes['end']??$current['end']??'';
    $startDate=calendar_date_value($start);
    if ($end==='') $end=$startDate->modify(strlen($start)===10?'+1 day':'+1 hour')->format(strlen($start)===10?'Y-m-d':'c');
    if ((strlen($start)===10)!==(strlen($end)===10) || calendar_date_value($end)<=$startDate) fail('End must be after start and use the same date type.');
    return [$start,$end];
}

function calendar_rule_lines(string $value): array {
    if (trim($value)==='') return [];
    $lines=calendar_ics_lines($value); $rules=0;
    foreach ($lines as $line) {
        [$key,$name,$value]=calendar_ics_property($line);
        if (!in_array($key,CALENDAR_RECURRENCE_ICS,true) || $value==='' || preg_match('/[\x00-\x1f\x7f]/',$line)) fail('Enter RRULE, RDATE, or EXDATE properties, one per line.');
        if ($key==='RRULE' && (++$rules>1 || strtoupper($name)!=='RRULE'
            || !preg_match('/(?:^|;)FREQ=(?:SECONDLY|MINUTELY|HOURLY|DAILY|WEEKLY|MONTHLY|YEARLY)(?:;|$)/i',$value))) fail('Enter one valid recurrence rule with a frequency.');
    }
    return $lines;
}

function calendar_extra_lines(string $value): array {
    if (trim($value)==='') return [];
    $lines=calendar_ics_lines($value); $component=null;
    foreach ($lines as $line) {
        [$key,$name,$value]=calendar_ics_property($line);
        if (!preg_match('/^[A-Z0-9-]+$/D',$key) || preg_match('/[\x00-\x1f\x7f]/',$line)) fail('Enter valid iCalendar property lines.');
        if ($key==='BEGIN') {
            if ($component!==null || !preg_match('/^(?:VALARM|X-[A-Z0-9-]+)$/iD',$value) || strtoupper($name)!=='BEGIN') fail('Only alarm and custom event components can be edited here.');
            $component=strtoupper($value);
        } elseif ($key==='END') {
            if ($component!==strtoupper($value) || strtoupper($name)!=='END') fail('Close each component with its matching END line.');
            $component=null;
        } elseif ($component===null && in_array($key,[...CALENDAR_CORE_ICS,...CALENDAR_RECURRENCE_ICS,...CALENDAR_MANAGED_ICS],true)) {
            fail('Use the event’s regular fields for '.$key.'.');
        }
    }
    if ($component!==null) fail('Close each component with its matching END line.');
    return $lines;
}

function calendar_ics_text(string $value): string {
    return str_replace(["\\","\r\n","\r","\n",';',','],["\\\\",'\\n','\\n','\\n','\\;','\\,'],$value);
}

function calendar_ics_render(array $lines): string {
    $folded=[];
    foreach ($lines as $line) {
        $length=strlen($line); $offset=0; $width=75;
        while ($length-$offset>$width) {
            $cut=$offset+$width;
            while ((ord($line[$cut]) & 0xc0)===0x80) $cut--;
            $folded[]=($offset===0?'':' ').substr($line,$offset,$cut-$offset);
            $offset=$cut; $width=74;
        }
        $folded[]=($offset===0?'':' ').substr($line,$offset);
    }
    return implode("\r\n",$folded)."\r\n";
}

function calendar_ics_datetime(string $key,string $value,string $zone,array $zones,bool $floating=false,string $browserZone='UTC'): string {
    $date=calendar_date_value($value);
    if (strlen($value)===10) return $key.';VALUE=DATE:'.$date->format('Ymd');
    if ($zone==='') {
        if (!$floating) return $key.':'.gmdate('Ymd\THis\Z',$date->getTimestamp());
        $local=ics_native_timezone($browserZone)??new DateTimeZone('UTC');
        return $key.':'.$date->setTimezone($local)->format('Ymd\THis');
    }
    if (strlen($zone)>200 || preg_match('/["\x00-\x1f\x7f]/',$zone)) fail('Enter a valid event time zone.');
    $native=ics_native_timezone($zone);
    if ($native) $wall=$date->setTimezone($native)->format('Ymd\THis');
    else {
        $instant=$date->getTimestamp();
        $offset=ics_embedded_offset($zones[$zone]??[],$instant);
        if ($offset===null) fail('This CalDAV time zone is unavailable.');
        $offset=ics_embedded_offset($zones[$zone],$instant+$offset)??$offset;
        $wall=gmdate('Ymd\THis',$instant+$offset);
    }
    $parameter=preg_match('/[:,;\s]/u',$zone)?'"'.$zone.'"':$zone;
    return $key.';TZID='.$parameter.':'.$wall;
}

function calendar_patch_caldav(string $raw,array $target,array $record,array $changes,bool $createException,string $browserZone): string {
    $lines=calendar_ics_lines($raw); $zones=ics_timezones(implode("\n",$lines));
    $parts=calendar_ics_event_parts($target['lines']);
    $core=$parts['core']; $rules=$parts['rules']; $managed=$parts['managed']; $extra=$parts['extra'];
    if ($createException) {
        $identity=$record['meta']['calendarOccurrence'];
        $originalStart=$core['DTSTART']??'';
        $zone=calendar_ics_zone($originalStart);
        $floating=$zone==='' && !str_ends_with(strtoupper($originalStart),'Z');
        $managed['RECURRENCE-ID']=calendar_ics_datetime('RECURRENCE-ID',$identity,$zone,$zones,$floating,'UTC');
        $rules=[];
        $changes+=array_intersect_key($record['meta'],array_flip(['start','end']));
    }
    if (isset($managed['RECURRENCE-ID']) && isset($changes['calendarRules'])) fail('Change the repeat rule from the series editor.');
    foreach (['title'=>'SUMMARY','body'=>'DESCRIPTION','location'=>'LOCATION'] as $field=>$key) {
        if (!array_key_exists($field,$changes)) continue;
        [, $name]=calendar_ics_property($core[$key]??'');
        $core[$key]=($name?:$key).':'.calendar_ics_text($changes[$field]);
    }
    if (array_intersect_key($changes,array_flip(['start','end','calendarZone']))) {
        $oldStart=$core['DTSTART']??'';
        $oldZone=calendar_ics_zone($oldStart);
        $floating=$oldStart!=='' && $oldZone==='' && !str_ends_with(strtoupper($oldStart),'Z') && str_contains(explode(':',$oldStart,2)[1]??'','T');
        $current=$record['meta'];
        if ($floating) {
            $local=ics_native_timezone($browserZone)??new DateTimeZone('UTC');
            foreach (['start','end'] as $key) {
                if (strlen($current[$key]??'')===19) $current[$key]=(new DateTimeImmutable($current[$key],$local))->format('c');
                if ($createException && strlen($changes[$key]??'')===19) $changes[$key]=(new DateTimeImmutable($changes[$key],$local))->format('c');
            }
        }
        [$start,$end]=calendar_change_dates($current,$changes);
        $zone=$changes['calendarZone']??$oldZone;
        $sameType=(strlen($start)===10)===(strlen($record['meta']['start']??'')===10);
        if (!$sameType && $rules && !isset($changes['calendarRules'])) fail('Update the recurrence dates when changing the series between timed and all-day.');
        if (isset($changes['start']) || isset($changes['calendarZone'])) $core['DTSTART']=calendar_ics_datetime('DTSTART',$start,$zone,$zones,$floating&&!isset($changes['calendarZone']),$browserZone);
        if (isset($changes['end']) || isset($changes['calendarZone']) || isset($core['DURATION'])) {
            $endZone=$changes['calendarZone']??(isset($core['DTEND'])?calendar_ics_zone($core['DTEND']):$zone);
            $core['DTEND']=calendar_ics_datetime('DTEND',$end,$endZone,$zones,$floating&&!isset($changes['calendarZone']),$browserZone);
            unset($core['DURATION']);
        }
    }
    if (isset($changes['calendarRules'])) $rules=calendar_rule_lines($changes['calendarRules']);
    if (isset($changes['calendarExtra'])) $extra=calendar_extra_lines($changes['calendarExtra']);
    $now=gmdate('Ymd\THis\Z');
    $managed['DTSTAMP']='DTSTAMP:'.$now;
    $managed['LAST-MODIFIED']='LAST-MODIFIED:'.$now;
    [,, $sequence]=calendar_ics_property($managed['SEQUENCE']??'');
    $managed['SEQUENCE']='SEQUENCE:'.((int)$sequence+1);
    $event=['BEGIN:VEVENT',...array_values($managed),...array_values($core),...$rules,...$extra,'END:VEVENT'];
    if ($createException) array_splice($lines,$target['offset']+$target['length'],0,$event);
    else array_splice($lines,$target['offset'],$target['length'],$event);
    return calendar_ics_render($lines);
}

function calendar_patch_google(array $event,array $meta,array $changes): array {
    if (isset($changes['calendarExtra'])) fail('These iCalendar properties are available on CalDAV only.');
    $patch=[];
    foreach (['title'=>'summary','body'=>'description','location'=>'location'] as $field=>$key) {
        if (isset($changes[$field])) $patch[$key]=$changes[$field];
    }
    if (isset($changes['calendarRules'])) {
        if (!empty($event['recurringEventId'])) fail('Change the repeat rule from the series editor.');
        $patch['recurrence']=calendar_rule_lines($changes['calendarRules']);
    }
    if (array_intersect_key($changes,array_flip(['start','end','calendarZone','calendarRules']))) {
        [$start,$end]=calendar_change_dates($meta,$changes);
        if ((strlen($start)===10)!==(strlen($meta['start'])===10) && !empty($event['recurrence']) && !isset($changes['calendarRules'])) {
            fail('Update the recurrence dates when changing the series between timed and all-day.');
        }
        $recurrence=$patch['recurrence']??$event['recurrence']??[];
        foreach (['start'=>$start,'end'=>$end] as $key=>$value) {
            $zone=$changes['calendarZone']??$event[$key]['timeZone']??$meta['calendarZone'];
            if ($zone!=='' && !in_array($zone,DateTimeZone::listIdentifiers(DateTimeZone::ALL_WITH_BC),true)) fail('Enter an IANA time zone such as America/New_York.');
            if (strlen($value)!==10 && $recurrence && $zone==='') fail('A timed recurring event requires a time zone.');
            if (isset($changes[$key]) || isset($changes['calendarZone']) || ($recurrence && empty($event[$key]['timeZone']) && strlen($value)!==10)) {
                $patch[$key]=strlen($value)===10?['date'=>$value]:['dateTime'=>calendar_date_value($value)->format('c')]+($zone!==''?['timeZone'=>$zone]:[]);
            }
        }
    }
    return $patch;
}

function calendar_caldav_collection(array $account,array $meta): array {
    if ($account['type']==='caldav') return ['url'=>$account['config']['url']];
    if (imap_calendar_eligible($account)) {
        foreach (setting('caldav-discovery:'.$account['id'],[])['calendars']??[] as $calendar) {
            if ($calendar['id']===($meta['calendarSource']??null)) return $calendar;
        }
    }
    fail('This CalDAV collection is no longer connected.',409);
}

function calendar_caldav_resource(array $account,array $meta,callable $request): array {
    $collection=calendar_caldav_collection($account,$meta);
    $url=caldav_event_address($collection['url'],$meta['calendarHref']);
    $headers=['Authorization: Basic '.base64_encode($account['credentials']['username'].':'.$account['credentials']['password'])];
    $response=calendar_provider_response($request($url,'GET',$headers,null,8388608,true,15,true));
    return [$collection,$url,$headers,$response];
}

function calendar_original_request(string $id): array {
    $record=get_record($id); $meta=$record['meta'];
    if ($record['kind']!=='calendar' || empty($meta['remote']) || empty($meta['calendarHref']) || empty($meta['account'])) fail('No connected CalDAV event was found.',404);
    $account=account($meta['account']);
    [, , , $response]=calendar_caldav_resource($account,$meta,'web_request');
    return ['ics'=>$response['body']];
}

function calendar_provider_event(array $record,array &$account,bool $series,?array $changes,?string $version,bool $confirmed,string $browserZone,?callable $request=null): array {
    $request??='web_request';
    $meta=$record['meta'];
    if ($record['kind']!=='calendar' || empty($meta['remote']) || empty($meta['calendarWritable'])) fail('This calendar event is read-only.',403);
    if ($series && empty($meta['calendarSeries'])) fail('This event has no recurring series.');
    if ($account['type']==='google') {
        if (!google_can_edit_calendar($account)) fail('Authorize Google Calendar editing in Accounts first.',403);
        $eventId=$series?$meta['calendarSeries']:$meta['providerId'];
        $url='https://www.googleapis.com/calendar/v3/calendars/primary/events/'.rawurlencode($eventId);
        $token=google_token($account);
        $headers=['Authorization: Bearer '.$token,'Content-Type: application/json'];
        $response=calendar_provider_response($request($url,'GET',$headers,null,8388608,false,15,true));
        $event=json_decode($response['body'],true,64,JSON_THROW_ON_ERROR);
        $target=google_calendar_fields($event,true,$account,$meta['calendarZone']??'');
        if (!$target['meta']['calendarWritable']) fail('Google marks this event read-only.',403);
        if ($changes===null) return array_replace($record,$target);
        $etag=$target['meta']['calendarEtag'];
        if ($etag!==$version || !calendar_etag($etag)) fail('The Google event changed. Refresh it before saving again.',409);
        if (!empty($event['attendees']) && !$confirmed) fail('Confirm saving this event with guests.');
        $patch=calendar_patch_google($event,$target['meta'],$changes);
        $options='?conferenceDataVersion=1&supportsAttachments=true&sendUpdates='.(empty($event['attendees'])?'none':'all');
        calendar_provider_response($request($url.$options,'PATCH',[...$headers,'If-Match: '.$etag],json_encode($patch,JSON_THROW_ON_ERROR),8388608,false,15,true));
        return ['refresh'=>fn()=>sync_google_calendar($account,$token)];
    }

    [$collection,$url,$headers,$response]=calendar_caldav_resource($account,$meta,$request);
    $etag=caldav_strong_etag($response['etag']);
    if ($etag==='' || $etag!==($version??$meta['calendarEtag'])) fail('The CalDAV event changed. Refresh it before saving again.',409);
    $raw=$response['body']; $lines=calendar_ics_lines($raw);
    $events=calendar_ics_events($lines); $parsed=parse_ics($raw); $zones=ics_timezones(implode("\n",$lines));
    $identity=$series?'':($meta['calendarOccurrence']??'');
    $master=null; $index=null;
    foreach ($events as $i=>$event) {
        $key=calendar_caldav_occurrence($event,$zones);
        if ($key==='') $master=$i;
        if ($key===$identity) $index=$i;
    }
    $createException=$index===null && $identity!=='';
    // Rewriting a range override from the single-occurrence editor would change future events as well.
    $rangePattern='/^RECURRENCE-ID;[^\r\n]*\bRANGE=THISANDFUTURE\b/mi';
    if ($changes!==null && $identity!=='' && preg_match($rangePattern,implode("\n",$createException?$lines:($events[$index]['lines']??[])))) {
        fail('Edit this occurrence at the provider because it belongs to a range override.');
    }
    $index??=$master;
    if ($index===null || !isset($parsed[$index])) fail('The CalDAV event or series could not be located.',409);
    $target=calendar_caldav_fields($parsed[$index],$events[$index],array_replace($meta,['calendarOccurrence'=>$identity]));
    if ($createException) $target['meta']=array_replace($target['meta'],array_intersect_key($meta,array_flip(['start','end','calendarOccurrence'])));
    if ($changes===null) return array_replace($record,$target);
    if (!empty($target['meta']['calendarExtraOmitted']) && isset($changes['calendarExtra'])) fail('The additional iCalendar properties exceed the editor’s size limit.');
    if ((!empty($target['meta']['calendarGuests']) || preg_match('/^ATTENDEE[;:]/mi',$changes['calendarExtra']??'')) && !$confirmed) fail('Confirm saving this event with guests.');
    $body=calendar_patch_caldav($raw,$events[$index],$target,$changes,$createException,$browserZone);
    calendar_provider_response($request($url,'PUT',[...$headers,'Content-Type: text/calendar; charset=utf-8','If-Match: '.$etag],$body,8388608,true,15,true));
    return ['refresh'=>fn()=>sync_caldav($account,isset($collection['id'])?$collection:null,10)];
}

function calendar_edit_request(array $input,bool $save): array {
    $record=get_record((string)($input['id']??''));
    if ($record['kind']!=='calendar' || empty($record['meta']['remote']) || empty($record['meta']['calendarWritable']) || empty($record['meta']['account'])) fail('This calendar event is read-only.',403);
    $id=$record['id']; $accountId=$record['meta']['account'];
    $series=($input['scope']??'')==='series';
    $operation=function()use($input,$save,$id,$accountId,$series){
        $record=get_record($id);
        if (($record['meta']['account']??null)!==$accountId || !empty($record['meta']['calendarAbsent']) || (int)($input['revision']??0)!==$record['revision']) {
            fail('The event changed in Office. Refresh it before editing again.',409);
        }
        $account=account($accountId);
        $version=$save?($input['version']??''):null;
        if ($save && (!is_string($version) || !calendar_etag($version))) fail('Refresh this event before saving.');
        if ($save && !$series && $version!==$record['meta']['calendarEtag']) fail('Refresh this event before saving.',409);
        $changes=$save?calendar_checked_changes($input['changes']??null):null;
        $result=calendar_provider_event($record,$account,$series,$changes,$version,($input['confirmed']??false)===true,(string)($input['browserZone']??'UTC'));
        if (!$save) return ['record'=>$result];
        try { $result['refresh'](); }
        catch (Throwable $error) {
            error_log('Portable Office calendar refresh after save: '.$error->getMessage());
            return ['warning'=>'The provider saved the event. Use Sync now to refresh the Office copy.'];
        }
        return [];
    };
    return $save?with_account_mail_mutation($accountId,$operation):with_account_mail_lock($accountId,$operation);
}
