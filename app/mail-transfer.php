<?php
declare(strict_types=1);

/** Wait for the synchronizing-literal continuation before sending original bytes. */
function imap_append_original(mixed $s,string $folder,string $raw,bool $read,string $date): array {
    $GLOBALS['office_imap_mutated']=true;
    $tag='T'.bin2hex(random_bytes(6));
    $time=$date===''?false:strtotime($date);$internal=$time===false?'':' '.imap_quote(gmdate('d-M-Y H:i:s O',$time));
    write_all($s,$tag.' APPEND '.imap_quote($folder).' ('.($read?'\\Seen':'').')'.$internal.' {'.strlen($raw)."}\r\n");
    $continued=false;$total=0;
    while(($line=fgets($s,65536))!==false){
        if(($total+=strlen($line))>1048576)fail('APPEND response exceeds its limit.');
        if(str_starts_with($line,'+')&&!$continued){$continued=true;write_all($s,$raw."\r\n");continue;}
        if(str_starts_with($line,$tag.' ')){
            if(!preg_match('/^'.preg_quote($tag,'/').' OK\b/i',$line)||!$continued)fail('The destination refused the message copy. The source was kept.');
            if(!preg_match('/\[APPENDUID (\d+) (\d+)\]/i',$line,$ids))fail('Copy completed without a destination identifier. Check the destination before retrying.');
            return ['serverFolder'=>$folder,'uidValidity'=>$ids[1],'providerId'=>$ids[2],'source'=>mail_source($folder,$ids[1],$ids[2])];
        }
    }
    imap_transport_failure($s,'copying to the destination account');
}

function mail_transfer_original(array $r): string {
    $a=account($r['meta']['account']);
    if($a['type']==='imap')return imap_with_connection($a,fn($s)=>imap_mail_content($r,$s));
    $msg=google_json('https://gmail.googleapis.com/gmail/v1/users/me/messages/'.rawurlencode($r['meta']['providerId']).'?format=raw',google_token($a));
    $raw=base64_decode(strtr($msg['raw']??'','-_','+/'),true);
    if($raw===false||$raw==='')fail('Cannot download the original message. The source was kept.');
    return $raw;
}

function mail_transfer_copy(array $a,string $folder,string $raw,array $r,callable $beforeWrite): array {
    if($a['type']==='imap')return imap_with_connection($a,function($s)use($a,$folder,$raw,$r,$beforeWrite){
        mail_folder_find(imap_folder_catalog($a,$s),$folder);
        $cap=imap_command($s,'CAPABILITY');
        if(!preg_match('/\b(?:UIDPLUS|IMAP4REV2)\b/i',implode('',$cap['lines'])))fail('This destination needs IMAP UIDPLUS to verify transferred messages. The source was kept.');
        $beforeWrite();
        return imap_append_original($s,$folder,$raw,!empty($r['meta']['read']),$r['meta']['date']??'');
    });
    if($a['type']!=='google')fail('Choose a mail account.');
    $token=google_token($a);
    $f=mail_folder_find(gmail_folder_catalog(google_json('https://gmail.googleapis.com/gmail/v1/users/me/labels',$token)),$folder);
    if($f['protected']&&!in_array($folder,['INBOX','TRASH','SPAM'],true))fail('Choose a writable destination folder.');
    $beforeWrite();
    $msg=google_json('https://gmail.googleapis.com/gmail/v1/users/me/messages?internalDateSource=dateHeader',$token,'POST',[
        'raw'=>rtrim(strtr(base64_encode($raw),'+/','-_'),'='),
        'labelIds'=>array_merge([$folder],empty($r['meta']['read'])?['UNREAD']:[]),
    ]);
    if(!is_string($msg['id']??null)||$msg['id']==='')fail('The destination copy was not confirmed. The source was kept.');
    return ['providerId'=>$msg['id'],'source'=>'gmail:'.$msg['id']];
}

