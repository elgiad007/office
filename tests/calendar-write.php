<?php
declare(strict_types=1);
putenv('OFFICE_DATA_DIR='.dirname(__DIR__).'/.runtime/calendar-write-'.bin2hex(random_bytes(8)));
require __DIR__.'/../app/bootstrap.php';
require __DIR__.'/../app/connectors.php';
require __DIR__.'/../app/formats.php';

function expect_calendar(bool $ok,string $message): void {
    if (!$ok) throw new RuntimeException($message);
}

function calendar_rejects(callable $operation,int $status): void {
    try { $operation(); }
    catch (HttpError $error) { expect_calendar($error->getCode()===$status,$error->getMessage()); return; }
    throw new RuntimeException('Expected calendar request rejection.');
}

$raw=<<<'ICS'
BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:meeting
SUMMARY:Weekly meeting
DESCRIPTION:Original notes
DTSTART;TZID=America/New_York:20260301T090000
DURATION:PT1H
RRULE:FREQ=WEEKLY;COUNT=4
EXDATE;TZID=America/New_York:20260315T090000
X-CUSTOM;LANGUAGE=en:Keep this
BEGIN:VALARM
ACTION:DISPLAY
TRIGGER:-PT15M
DESCRIPTION:Reminder text
END:VALARM
END:VEVENT
BEGIN:VEVENT
UID:meeting
RECURRENCE-ID;TZID=America/New_York:20260322T090000
SUMMARY:Moved meeting
DTSTART;TZID=America/New_York:20260322T110000
DTEND;TZID=America/New_York:20260322T120000
END:VEVENT
END:VCALENDAR
ICS;
$expanded=<<<'ICS'
BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:meeting
SUMMARY:Weekly meeting
DTSTART:20260301T140000Z
DURATION:PT1H
END:VEVENT
BEGIN:VEVENT
UID:meeting
RECURRENCE-ID:20260308T130000Z
SUMMARY:Weekly meeting
DTSTART:20260308T130000Z
DURATION:PT1H
END:VEVENT
BEGIN:VEVENT
UID:meeting
RECURRENCE-ID:20260322T130000Z
SUMMARY:Moved meeting
DTSTART:20260322T150000Z
DTEND:20260322T160000Z
END:VEVENT
END:VCALENDAR
ICS;
$origin='https://calendar.example.test'; $collection=$origin.'/work'; $href='/work/meeting.ics'; $etag='"dav-1"';
$resources=[$href=>['ics'=>$raw,'etag'=>trim($etag,'"'),'writable'=>true]];
$expandedResources=[$href=>['ics'=>$expanded,'etag'=>$etag,'writable'=>true]];
$rows=caldav_calendar_rows($resources,$expandedResources,$collection,null);
expect_calendar(count($rows)===3 && isset($rows[$href.'#0']),'Expansion includes the first occurrence and skips the excluded week.');
expect_calendar($rows[$href.'#0']['meta']['calendarWritable'] && $rows[$href.'#0']['meta']['calendarEtag']===$etag,'An unquoted CalDAV version enables editing and is normalized in the cache.');
foreach (['','*','W/"dav-1"','dav-1, dav-2',"dav-1\r\nInjected: value"] as $unsafeTag) {
    expect_calendar(caldav_strong_etag($unsafeTag)==='','Unsafe or weak version tags cannot be used for writes.');
}
$readOnly=caldav_calendar_rows([$href=>array_replace($resources[$href],['writable'=>false])],$expandedResources,$collection,null);
expect_calendar(!$readOnly[$href.'#0']['meta']['calendarWritable'],'An unquoted version does not override read-only privileges.');
$instance=$rows[$href.'#instance:2026-03-08T13:00:00Z'];
expect_calendar($instance['meta']['end']==='2026-03-08T14:00:00+00:00','Expanded event duration survives DST.');
expect_calendar($rows[$href.'#instance:2026-03-22T13:00:00Z']['title']==='Moved meeting','Moved occurrence keeps its original identity.');
expect_calendar(str_contains($instance['meta']['calendarExtra'],'X-CUSTOM'),'Expanded occurrence exposes additional properties.');

