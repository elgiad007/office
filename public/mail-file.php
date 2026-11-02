<?php
declare(strict_types=1);
require dirname(__DIR__).'/app/bootstrap.php';
require dirname(__DIR__).'/app/formats.php';
header('Cache-Control: no-store');header('X-Content-Type-Options: nosniff');header('Referrer-Policy: no-referrer');
// Attachment content never shares Office's script or network permissions.
header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'; sandbox");
try{
    start_session();owner();$r=get_record((string)($_GET['id']??''));session_write_close();
    if($r['kind']!=='mail')fail('Choose mail.');
    if(($_GET['all']??'')==='1'){$bytes=attachment_zip($r);$name='attachments.zip';$type='application/zip';$preview=false;}
    else {
        // GET serves cached content only. Provider downloads require the CSRF-protected POST.
        $part=(string)($_GET['part']??'');$cached=array_column(attachment_cached($r['id']),null,'part');
        if(!isset($cached[$part]) && attachment_raw($r)===null)fail('Download this attachment first.',404);
        [$a,$bytes]=attachment_bytes($r,$part);$name=attachment_name($a['name']);$type='application/octet-stream';$preview=false;
        if(($_GET['preview']??'')==='1'){
            $info=@getimagesizefromstring($bytes);
            if($info && in_array($info['mime'],['image/png','image/jpeg','image/gif','image/webp'],true)){$type=$info['mime'];$preview=true;}
            elseif($a['type']==='application/pdf' && str_starts_with($bytes,'%PDF-')){
                $type='application/pdf';$preview=true;
                // Browser PDF viewers need their own renderer, which iframe/CSP sandbox disables.
                header("Content-Security-Policy: default-src 'none'; object-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'");
            }
            else fail('Preview is unavailable for this file. Download it to open in its usual application.');
        }
    }
    header('Content-Type: '.$type);header('Content-Length: '.strlen($bytes));
    header('Content-Disposition: '.($preview?'inline':'attachment').'; filename="'.preg_replace('/[^a-zA-Z0-9_. -]/','_',$name).'"; filename*=UTF-8\'\''.rawurlencode($name));
    echo $bytes;
}catch(Throwable $error){http_response_code($error instanceof HttpError?$error->getCode():500);header('Content-Type: text/plain; charset=utf-8');echo $error instanceof HttpError?$error->getMessage():'Attachment could not be opened.';}