function mail_transfer_verify(array $a,string $folder,array $location,string $hash): array {
    if($a['type']==='imap')return imap_with_connection($a,function($s)use($a,$folder,$location,$hash){
        $validity=imap_validity(imap_command($s,'EXAMINE '.imap_quote($folder)));
        if($validity!==$location['uidValidity'])fail('Destination identifiers changed. The source was kept.');
        $raw=imap_message_content($s,$location['providerId']);
        if($raw===null||!hash_equals($hash,hash('sha256',$raw)))fail('Destination contents could not be verified. The source was kept.');
        $f=mail_folder_find(setting('mail-folders:'.$a['id'],[]),$folder);
        return [$raw,$location+['folder'=>$f['role']??'Custom folder']];
    });
    $msg=google_json('https://gmail.googleapis.com/gmail/v1/users/me/messages/'.rawurlencode($location['providerId']).'?format=raw',google_token($a));
    $raw=base64_decode(strtr($msg['raw']??'','-_','+/'),true);
    if($raw===false||!hash_equals($hash,hash('sha256',$raw))||!in_array($folder,$msg['labelIds']??[],true))fail('Destination contents or folder could not be verified. The source was kept.');
    return [$raw,$location+['labelIds'=>$msg['labelIds'],'folder'=>gmail_folder($msg['labelIds'])??'Custom folder','read'=>!in_array('UNREAD',$msg['labelIds'],true)]];
}

/** Both account mutation locks are held. Save progress before writes so retries
 * cannot blindly create a duplicate after a dropped provider response. */
function transfer_remote_mail(array $r,array $destination,string $folder,?callable $original=null,?callable $copy=null,?callable $verify=null,?callable $trash=null): array {
    if($r['kind']!=='mail'||empty($r['meta']['remote'])||in_array($r['meta']['folder']??'',['Drafts','Sending','Delivery uncertain','Recovery copies','Not in Inbox'],true))fail('Select synchronized messages to move.');
    if($destination['id']===$r['meta']['account']||!in_array($destination['type'],['imap','google'],true))fail('Choose another mail account.');
    mail_folder_find(setting('mail-folders:'.$destination['id'],[]),$folder);
    $key='mail-transfer:'.hash('sha256',$r['id'].'|'.mail_row_source($r).'|'.$destination['id'].'|'.$folder);
    $progress=setting($key);
    if(($progress['stage']??'')==='copying')fail('A previous copy could not be confirmed. The source was kept. Check the destination account before attempting another transfer.');
    if(!$progress){
        $raw=($original??'mail_transfer_original')($r);
        if($raw===''||strlen($raw)>IMAP_BODY_LIMIT)fail('Transfers require the complete original message within the 1.4 MB download limit. The source was kept.');
        $progress=['stage'=>'copying','hash'=>hash('sha256',$raw)];
        $beforeWrite=static fn()=>set_setting($key,$progress);
        if($copy!==null){$beforeWrite();$progress['location']=$copy($destination,$folder,$raw,$r);}
        else $progress['location']=mail_transfer_copy($destination,$folder,$raw,$r,$beforeWrite);
        $progress['stage']='copied';set_setting($key,$progress);
    }
    [$raw,$meta]=($verify??'mail_transfer_verify')($destination,$folder,$progress['location'],$progress['hash']);
    $record=mail_download($destination,$meta['source'],$raw,$meta+['read'=>!empty($r['meta']['read'])]);
    $record['id']=remote_id($destination['id'],$meta['source']);$record=save_record($record,true);
    // Keep the original recoverable under the source account's Trash policy.
    if(($progress['stage']??'')!=='done')($trash??static fn($source)=>remote_mail_action($source,'trash'))($r);
    $db=db();$db->beginTransaction();
    try{connection_retarget($r['id'],$record['id']);$db->commit();}catch(Throwable $e){if($db->inTransaction())$db->rollBack();throw $e;}
    $progress['stage']='done';set_setting($key,$progress);
    return $record;
}
