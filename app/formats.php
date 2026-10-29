<?php
declare(strict_types=1);

function parse_eml(string $raw): array {
    $parts=preg_split('/\r?\n\r?\n/',$raw,2); $head=preg_replace('/\r?\n[ \t]+/',' ',$parts[0]); $headers=[];
    foreach (preg_split('/\r?\n/',$head) as $line) { $p=strpos($line,':'); if ($p!==false) $headers[strtolower(substr($line,0,$p))]=trim(substr($line,$p+1)); }
    $decode=static function(string $v): string { return function_exists('iconv_mime_decode') ? (iconv_mime_decode($v,ICONV_MIME_DECODE_CONTINUE_ON_ERROR,'UTF-8') ?: $v) : $v; };
    $body=$parts[1]??''; $type=$headers['content-type']??'text/plain';
    $multipart=str_starts_with(strtolower($type),'multipart/');
    if (!$multipart) {
        $encoding=strtolower($headers['content-transfer-encoding']??'');
        if ($encoding==='base64') $body=base64_decode($body,true) ?: '';
        if ($encoding==='quoted-printable') $body=quoted_printable_decode($body);
        if (stripos($type,'text/html')!==false) $body=html_entity_decode(strip_tags(preg_replace('/<(br|\/p|\/div)\b[^>]*>/i',"\n",$body)),ENT_QUOTES|ENT_HTML5,'UTF-8');
        if (preg_match('/charset=["\']?([\w-]+)/i',$type,$charset) && function_exists('iconv')) $body=@iconv($charset[1],'UTF-8//IGNORE',$body) ?: $body;
    } else $body='This multipart message is preserved in its original EML format. Download it to view attachments or complex formatting in a full mail client.';
    $parsed=['title'=>$decode($headers['subject']??'(No subject)'),'body'=>$body,'meta'=>['from'=>$decode($headers['from']??''),'to'=>$decode($headers['to']??''),'date'=>$headers['date']??'','multipart'=>$multipart]];
    return json_decode(json_encode($parsed,JSON_INVALID_UTF8_SUBSTITUTE|JSON_THROW_ON_ERROR),true,64,JSON_THROW_ON_ERROR);
}
function ics_unescape(string $value): string { return str_replace(['\\n','\\N','\\,','\\;','\\\\'],["\n","\n",',',';','\\'],$value); }
function ics_date(string $value,?string $zone=null): string {
    try {
        if (preg_match('/^\d{8}$/D',$value)) return substr($value,0,4).'-'.substr($value,4,2).'-'.substr($value,6,2);
        if (!preg_match('/^\d{8}T\d{6}Z?$/D',$value)) return '';
        if (!str_ends_with($value,'Z') && !$zone) return substr($value,0,4).'-'.substr($value,4,2).'-'.substr($value,6,2).'T'.substr($value,9,2).':'.substr($value,11,2).':'.substr($value,13,2);
        $d=new DateTimeImmutable($value,new DateTimeZone($zone ?: 'UTC')); return $d->format('c');
    } catch (Throwable) { return ''; }
}
function parse_ics(string $raw): array {
    $original=$raw; $raw=preg_replace('/\r?\n[ \t]/','',$raw); $events=[]; $event=null; $nested=0;
    foreach (preg_split('/\r?\n/',$raw) as $line) {
        if ($line==='BEGIN:VEVENT') { $event=['title'=>'Untitled event','body'=>'','meta'=>[]]; $nested=0; continue; }
        if ($line==='END:VEVENT' && $event!==null) { $event['meta']['rawIcs']=$original; $events[]=$event; $event=null; continue; }
        if ($event===null) continue;
        if (str_starts_with($line,'BEGIN:')) { $nested++; continue; } if (str_starts_with($line,'END:')) { $nested--; continue; } if ($nested>0) continue;
        $p=strpos($line,':'); if ($p===false) continue; $property=substr($line,0,$p); $key=strtoupper(explode(';',$property)[0]); $value=substr($line,$p+1); $zone=null;
        if (preg_match('/;TZID="?([^;"\r\n]+)/i',$property,$m)) $zone=$m[1];
        if ($key==='SUMMARY') $event['title']=ics_unescape($value);
        if ($key==='DESCRIPTION') $event['body']=ics_unescape($value);
        if ($key==='DTSTART') $event['meta']['start']=ics_date($value,$zone);
        if ($key==='DTEND') $event['meta']['end']=ics_date($value,$zone);
        if ($key==='LOCATION') $event['meta']['location']=ics_unescape($value);
        if ($key==='UID') $event['meta']['uid']=$value;
        if ($key==='RRULE') $event['meta']['recurrence']=$value;
        if ($key==='RECURRENCE-ID') $event['meta']['recurrenceId']=$value;
    }
    return $events;
}