$account=['id'=>'caldav-fixture','label'=>'Work','type'=>'caldav','config'=>['url'=>$collection],'credentials'=>['username'=>'name','password'=>'test']];
db()->prepare('INSERT INTO accounts(id,label,type,config,secret) VALUES(?,?,?,?,?)')->execute([$account['id'],$account['label'],$account['type'],json_encode($account['config']),encrypt_secret($account['credentials'])]);
$from='2026-03-02T00:00:00Z'; $until='2026-04-01T00:00:00Z';
publish_calendar_rows($account,null,$rows,true,$from,$until);
$cachedId=remote_id($account['id'],$href.'#instance:2026-03-08T13:00:00Z');
publish_calendar_rows($account,null,$rows,true,$from,$until);
expect_calendar(get_record($cachedId)['revision']===1,'Unchanged synchronization preserves the open record revision.');
publish_calendar_rows($account,null,[],true,$from,$until);
expect_calendar(get_record($cachedId)['meta']['calendarAbsent']===true,'A missing occurrence drops out of the active calendar after a complete scan.');
expect_calendar(empty(get_record(remote_id($account['id'],$href.'#0'))['meta']['calendarAbsent']),'Historical events outside the sync window remain available.');
$record=$instance+['id'=>'local-id','kind'=>'calendar'];
$record['meta']['remote']=true;
$calls=[]; $written='';
$request=static function(string $url,string $method,array $headers,?string $body)use(&$calls,&$written,$origin,$href,$etag,$raw):array {
    expect_calendar($url===$origin.$href,'Write target is the provider resource inside the connected collection.');
    $calls[]=$method;
    if ($method==='GET') return ['status'=>200,'etag'=>trim($etag,'"'),'body'=>$raw];
    expect_calendar($method==='PUT' && in_array('If-Match: '.$etag,$headers,true),'CalDAV uses conditional PUT.');
    $written=$body;
    return ['status'=>204,'body'=>''];
};
calendar_provider_event($record,$account,false,['body'=>"New \\note\nWith a comma, and semicolon;"],$etag,false,'America/New_York',$request);
expect_calendar($calls===['GET','PUT'],'One occurrence is written after checking the current provider version.');
$result=parse_ics($written);
expect_calendar(count($result)===3 && $result[0]['body']==='Original notes' && $result[2]['title']==='Moved meeting','Occurrence edit preserves the master and other exceptions.');
expect_calendar($result[1]['body']==="New \\note\nWith a comma, and semicolon;" && $result[1]['meta']['recurrenceId']==='20260308T090000','Exception uses the original event time zone and round-trips notes.');
expect_calendar(str_contains($written,'X-CUSTOM;LANGUAGE=en:Keep this') && substr_count($written,'BEGIN:VALARM')===2,'Unknown properties and inherited alarms are retained.');
$preview=calendar_provider_event($record,$account,true,null,null,false,'UTC',$request);
expect_calendar($preview['meta']['calendarOccurrence']==='' && $preview['meta']['start']==='2026-03-01T09:00:00-05:00','Series editor opens the master event.');
$calls=[];
calendar_rejects(fn()=>calendar_provider_event($record,$account,true,['title'=>'Conflicting edit'],'"old"',false,'UTC',$request),409);
expect_calendar($calls===['GET'],'Conflict never writes the stale event.');
$attachment='ATTACH;ENCODING=BASE64;VALUE=BINARY:'.str_repeat('A',2200000);
$largeRaw=str_replace("X-CUSTOM;LANGUAGE=en:Keep this\n",$attachment."\n",$raw);
$large=caldav_calendar_rows([$href=>array_replace($resources[$href],['ics'=>$largeRaw])],[],$collection,null)[$href.'#0'];
expect_calendar($large['meta']['calendarWritable'] && $large['meta']['calendarExtraOmitted'] && $large['meta']['calendarOriginalRemote'],'Oversized events retain editability without duplicating the attachment in the cache.');
validate_record($large+['kind'=>'calendar']);
$largeRecord=$large+['id'=>'large-id','kind'=>'calendar'];
$largeRecord['meta']['remote']=true;
$largeRequest=static function(string $url,string $method,array $headers,?string $body)use($etag,$largeRaw,$attachment):array {
    if ($method==='GET') return ['status'=>200,'etag'=>trim($etag,'"'),'body'=>$largeRaw];
    expect_calendar(in_array($attachment,calendar_ics_lines($body),true),'A normal edit preserves the oversized attachment.');
    return ['status'=>204,'body'=>''];
};
calendar_provider_event($largeRecord,$account,false,['title'=>'Edited event'],$etag,false,'UTC',$largeRequest);
$rangeRecord=$rows[$href.'#instance:2026-03-22T13:00:00Z']+['id'=>'range-id','kind'=>'calendar'];
$rangeRecord['meta']['remote']=true;
$rangeRequest=static function(string $url,string $method)use($etag,$raw):array {
    expect_calendar($method==='GET','Editing a range as one event must never write.');
    return ['status'=>200,'etag'=>$etag,'body'=>str_replace('RECURRENCE-ID;TZID=','RECURRENCE-ID;RANGE=THISANDFUTURE;TZID=',$raw)];
};
calendar_rejects(fn()=>calendar_provider_event($rangeRecord,$account,false,['title'=>'Only one event'],$etag,false,'UTC',$rangeRequest),400);
calendar_rejects(fn()=>caldav_event_address($collection,'https://outside.example.test/work/item.ics'),400);
calendar_rejects(fn()=>caldav_event_address($collection,'/work/%2e%2e%2fprivate.ics'),400);
calendar_rejects(fn()=>calendar_extra_lines("BEGIN:VALARM\nEND:VEVENT\nEND:VALARM"),400);
expect_calendar(calendar_ics_datetime('DTSTART','2026-03-08T13:00:00Z','Eastern Standard Time',[])==='DTSTART;TZID="Eastern Standard Time":20260308T090000','Existing Windows time-zone identifiers can be edited.');

