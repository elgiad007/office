<?php
declare(strict_types=1);

function local_junk_rows(): array {
    return db()->query("SELECT id,revision FROM records WHERE kind='mail' AND COALESCE(json_extract(meta,'$.remote'),0)=0 AND json_extract(meta,'$.folder')='Junk'")->fetchAll(PDO::FETCH_KEY_PAIR);
}

function gmail_junk_ids(callable $request): array {
    $ids=[];$seen=[];$page='';$deadline=microtime(true)+45;
    do {
        mail_deadline($deadline);
        $response=$request('?'.http_build_query(['labelIds'=>'SPAM','includeSpamTrash'=>'true','maxResults'=>500]+($page!==''?['pageToken'=>$page]:[])));
        if (!is_array($response['messages']??[]) || !is_string($response['nextPageToken']??'')) fail('Gmail returned an invalid Spam listing.');
        foreach ($response['messages']??[] as $message) {
            $id=$message['id']??null;
            if (!is_string($id) || !preg_match('/^[a-zA-Z0-9_-]+$/D',$id)) fail('Gmail returned an invalid message identifier.');
            $ids[$id]=$id;
        }
        $page=$response['nextPageToken']??'';
        if ($page!=='' && (isset($seen[$page]) || count($seen)>=100)) fail('Gmail Spam listing did not complete.');
        $seen[$page]=true;
    } while ($page!=='');
    return array_values($ids);
}

function imap_junk_selection(array $account,mixed $socket,string $folder,bool $write): array {
    $catalog=imap_folder_catalog($account,$socket);
    if (mail_folder_find($catalog,$folder)['role']!=='Junk') fail('This folder is no longer the account’s Junk folder.',409);
    $capabilities=implode('',imap_command($socket,'CAPABILITY')['lines']);
    if (imap_is_gmail($account) || preg_match('/\bX-GM-EXT-1\b/i',$capabilities)) fail('Use Gmail on the web or connect through Google authorization to permanently empty Spam.');
    if (!preg_match('/\b(?:UIDPLUS|IMAP4REV2)\b/i',$capabilities)) fail('This IMAP server does not support targeted permanent deletion.');
    $selected=imap_command($socket,($write?'SELECT ':'EXAMINE ').imap_quote($folder));
    if ($write && preg_match('/\[READ-ONLY\]/i',implode('',$selected['lines']))) fail('The Junk folder is read-only.');
    return ['validity'=>imap_validity($selected),'ids'=>array_values(array_unique(imap_search_ids($socket,'ALL')))];
}

function expunge_imap_junk(mixed $socket,array $batch): array {
    $uids=implode(',',$batch);
    imap_command($socket,'UID STORE '.$uids.' +FLAGS.SILENT (\\Deleted)');
    imap_command($socket,'UID EXPUNGE '.$uids);
    return array_values(array_diff($batch,imap_search_ids($socket,'UID '.$uids)));
}

function preview_empty_junk(string $accountId,string $folder): array {
    if ($accountId==='') {
        if ($folder!=='') fail('Choose Local Junk.');
        return ['account'=>'','folder'=>'','name'=>'Local Junk','ids'=>local_junk_rows()];
    }
    return with_account_mail_lock($accountId,function()use($accountId,$folder){
        $account=account($accountId);
        $preview=['account'=>$accountId,'folder'=>$folder,'type'=>$account['type']];
        if ($account['type']==='google' && $folder==='SPAM') {
            if (!google_can_delete_mail($account)) return $preview+['authorize'=>true,'ids'=>[]];
            $token=google_token($account);
            $ids=gmail_junk_ids(fn($path)=>google_json('https://gmail.googleapis.com/gmail/v1/users/me/messages'.$path,$token));
            return $preview+['name'=>$account['label'].' / Spam','ids'=>$ids];
        }
        if ($account['type']!=='imap') fail('Choose the account’s Junk or Spam folder.');
        return $preview+['name'=>$account['label'].' / '.imap_folder_decode($folder)]
            +imap_with_connection($account,fn($socket)=>imap_junk_selection($account,$socket,$folder,false));
    });
}

