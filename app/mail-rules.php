<?php
declare(strict_types=1);

function mail_rules_config(): array {
    return setting('mail-rules',['version'=>'','rules'=>[]]);
}

function mail_rule_account(string $id): array {
    $a=account($id);
    if (!in_array($a['type'],['imap','google'],true)) fail('Choose a connected mail account.');
    return $a;
}

function mail_rule_folders(array $folders): array {
    return array_values(array_filter($folders,fn($folder)=>!$folder['protected']));
}

function mail_rule_destination(array $rule,array $folders): ?array {
    if ($rule['folder']==='') return ['id'=>'','name'=>'Archive'];
    $matches=array_values(array_filter(mail_rule_folders($folders),fn($folder)=>
        $rule['account']===''?$folder['name']===$rule['folder']:$folder['id']===$rule['folder']));
    return count($matches)===1?$matches[0]:null;
}

function validate_mail_rule(array $rule): array {
    foreach (['id','name','account','folder','mode','zone'] as $key) {
        if (!is_string($rule[$key]??null) || strlen($rule[$key])>500) fail('Invalid mail rule.');
    }
    $name=trim($rule['name']);
    if (!preg_match('/^[a-f0-9-]{36}$/D',$rule['id']) || $name==='' || strlen($name)>120 ||
        !is_bool($rule['enabled']??null) || !in_array($rule['mode'],['all','any'],true) ||
        !in_array($rule['zone'],DateTimeZone::listIdentifiers(DateTimeZone::ALL_WITH_BC),true)) fail('Invalid mail rule settings.');
    $conditions=$rule['conditions']??null;
    if (!is_array($conditions) || !array_is_list($conditions) || count($conditions)<1 || count($conditions)>20) fail('Use 1–20 conditions per rule.');
    foreach ($conditions as &$condition) {
        $field=$condition['field']??null;
        $operator=$condition['operator']??null;
        $value=$condition['value']??null;
        $operators=match($field) {
            'sender','domain'=>['is'],
            'recipient','subject','body'=>['contains','is'],
            'date','time'=>['is','before','after'],
            default=>[],
        };
        if (!in_array($operator,$operators,true) || !is_string($value) || trim($value)==='' || strlen($value)>500) fail('Enter a valid value for every condition.');
        $value=trim($value);
        if ($field==='sender' && !filter_var($value,FILTER_VALIDATE_EMAIL)) fail('Enter a sender email address.');
        if ($field==='domain' && !filter_var('office@'.$value,FILTER_VALIDATE_EMAIL)) fail('Enter an exact sender domain.');
        if ($field==='date' && (!preg_match('/^(\d{4})-(\d{2})-(\d{2})$/D',$value,$m) || !checkdate((int)$m[2],(int)$m[3],(int)$m[1]))) fail('Enter a valid receipt date.');
        if ($field==='time' && !preg_match('/^(?:[01]\d|2[0-3]):[0-5]\d$/D',$value)) fail('Enter a valid receipt time.');
        $condition=compact('field','operator','value');
    }
    return ['name'=>$name,'conditions'=>$conditions]+array_intersect_key($rule,array_flip(['id','account','folder','mode','zone','enabled']));
}

function save_mail_rules(array $input): array {
    $rules=$input['rules']??null;
    if (!is_array($rules) || !array_is_list($rules) || count($rules)>100) fail('Use up to 100 mail rules.');
    $db=db(); $db->beginTransaction();
    try {
        $current=mail_rules_config();
        if (($input['version']??null)!==$current['version']) fail('Mail rules changed. Reload the tab before saving.',409);
        $old=array_column($current['rules'],null,'id'); $saved=[];
        foreach ($rules as $rule) {
            if (!is_array($rule)) fail('Invalid mail rule.');
            $rule=validate_mail_rule($rule);
            $id=$rule['id'];
            if (isset($saved[$id])) fail('Duplicate mail rule.');
            $previous=$old[$id]??null;
            if ($previous===null || $rule!=$previous['definition']) {
                if ($rule['account']!=='' && ($previous===null || $rule['account']!==$previous['definition']['account'] || $rule['folder']!==$previous['definition']['folder'])) {
                    $a=mail_rule_account($rule['account']);
                    if (!mail_rule_destination($rule,setting('mail-folders:'.$a['id'],[]))) fail('Choose an available destination folder.');
                }
                $previous=['id'=>$id,'definition'=>$rule,'since'=>time()];
            }
            $saved[$id]=$previous;
        }
        $config=['version'=>bin2hex(random_bytes(16)),'rules'=>array_values($saved)];
        set_setting('mail-rules',$config);
        $db->commit();
        return $config;
    } catch (Throwable $e) { $db->rollBack(); throw $e; }
}

function mail_rules_for_account(array $config,string $account,?int $arrival=null): array {
    $rules=[];
    foreach ($config['rules'] as $entry) {
        $rule=$entry['definition'];
        if ($rule['enabled'] && ($arrival===null || $arrival>$entry['since']) && in_array($rule['account'],['',$account],true)) $rules[]=$rule;
    }
    return $rules;
}

