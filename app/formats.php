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
    if (strtolower(trim(explode(';',$disposition,2)[0]))==='attachment' || eml_parameter($disposition,'filename')!==null || eml_parameter($type,'name')!==null) return null;
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
function parse_eml(string $raw): array {
    [$headers,$body]=eml_entity($raw);
    $decode=static function(string $v): string { return function_exists('iconv_mime_decode') ? (iconv_mime_decode($v,ICONV_MIME_DECODE_CONTINUE_ON_ERROR,'UTF-8') ?: $v) : $v; };
    $multipart=str_starts_with(strtolower(trim($headers['content-type']??'')),'multipart/');
    $remaining=500; $text=eml_text($headers,$body,0,$remaining);
    $body=$text['body']??'No readable message body was found. Download the original EML to view attachments or unsupported message formats in a full mail client.';
    $parsed=['title'=>$decode($headers['subject']??'(No subject)'),'body'=>$body,'meta'=>['from'=>$decode($headers['from']??''),'to'=>$decode($headers['to']??''),'date'=>$headers['date']??'','multipart'=>$multipart,'bodyParserVersion'=>1,'hasHtml'=>eml_html($raw)['html']!=='']];
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