function forget_deleted_junk(array $preview,array $ids): void {
    $provider="json_extract(meta,'$.providerId')";
    $scope="kind='mail' AND json_extract(meta,'$.remote')=1 AND json_extract(meta,'$.account')=?";
    $args=[$preview['account']];
    if ($preview['type']==='imap') {
        $scope.=" AND json_extract(meta,'$.serverFolder')=? AND CAST(json_extract(meta,'$.uidValidity') AS TEXT)=?";
        array_push($args,$preview['folder'],$preview['validity']);
    }
    $placeholders=implode(',',array_fill(0,count($ids),'?'));
    db()->prepare("DELETE FROM records WHERE $scope AND CAST($provider AS TEXT) IN ($placeholders)")->execute(array_merge($args,$ids));
}

function empty_junk_batches(array $preview,array $live,callable $remove): array {
    $ids=array_values(array_intersect($preview['ids'],$live));
    $result=['deleted'=>0,'skipped'=>count($preview['ids'])-count($ids),'unconfirmed'=>count($ids)];
    $deadline=microtime(true)+35;
    foreach (array_chunk($ids,200) as $batch) {
        if (microtime(true)>$deadline) {
            $result['warning']='The operation reached its time limit. Review the folder before starting again.';
            break;
        }
        try {
            $confirmed=$remove($batch);
            if ($confirmed) forget_deleted_junk($preview,$confirmed);
            $result['deleted']+=count($confirmed);
            $result['unconfirmed']-=count($confirmed);
            if (count($confirmed)!==count($batch)) {
                $result['warning']='The server still reports some targeted messages in Junk.';
                break;
            }
        } catch (HttpError $e) {
            $result['warning']=$e->getMessage().' Refresh the folder before starting again.';
            break;
        }
    }
    return $result;
}

function empty_junk(array $preview): array {
    if ($preview['account']==='') return with_account_mail_mutation('',function()use($preview){
        $db=db();$db->beginTransaction();
        try {
            $delete=$db->prepare("DELETE FROM records WHERE id=? AND revision=? AND kind='mail' AND COALESCE(json_extract(meta,'$.remote'),0)=0 AND json_extract(meta,'$.folder')='Junk'");
            $deleted=0;
            foreach ($preview['ids'] as $id=>$revision) {
                $delete->execute([$id,$revision]);
                $deleted+=$delete->rowCount();
            }
            $db->commit();
            return ['deleted'=>$deleted,'skipped'=>count($preview['ids'])-$deleted,'unconfirmed'=>0];
        } catch (Throwable $e) { $db->rollBack();throw $e; }
    });
    return with_account_mail_mutation($preview['account'],function()use($preview){
        $account=account($preview['account']);
        if ($account['type']!==$preview['type']) fail('The mail account changed. Review the folder again.',409);
        if ($account['type']==='google') {
            if (!google_can_delete_mail($account)) fail('Authorize permanent deletion for this Gmail account first.',403);
            $token=google_token($account);
            $base='https://gmail.googleapis.com/gmail/v1/users/me/messages';
            $live=gmail_junk_ids(fn($path)=>google_json($base.$path,$token));
            return empty_junk_batches($preview,$live,function($batch)use($base,$token){
                web_request($base.'/batchDelete','POST',['Authorization: Bearer '.$token,'Content-Type: application/json'],json_encode(['ids'=>$batch],JSON_THROW_ON_ERROR));
                return $batch;
            });
        }
        return imap_with_connection($account,function($socket)use($account,$preview){
            $live=imap_junk_selection($account,$socket,$preview['folder'],true);
            if ($live['validity']!==$preview['validity']) fail('The mailbox identity changed. Review the folder again.',409);
            return empty_junk_batches($preview,$live['ids'],fn($batch)=>expunge_imap_junk($socket,$batch));
        });
    });
}
