<?php
declare(strict_types=1);

function eml_entity(string $raw): array {
    $parts=preg_split('/\r?\n\r?\n/',$raw,2); $head=preg_replace('/\r?\n[ \t]+/',' ',$parts[0]); $headers=[];
    foreach (preg_split('/\r?\n/',$head) as $line) { $p=strpos($line,':'); if ($p!==false) $headers[strtolower(trim(substr($line,0,$p)))]=trim(substr($line,$p+1)); }
    return [$headers,$parts[1]??''];
}
function eml_parameter(string $value,string $name): ?string {
    if (!preg_match('/;\s*'.preg_quote($name,'/').'\s*=\s*(?:"((?:[^"\\\\]|\\\\.)*)"|([^;\s]+))/i',$value,$m)) return null;
    return isset($m[2]) && $m[2]!=='' ? $m[2] : preg_replace('/\\\\(.)/s','$1',$m[1]);
}
// Decode the preferred body. Raw HTML is used only by the isolated mail renderer.
function eml_text(array $headers,string $body,int $depth,int &$remaining,bool $html=false,array &$images=[]): ?array {
    if ($depth>20 || --$remaining<0) return null;
    $type=$headers['content-type']??'text/plain'; $media=strtolower(trim(explode(';',$type,2)[0]));
    $disposition=$headers['content-disposition']??'';
    if ($html && in_array($media,['image/png','image/jpeg','image/gif','image/webp'],true) && isset($headers['content-id']) && !str_starts_with(strtolower($disposition),'attachment')) {
        $bytes=strtolower(trim($headers['content-transfer-encoding']??''))==='base64' ? base64_decode(preg_replace('/\s+/','',$body),true) : (strtolower(trim($headers['content-transfer-encoding']??''))==='quoted-printable' ? quoted_printable_decode($body) : $body);
        if ($bytes!==false && strlen($bytes)<=500000 && ($info=@getimagesizefromstring($bytes)) && ($info['mime']??'')===$media) $images[trim($headers['content-id'],' <>')]='data:'.$media.';base64,'.base64_encode($bytes);
        return null;
    }
    $parameter=function_exists('attachment_parameter')?'attachment_parameter':'eml_parameter';
    if (strtolower(trim(explode(';',$disposition,2)[0]))==='attachment' || $parameter($disposition,'filename')!==null || $parameter($type,'name')!==null) return null;
    if (str_starts_with($media,'multipart/')) {
        $boundary=eml_parameter($type,'boundary');
        if ($boundary===null || $boundary==='' || strlen($boundary)>200 || strpbrk($boundary,"\r\n")!==false) return null;
        $candidates=[]; $start=eml_parameter($type,'start');
        // Split explicitly so a closing delimiter stops parsing before the epilogue.
        preg_match_all('/^--'.preg_quote($boundary,'/').'(--)?[ \t]*(?:\r?\n|$)/m',$body,$matches,PREG_OFFSET_CAPTURE);
        $total=count($matches[0]);
        for ($i=0;$i<$total && $remaining>0;$i++) {
            if (($matches[1][$i][0]??'')==='--') break;
            $offset=$matches[0][$i][1]+strlen($matches[0][$i][0]);
            $end=$i+1<$total ? $matches[0][$i+1][1] : strlen($body);
            $part=substr($body,$offset,$end-$offset);
            $part=preg_replace('/\r?\n$/','',$part);
            [$childHeaders,$childBody]=eml_entity($part);
            $isRoot=$media!=='multipart/related' || ($start!==null ? trim($childHeaders['content-id']??'',' <>')===trim($start,' <>') : $i===0);
            if (!$html && !$isRoot) continue;
            $text=eml_text($childHeaders,$childBody,$depth+1,$remaining,$html,$images);
            if (!$isRoot) continue;
            if ($text!==null && trim($text['body'])!=='') $candidates[]=$text;
            if ((!$html && $media==='multipart/related') || $media==='multipart/signed') break;
        }
        if (!$candidates) return null;
        if ($media==='multipart/alternative') {
            foreach ($candidates as $candidate) if ($candidate['type']===($html?'text/html':'text/plain')) return $candidate;
            return $candidates[count($candidates)-1];
        }
        return ['body'=>implode("\n\n",array_column($candidates,'body')),'type'=>$candidates[0]['type']];
    }
    if (!in_array($media,['text/plain','text/html'],true)) return null;
    if ($html && $media!=='text/html') return null;
    $encoding=strtolower(trim($headers['content-transfer-encoding']??''));
    if ($encoding==='base64') { $decoded=base64_decode($body,true); if ($decoded===false) return null; $body=$decoded; }
    elseif ($encoding==='quoted-printable') $body=quoted_printable_decode($body);
    $charset=eml_parameter($type,'charset');
    if ($charset!==null && function_exists('iconv')) { $converted=@iconv($charset,'UTF-8//IGNORE',$body); if ($converted!==false) $body=$converted; }
    if ($media==='text/html' && !$html) {
        $body=preg_replace('/<!--.*?-->|<(script|style|head)\b[^>]*>.*?<\/\1\s*>/is','',$body);
        $body=preg_replace('/<(?:br\b[^>]*|\/(?:p|div|li|tr|h[1-6]|blockquote|table)\s*)>/i',"\n",$body);
        $body=trim(html_entity_decode(strip_tags($body),ENT_QUOTES|ENT_HTML5,'UTF-8'));
    }
    return ['body'=>$body,'type'=>$media];
}
function eml_html(string $raw): array {
    [$headers,$body]=eml_entity($raw); $remaining=500; $images=[];
    $part=eml_text($headers,$body,0,$remaining,true,$images);
    return ['html'=>$part['body']??'','images'=>$images];
}
/** Attachment presence only: never decode or retain attachment bytes. */
function eml_has_attachments(string $raw,int $depth=0,?int &$remaining=null): ?bool {
    if ($remaining===null) $remaining=500;
    if ($depth>20 || --$remaining<0) return null;
    [$headers,$body]=eml_entity($raw);
    $type=$headers['content-type']??'text/plain';
    $disposition=$headers['content-disposition']??'';
    if(!str_starts_with(strtolower($type),'multipart/') && function_exists('attachment_part') && attachment_part($headers,'1',strlen($body))['attachment'])return true;
    $inline=str_starts_with(strtolower(trim(explode(';',$type,2)[0])),'image/') && (strtolower(trim(explode(';',$disposition,2)[0]))==='inline' || isset($headers['content-id']));
    if (strtolower(trim(explode(';',$disposition,2)[0]))==='attachment' || (!$inline && (eml_parameter($disposition,'filename')!==null || eml_parameter($type,'name')!==null))) return true;
    if (!str_starts_with(strtolower($type),'multipart/')) return false;
    $boundary=eml_parameter($type,'boundary');
    if (!$boundary || strlen($boundary)>200 || strpbrk($boundary,"\r\n")!==false) return null;
    preg_match_all('/^--'.preg_quote($boundary,'/').'(--)?[ \t]*(?:\r?\n|$)/m',$body,$matches,PREG_OFFSET_CAPTURE);
    if (count($matches[0])<2) return null;
    $unknown=false;
    for ($i=0;$i<count($matches[0])-1;$i++) {
        if (($matches[1][$i][0]??'')==='--') break;
        $offset=$matches[0][$i][1]+strlen($matches[0][$i][0]);
        $found=eml_has_attachments(substr($body,$offset,$matches[0][$i+1][1]-$offset),$depth+1,$remaining);
        if ($found===true) return true;
        if ($found===null) $unknown=true;
        if ($remaining<=0) return null;
    }
    return $unknown?null:false;
}
function parse_eml(string $raw): array {
    [$headers,$body]=eml_entity($raw);
    $decode=static function(string $v): string { return function_exists('iconv_mime_decode') ? (iconv_mime_decode($v,ICONV_MIME_DECODE_CONTINUE_ON_ERROR,'UTF-8') ?: $v) : $v; };
    $multipart=str_starts_with(strtolower(trim($headers['content-type']??'')),'multipart/');
    $remaining=500; $text=eml_text($headers,$body,0,$remaining);
    $body=$text['body']??'No readable message body was found. Download the original EML to view attachments or unsupported message formats in a full mail client.';
    $parsed=['title'=>$decode($headers['subject']??'(No subject)'),'body'=>$body,'meta'=>['from'=>$decode($headers['from']??''),'to'=>$decode($headers['to']??''),'date'=>$headers['date']??'','multipart'=>$multipart,'bodyParserVersion'=>1,'hasHtml'=>eml_html($raw)['html']!=='']];
    $attachments=eml_has_attachments($raw);
    if ($attachments!==null) $parsed['meta']['hasAttachments']=$attachments;
    return json_decode(json_encode($parsed,JSON_INVALID_UTF8_SUBSTITUTE|JSON_THROW_ON_ERROR),true,64,JSON_THROW_ON_ERROR);
}
require_once __DIR__.'/ical-timezone.php';
function ics_unescape(string $value): string { return preg_replace_callback('/\\\\([nN,;\\\\])/',static fn($part)=>strtolower($part[1])==='n'?"\n":$part[1],$value); }
function ics_date(string $value,?string $zone=null,array $zones=[]): string {
    try {
        if (preg_match('/^\d{8}$/D',$value)) return substr($value,0,4).'-'.substr($value,4,2).'-'.substr($value,6,2);
        if (!preg_match('/^\d{8}T\d{6}Z?$/D',$value)) return '';
        if (!str_ends_with($value,'Z') && !$zone) return substr($value,0,4).'-'.substr($value,4,2).'-'.substr($value,6,2).'T'.substr($value,9,2).':'.substr($value,11,2).':'.substr($value,13,2);
        if (str_ends_with($value,'Z')) return (new DateTimeImmutable($value,new DateTimeZone('UTC')))->format('c');
        $wall=ics_wall_time($value);
        if ($wall===null) return '';
        if (isset($zones[$zone]) && ($offset=ics_embedded_offset($zones[$zone],$wall))!==null) {
            return gmdate('Y-m-d\TH:i:s\Z',$wall-$offset);
        }
        $native=ics_native_timezone($zone);
        return $native ? (new DateTimeImmutable($value,$native))->format('c') : '';
    } catch (Throwable) { return ''; }
}
function parse_ics(string $raw): array {
    $original=$raw; $raw=preg_replace('/\r?\n[ \t]/','',$raw); $events=[]; $event=null; $nested=0;
    $zones=ics_timezones($raw);
    foreach (preg_split('/\r?\n/',$raw) as $line) {
        $component=strtoupper($line);
        if ($component==='BEGIN:VEVENT') { $event=['title'=>'Untitled event','body'=>'','meta'=>[]]; $nested=0; $duration=''; $startValue=''; $startZone=null; continue; }
        if ($component==='END:VEVENT' && $event!==null) {
            if (empty($event['meta']['end']) && !empty($event['meta']['start']) && $duration!=='') {
                try {
                    $start=$event['meta']['start']; $dateOnly=strlen($start)===10;
                    $interval=new DateInterval(preg_match('/^P(\d+)W$/D',$duration,$weeks)?'P'.((int)$weeks[1]*7).'D':$duration);
                    if ($startZone && !str_ends_with($startValue,'Z')) {
                        $wall=DateTimeImmutable::createFromFormat('!Ymd\THis',$startValue,new DateTimeZone('UTC'));
                        if ($wall) $event['meta']['end']=ics_date($wall->add($interval)->format('Ymd\THis'),$startZone,$zones);
                    } else {
                        $floating=strlen($start)===19;
                        $event['meta']['end']=(new DateTimeImmutable($start,new DateTimeZone('UTC')))->add($interval)->format($dateOnly?'Y-m-d':($floating?'Y-m-d\TH:i:s':'c'));
                    }
                } catch (Exception) { /* A malformed duration is ignored. */ }
            }
            $event['meta']['rawIcs']=$original; $events[]=$event; $event=null; continue;
        }
        if ($event===null) continue;
        if (str_starts_with($component,'BEGIN:')) { $nested++; continue; } if (str_starts_with($component,'END:')) { $nested--; continue; } if ($nested>0) continue;
        if (!preg_match('/^((?:[^":]++|"[^"]*")*+):(.*)$/D',$line,$property)) continue;
        $key=strtoupper(explode(';',$property[1])[0]); $value=$property[2]; $zone=null;
        if (preg_match('/;TZID=(?:"([^"]+)"|([^;]+))/i',$property[1],$m)) $zone=$m[1]!==''?$m[1]:$m[2];
        if ($key==='SUMMARY') $event['title']=ics_unescape($value);
        if ($key==='DESCRIPTION') $event['body']=ics_unescape($value);
        if ($key==='DTSTART') { $startValue=$value; $startZone=$zone; $event['meta']['start']=ics_date($value,$zone,$zones); }
        if ($key==='DTEND') $event['meta']['end']=ics_date($value,$zone,$zones);
        if ($key==='DURATION') $duration=$value;
        if ($key==='LOCATION') $event['meta']['location']=ics_unescape($value);
        if ($key==='UID') $event['meta']['uid']=$value;
        if ($key==='RRULE') $event['meta']['recurrence']=$value;
        if ($key==='RECURRENCE-ID') $event['meta']['recurrenceId']=$value;
    }
    return $events;
}