function mail_rule_sync_meta(array &$row,?array $old,array $config): void {
    $meta=&$row['meta'];
    unset($meta['rulePending'],$meta['ruleAttempted']);
    if (($meta['junkArrival']??0)>0) $meta['receivedAt']=$meta['junkArrival'];
    if (isset($old['receivedAt']) && empty($meta['receivedAt'])) $meta['receivedAt']=$old['receivedAt'];
    if (($meta['folder']??'')!=='Inbox') return;
    if (!empty($old['rulePending'])) {
        $meta['rulePending']=true;
        if (isset($old['ruleAttempted'])) $meta['ruleAttempted']=$old['ruleAttempted'];
    } elseif ($old===null) {
        foreach (mail_rules_for_account($config,$meta['account'],$meta['receivedAt']??0) as $rule) {
            if (mail_rule_match($rule,$row)===false) continue;
            $meta['rulePending']=true;
            break;
        }
    }
}

/** Null means at least one condition still needs a provider read. */
function mail_rule_match(array $rule,array $row,?string $body=null,?int $arrival=null): ?bool {
    $any=$rule['mode']==='any';
    $unknown=false;
    $arrival??=$row['meta']['receivedAt']??null;
    foreach ($rule['conditions'] as $condition) {
        $field=$condition['field']; $operator=$condition['operator']; $value=$condition['value'];
        $actual=match($field) {
            'sender','domain'=>mail_block_target($row['meta']['from']??'',$field)??'',
            'recipient'=>$row['meta']['to']??'',
            'subject'=>$row['title'],
            'body'=>$body,
            'date','time'=>$arrival===null?null:($arrival===0?'':(new DateTimeImmutable('@'.$arrival))
                ->setTimezone(new DateTimeZone($rule['zone']))->format($field==='date'?'Y-m-d':'H:i')),
        };
        if ($actual===null) { $unknown=true; continue; }
        $match=$actual!=='' && match($operator) {
            'before'=>$actual<$value,
            'after'=>$actual>$value,
            'contains'=>preg_match('/'.preg_quote($value,'/').'/iu',$actual)===1,
            'is'=>preg_match('/^'.preg_quote($value,'/').'$/Diu',$actual)===1,
        };
        if ($match===$any) return $any;
    }
    return $unknown?null:!$any;
}

function mail_rule_receipt(array $a,array $row): int {
    if ($a['type']==='google') {
        $msg=google_json('https://gmail.googleapis.com/gmail/v1/users/me/messages/'.rawurlencode($row['meta']['providerId']).'?format=metadata',google_token($a));
        return gmail_junk_arrival($msg);
    }
    return imap_with_connection($a,function($s) use ($row) {
        $path=$row['meta']['serverFolder']??'INBOX'; $uid=(string)($row['meta']['providerId']??'');
        $validity=imap_validity(imap_command($s,'EXAMINE '.imap_quote($path)));
        if (!ctype_digit($uid) || mail_row_source($row)!==mail_source($path,$validity,$uid)) fail('Message location changed. Sync before applying rules.',409);
        return imap_junk_arrival(imap_command($s,'UID FETCH '.$uid.' (UID INTERNALDATE)'));
    });
}

function mail_rule_evaluate(array $rule,array $a,array &$row): bool {
    $match=mail_rule_match($rule,$row);
    if ($match!==null) return $match;
    $fields=array_column($rule['conditions'],'field');
    if (empty($row['meta']['receivedAt']) && array_intersect($fields,['date','time'])) {
        $row['meta']['receivedAt']=mail_rule_receipt($a,$row);
        $match=mail_rule_match($rule,$row);
        if ($match!==null) return $match;
    }
    if (!in_array('body',$fields,true)) return false;
    if (!empty($row['meta']['headerOnly'])) {
        $receipt=$row['meta']['receivedAt']??null;
        $row=download_mail_content($row);
        if ($receipt!==null) $row['meta']['receivedAt']=$receipt;
    }
    $raw=base64_decode($row['meta']['rawBase64']??$row['meta']['bodyRawBase64']??'',true);
    $body=$row['body'];
    if ($raw) {
        [$headers,$content]=eml_entity($raw);
        $remaining=500;
        $body=eml_text($headers,$content,0,$remaining)['body']??'';
    }
    return mail_rule_match($rule,$row,$body)===true;
}

const MAIL_RULE_INBOX = "kind='mail' AND json_extract(meta,'$.remote')=1 AND json_extract(meta,'$.folder')='Inbox' AND json_extract(meta,'$.account')=?";

function mail_rule_move(array $a,array $row,array $rule,array $destination): void {
    unset($row['meta']['rulePending'],$row['meta']['ruleAttempted']);
    if ($destination['id']==='') {
        $undo=null;
        remote_mail_action($row,'archive',$undo,true);
    }
    else file_remote_mail($row,'move',$destination['id'],false,false,true);
    activity_step('Mail rule “'.$rule['name'].'” moved a message to '.$destination['name'].'.');
}