$google=['id'=>'google-fixture','type'=>'google','label'=>'Google','config'=>['calendar'=>true],
    'credentials'=>['scope'=>GOOGLE_CALENDAR_WRITE_SCOPE,'access_token'=>'access','refresh_token'=>'refresh','expires'=>time()+3600]];
$event=['id'=>'series-20260308','summary'=>'Weekly meeting','etag'=>'"google-occurrence"','recurringEventId'=>'series',
    'originalStartTime'=>['dateTime'=>'2026-03-08T09:00:00-04:00'],'start'=>['dateTime'=>'2026-03-08T09:00:00-04:00','timeZone'=>'America/New_York'],
    'end'=>['dateTime'=>'2026-03-08T10:00:00-04:00','timeZone'=>'America/New_York']];
$record=google_calendar_fields($event,true,$google)+['id'=>'local-google','kind'=>'calendar'];
$record['meta']['remote']=true;
$calls=[];
$request=static function(string $url,string $method,array $headers,?string $body)use(&$calls,$event):array {
    $calls[]=$url;
    if ($method==='GET' && str_ends_with($url,'/series')) {
        $master=array_diff_key($event,['recurringEventId'=>true,'originalStartTime'=>true]);
        return ['status'=>200,'body'=>json_encode(array_replace($master,['id'=>'series','etag'=>'"google-series"','recurrence'=>['RRULE:FREQ=WEEKLY']]))];
    }
    if ($method==='GET') return ['status'=>200,'body'=>json_encode($event)];
    expect_calendar($method==='PATCH' && in_array('If-Match: "google-series"',$headers,true),'Google uses the master version when editing a series.');
    expect_calendar(json_decode($body,true)===['summary'=>'Updated series','recurrence'=>['RRULE:FREQ=WEEKLY;COUNT=5']],'Google patches only the requested fields.');
    return ['status'=>200,'body'=>'{}'];
};
$preview=calendar_provider_event($record,$google,true,null,null,false,'UTC',$request);
expect_calendar($preview['meta']['calendarRules']==='RRULE:FREQ=WEEKLY','Google loads recurrence from the parent series.');
calendar_provider_event($record,$google,true,['title'=>'Updated series','calendarRules'=>'RRULE:FREQ=WEEKLY;COUNT=5'],'"google-series"',false,'UTC',$request);
expect_calendar(str_ends_with($calls[2],'/series?conferenceDataVersion=1&supportsAttachments=true&sendUpdates=none'),'Google writes the parent and retains support for conference data and attachments.');
$google['credentials']['scope']='https://www.googleapis.com/auth/calendar.readonly';
expect_calendar(!google_calendar_fields($event,true,$google)['meta']['calendarWritable'],'Legacy Google grants keep the editor read-only.');
calendar_rejects(fn()=>calendar_provider_response(['status'=>412]),409);
calendar_rejects(fn()=>calendar_provider_response(['status'=>403]),403);
echo "PASS Calendar expansion, CalDAV field preservation and conditional writes, Google series editing, and conflicts.\n";
