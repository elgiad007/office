<?php
declare(strict_types=1);

function mail_junk_reason(string $raw): ?string {
    [$headers]=eml_entity($raw);
    foreach (['x-spam-flag','x-spam-status'] as $name) {
        if (preg_match('/^yes(?:\s|,|$)/i',trim($headers[$name]??''))) return 'Spam verdict in the message headers';
    }
    return null;
}

function mail_block_target(string $from,string $type): ?string {
    $address=trim($from);
    if (preg_match('/^[^<>]*<([^<>]+)>$/D',$address,$match)) $address=trim($match[1]);
    if (!filter_var($address,FILTER_VALIDATE_EMAIL)) return null;
    $address=strtolower($address);
    return $type==='domain'?substr(strrchr($address,'@'),1):$address;
}

function mail_block_rules(string $account): array {
    return setting('mail-blocks:'.$account,[]);
}

function update_mail_block(string $account,string $type,string $target,bool $remove=false): void {
    if (!in_array($type,['sender','domain'],true)) fail('Choose a sender or domain rule.');
    $target=strtolower(trim($target));
    if (mail_block_target($type==='domain'?'office@'.$target:$target,$type)!==$target) fail('Enter a valid email address or exact domain.');
    $rules=mail_block_rules($account);
    $key=$type.':'.$target;
    if ($remove) unset($rules[$key]);
    elseif (!isset($rules[$key])) {
        if (count($rules)>=500) fail('Remove an existing rule before adding another.');
        $rules[$key]=['type'=>$type,'target'=>$target,'token'=>bin2hex(random_bytes(12)),'since'=>time()];
    }
    set_setting('mail-blocks:'.$account,$rules);
}

function mail_matching_blocks(array $rules,string $from,?int $arrival=null): array {
    if (!$rules) return [];
    $matches=[];
    foreach (['sender','domain'] as $type) {
        $target=mail_block_target($from,$type);
        $rule=$rules[$type.':'.$target]??null;
        if ($rule && ($arrival===null || $arrival>$rule['since'])) $matches[]=$rule['token'];
    }
    return $matches;
}

function mail_junk_sync_meta(array &$meta,?array $old,array $rules): void {
    $arrival=$meta['junkArrival']??0;
    unset($meta['junkArrival']);
    if (!empty($old['junkReviewed'])) $meta['junkReviewed']=true;
    if (($meta['folder']??'')!=='Inbox') {
        unset($meta['junkPending'],$meta['junkAttempted']);
        return;
    }
    $matches=$old===null?mail_matching_blocks($rules,$meta['from']??'',$arrival):($old['junkPending']??[]);
    if ($matches && empty($meta['junkReviewed'])) {
        $meta['junkPending']=$matches;
        if (isset($old['junkAttempted'])) $meta['junkAttempted']=$old['junkAttempted'];
    }
}

function imap_junk_arrival(array $response): int {
    return preg_match('/\bINTERNALDATE "([^"]+)"/i',implode('',$response['lines']),$m)?(strtotime($m[1])?:0):0;
}

function gmail_junk_arrival(array $message): int {
    return (int)floor((float)($message['internalDate']??0)/1000);
}

function imap_junk_path(array $a,array $folders): ?string {
    $configured=setting('mail-junk-folder:'.$a['id'],'');
    if ($configured!=='') {
        if (strcasecmp($configured,'INBOX')!==0 && isset($folders[$configured])) return $configured;
        return null;
    }
    $special=[];$fallback=[];
    foreach ($folders as $path=>$info) {
        if (strcasecmp((string)$path,'INBOX')===0) continue;
        if ($info['junk']??false) $special[]=(string)$path;
        $parts=$info['delimiter']!==''?explode($info['delimiter'],(string)$path):[(string)$path];
        if (in_array(strtolower(end($parts)),['junk','junk email','junk e-mail','spam'],true)) $fallback[]=(string)$path;
    }
    $matches=$special?:$fallback;
    return count($matches)===1?$matches[0]:null;
}

function move_mail_junk(array $r,bool $restore): array {
    $folder=$r['meta']['folder']??'';
    $dismiss=$folder==='Inbox' && !empty($r['meta']['junkReason']) && empty($r['meta']['junkReviewed']);
    if ($r['kind']!=='mail' || ($restore?($folder!=='Junk' && !$dismiss):in_array($folder,['Drafts','Sending','Delivery uncertain','Recovery copies','Not in Inbox'],true))) fail('Choose a message that can be moved.');
    if (!$restore && $folder==='Junk') return $r;
    unset($r['meta']['junkPending'],$r['meta']['junkAttempted']);
    if ($restore) $r['meta']['junkReviewed']=true;
    if ($restore && $dismiss) return save_record($r,true);
    if (!empty($r['meta']['remote'])) return file_remote_mail($r,'move',$restore?'Inbox':'Junk',true,true);
    $r['meta']['folder']=$restore?'Inbox':'Junk';
    return save_record($r);
}

function apply_mail_blocks(array $a): void {
    if (!mail_block_rules($a['id'])) return;
    with_account_mail_mutation($a['id'],function()use($a){
        $rules=mail_block_rules($a['id']);
        $q=db()->prepare("SELECT id FROM records WHERE kind='mail' AND json_extract(meta,'$.account')=? AND json_extract(meta,'$.remote')=1 AND json_extract(meta,'$.folder')='Inbox' AND json_type(meta,'$.junkPending')='array' ORDER BY json_extract(meta,'$.junkAttempted'),updated,id LIMIT 3");
        $q->execute([$a['id']]);
        $deadline=microtime(true)+8;
        foreach ($q->fetchAll(PDO::FETCH_COLUMN) as $id) {
            if (microtime(true)>$deadline) break;
            $row=get_record($id);
            $matches=mail_matching_blocks($rules,$row['meta']['from']??'');
            if (!array_intersect($row['meta']['junkPending'],$matches)) {
                unset($row['meta']['junkPending'],$row['meta']['junkAttempted']);
                save_record($row,true,false);
                continue;
            }
            try { move_mail_junk($row,false); }
            catch (HttpError $e) {
                $row['meta']['junkAttempted']=time();
                save_record($row,true,false);
                activity_step('A blocked message could not be moved to Junk. The next sync will reconcile its folder before retrying.','warning');
                throw $e;
            }
        }
    });
}