function apply_mail_rules(array $a): void {
    $q=db()->prepare('SELECT id FROM records WHERE '.MAIL_RULE_INBOX." AND json_extract(meta,'$.rulePending')=1 AND json_type(meta,'$.junkPending') IS NULL ORDER BY json_extract(meta,'$.ruleAttempted'),id LIMIT 10");
    $q->execute([$a['id']]); $ids=$q->fetchAll(PDO::FETCH_COLUMN);
    if (!$ids) return;
    with_account_mail_mutation($a['id'],function() use ($a,$ids) {
        $config=mail_rules_config();
        $deadline=microtime(true)+8;
        $folders=null;
        foreach ($ids as $id) {
            if (microtime(true)>$deadline) break;
            $row=get_record($id);
            if (($row['meta']['folder']??'')!=='Inbox' || empty($row['meta']['rulePending']) || !empty($row['meta']['junkPending'])) continue;
            try {
                foreach (mail_rules_for_account($config,$a['id'],$row['meta']['receivedAt']??0) as $rule) {
                    if (!mail_rule_evaluate($rule,$a,$row)) continue;
                    if ($rule['folder']!=='') $folders??=discover_mail_folders($a);
                    $destination=mail_rule_destination($rule,$folders??[]);
                    if (!$destination) fail('The destination folder is unavailable.');
                    mail_rule_move($a,$row,$rule,$destination);
                    continue 2;
                }
                unset($row['meta']['rulePending'],$row['meta']['ruleAttempted']);
                save_record($row,true,false);
            } catch (HttpError $error) {
                $row['meta']['ruleAttempted']=time();
                save_record($row,true,false);
                activity_step('Mail rule processing paused for a message. '.$error->getMessage(),'warning');
            }
        }
    });
}

function mail_rule_existing(array $a,array $input,bool $apply): array {
    $run=function() use ($a,$input,$apply) {
        $config=mail_rules_config();
        if (($input['version']??null)!==$config['version']) fail('Mail rules changed. Reload the tab and preview again.',409);
        $entry=array_column($config['rules'],null,'id')[(string)($input['id']??'')]??null;
        $rule=$entry['definition']??null;
        if (!$rule || !in_array($rule['account'],['',$a['id']],true)) fail('Choose a saved rule for this account.');
        $destination=mail_rule_destination($rule,$rule['folder']===''?[]:discover_mail_folders($a));
        if (!$destination) fail('The destination folder is unavailable for this account.');
        if ($apply && ($input['destinationId']??null)!==$destination['id']) fail('The destination changed. Preview the rule again.',409);
        $matches=[]; $cursor=null; $errors=[]; $moved=0;
        $deadline=microtime(true)+8;
        if ($apply) {
            $items=$input['messages']??null;
            if (!is_array($items) || !array_is_list($items) || count($items)>5 || !$items) fail('Preview up to five messages before applying a rule.');
        } else {
            $after=(string)($input['cursor']??'');
            $q=db()->prepare('SELECT id FROM records WHERE '.MAIL_RULE_INBOX.' AND id>? ORDER BY id LIMIT 101');
            $q->execute([$a['id'],$after]); $ids=$q->fetchAll(PDO::FETCH_COLUMN);
            $items=array_map(fn($id)=>['id'=>$id],array_slice($ids,0,100));
        }
        foreach ($items as $index=>$item) {
            if (microtime(true)>$deadline && $index>0) {
                if ($apply) $errors[]='Time limit reached. Preview again for the remaining messages.';
                break;
            }
            $id=(string)($item['id']??'');
            try {
                $row=get_record($id);
                if ($row['kind']!=='mail' || empty($row['meta']['remote']) || ($row['meta']['folder']??'')!=='Inbox' ||
                    ($row['meta']['account']??'')!==$a['id'] || !empty($row['meta']['junkPending']) ||
                    ($apply && ($item['revision']??null)!==$row['revision'])) {
                    if ($apply) $errors[]='A message changed after the preview. Preview it again.';
                } elseif (mail_rule_evaluate($rule,$a,$row)) {
                    if ($apply) { mail_rule_move($a,$row,$rule,$destination); $moved++; }
                    else $matches[]=array_intersect_key($row,array_flip(['id','title','revision']))+['from'=>$row['meta']['from']??''];
                } elseif ($apply) $errors[]='A message no longer matches the rule.';
            } catch (HttpError $error) {
                $errors[]=$error->getMessage();
                if ($apply) break;
            }
            if (!$apply) {
                $cursor=isset($ids[$index+1])?$id:null;
                if (count($matches)>=5) break;
            }
        }
        return ['matches'=>$matches,'cursor'=>$cursor,'destination'=>$destination['name'],'destinationId'=>$destination['id'],'moved'=>$moved,'errors'=>array_values(array_unique($errors))];
    };
    // Preview can fill the body cache. An in-flight scan must discard older copies.
    return with_account_mail_mutation($a['id'],$run);
}
