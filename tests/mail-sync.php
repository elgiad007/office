<?php
declare(strict_types=1);
$testDir=sys_get_temp_dir().'/office-mail-sync-'.bin2hex(random_bytes(8));
putenv('OFFICE_DATA_DIR='.$testDir);
require __DIR__.'/imap.php'; // Includes the scripted peer and verified MOVE regressions.
require dirname(__DIR__).'/app/formats.php';
function make_account(string $id,string $type='imap'): array {
    db()->prepare('INSERT INTO accounts (id,label,type,config,secret) VALUES(?,?,?,?,?)')->execute([$id,'Fixture',$type,'{}','']);
    return ['id'=>$id,'label'=>'Fixture','config'=>[]];
}
function examine_step(string $path,string $validity='100'): array {
    return ['EXAMINE '.imap_quote($path),"* OK [UIDVALIDITY $validity] valid\r\n{tag} OK done\r\n"];
}
function search_step(string $criteria,array $ids): array { return ['UID SEARCH '.$criteria,'* SEARCH'.($ids?' '.implode(' ',$ids):'')."\r\n{tag} OK done\r\n"]; }
function sync_preflight(): array {
    return [['CAPABILITY',"* CAPABILITY IMAP4rev1 MOVE SPECIAL-USE\r\n{tag} OK done\r\n"],['LIST "" "*" RETURN (SPECIAL-USE)',"* LIST () \"/\" INBOX\r\n* LIST (\\Archive) \"/\" \"Saved\"\r\n* LIST (\\Trash) \"/\" \"Deleted\"\r\n{tag} OK done\r\n"]];
}
function download_step(string $uid,string $raw): array {
    return ['UID FETCH '.$uid.' (UID FLAGS BODY.PEEK[])','* 1 FETCH (FLAGS (\Seen) BODY[] {'.strlen($raw)."}\r\n".$raw.' UID '.$uid.")\r\n{tag} OK done\r\n"];
}
try {
    $a=make_account('sync-fixture');
    $raw="Message-ID: <move@example.com>\r\nSubject: Moved mail\r\n\r\nPreserve exact original";
    cache_remote($a,'imap:100:42','mail','Before move','Old body',['providerId'=>'42','folder'=>'Inbox','rawBase64'=>base64_encode($raw)]);
    $old=remote_id($a['id'],'imap:100:42');
    $archiveIds=array_map('strval',range(1,11));
    $steps=[...sync_preflight(),examine_step('INBOX'),search_step('ALL',[]),examine_step('Saved'),search_step('ALL',$archiveIds),examine_step('Deleted'),search_step('ALL',[]),
        examine_step('INBOX'),search_step('HEADER Message-ID "<move@example.com>"',[]),
        examine_step('Saved'),search_step('HEADER Message-ID "<move@example.com>"',['1'])];
    foreach (range(2,11) as $uid) $steps[]=download_step((string)$uid,"Subject: Other $uid\r\n\r\nOther content $uid");
    $steps[]=download_step('1',$raw);
    $steps[]=examine_step('Deleted'); $steps[]=search_step('HEADER Message-ID "<move@example.com>"',[]);
    fixture($steps,function($s) use($a) { check(imap_sync_stream($a,$s)===11,'sync downloads recent Archive and older moved message'); });
    $moved=get_record($old);
    check($moved['meta']['folder']==='Archive' && $moved['meta']['serverFolder']==='Saved' && $moved['meta']['providerId']==='1','external move retains identity with destination folder and UID');
    check($moved['meta']['source']===mail_source('Saved','100','1') && $moved['meta']['read']===true && $moved['body']==='Preserve exact original','UID-after-body and flags decoded into synchronized destination');
    check(count(mail_cache_rows($a['id']))===11,'external move leaves no duplicate or stranded recovery copy');
    $before=mail_cache_rows($a['id']);
    fixture([...sync_preflight(),examine_step('INBOX'),search_step('ALL',[]),['EXAMINE "Saved"',"{tag} NO [NOPERM] denied\r\n"]],function($s) use($a) { refused(fn()=>imap_sync_stream($a,$s),'EXAMINE refused'); });
    check(mail_cache_rows($a['id'])===$before,'failed folder scan does not publish partial deletions or membership');
    $repair=[...sync_preflight(),examine_step('INBOX'),search_step('ALL',[]),examine_step('Saved'),search_step('ALL',$archiveIds),examine_step('Deleted'),search_step('ALL',[]),examine_step('INBOX'),examine_step('Saved')];
    foreach (array_merge(range(2,11),[1]) as $uid) $repair[]=download_step((string)$uid,$uid===1?$raw:"Subject: Other $uid\r\n\r\nRefreshed $uid");
    $repair[]=examine_step('Deleted');
    fixture($repair,function($s) use($a) { check(imap_sync_stream($a,$s,true)===11,'repair fetches every cached member including older messages'); });
    check(get_record($old)['id']===$old,'repair retains stable record identity');
    $cachedIds=array_map(fn($r)=>$r['meta']['providerId'],mail_cache_rows($a['id']));
    $flags=''; foreach ($cachedIds as $index=>$uid) $flags.='* '.($index+1).' FETCH (UID '.$uid.' FLAGS ())'."\r\n";
    $normal=[...sync_preflight(),examine_step('INBOX'),search_step('ALL',[]),examine_step('Saved'),search_step('ALL',$archiveIds),examine_step('Deleted'),search_step('ALL',[]),examine_step('INBOX'),examine_step('Saved'),['UID FETCH '.implode(',',$cachedIds).' (UID FLAGS)',$flags."{tag} OK done\r\n"]];
    foreach (range(2,11) as $uid) $normal[]=download_step((string)$uid,"Subject: Other $uid\r\n\r\nRefreshed $uid");
    $normal[]=examine_step('Deleted');
    fixture($normal,function($s) use($a) { imap_sync_stream($a,$s); });
    check(get_record($old)['meta']['read']===false,'batched flags refresh older cached messages outside the download window');
    $before=mail_cache_rows($a['id']);
    fixture([...sync_preflight(),examine_step('INBOX'),search_step('ALL',[]),examine_step('Saved'),search_step('ALL',$archiveIds),examine_step('Deleted'),search_step('ALL',[]),examine_step('INBOX','101')],function($s) use($a) { refused(fn()=>imap_sync_stream($a,$s),'Mailbox identifiers changed'); });
    check(mail_cache_rows($a['id'])===$before,'UIDVALIDITY changing during a scan leaves the previous view intact');
    $local=save_record(['kind'=>'mail','title'=>'Independent local mail','body'=>'Keep local','meta'=>['folder'=>'Local mail']]);
    publish_mail_snapshot($a,[],[]);
    $recovery=get_record($old);
    check($recovery['meta']['folder']==='Recovery copies' && $recovery['meta']['rawBase64']===base64_encode($raw),'confirmed absent mail is retained separately when recovery is enabled');
    $saved=recovery_mail_action($recovery,'keep-local');
    check(empty($saved['meta']['remote']) && !isset($saved['meta']['account'],$saved['meta']['source']) && $saved['meta']['folder']==='Local mail','Save locally detaches recovery data from provider synchronization');
    publish_mail_snapshot($a,[],[]);
    check(get_record($saved['id'])['body']==='Preserve exact original' && get_record($local['id'])['body']==='Keep local','later sync preserves independent local mail');
    $remaining=mail_cache_rows($a['id'])[0]; recovery_mail_action($remaining,'discard');
    check(count(mail_cache_rows($a['id']))===9,'Discard copy removes only selected recovery record');
    refused(fn()=>recovery_mail_action($local,'discard'),'Choose a recovery copy');
    set_setting('preferences',['keepRecoveryCopies'=>false]);
    publish_mail_snapshot($a,[],[]);
    check(mail_cache_rows($a['id'])===[] && get_record($saved['id'])['meta']['folder']==='Local mail','disabled recovery reconciles absent cache without deleting local mail');
    $source=mail_source('Saved','100','1');
    $returned=['folder'=>'Archive','serverFolder'=>'Saved','uidValidity'=>'100','providerId'=>'1','read'=>true];
    publish_mail_snapshot($a,[$source=>$returned],[$source=>mail_download($a,$source,$raw,$returned)]);
    check(get_record($saved['id'])['meta']['folder']==='Local mail' && count(mail_cache_rows($a['id']))===1,'returning provider message cannot overwrite a saved independent local copy');
    publish_mail_snapshot($a,[],[]);
    set_setting('preferences',[]);
    // Mailbox identity includes the folder as well as UIDVALIDITY and UID.
    $membership=[mail_source('INBOX','9','1')=>['folder'=>'Inbox','serverFolder'=>'INBOX','uidValidity'=>'9','providerId'=>'1'],mail_source('Saved','9','1')=>['folder'=>'Archive','serverFolder'=>'Saved','uidValidity'=>'9','providerId'=>'1']];
    $downloads=[]; foreach ($membership as $source=>$meta) $downloads[$source]=mail_download($a,$source,"Subject: Same UID\r\n\r\n".$meta['folder'],$meta+['read'=>false]);
    publish_mail_snapshot($a,$membership,$downloads);
    check(count(mail_cache_rows($a['id']))===2,'same UID and UIDVALIDITY in different folders never collide');
    $rows=mail_cache_rows($a['id']); $snapshot=$rows;
    $invalid=$downloads; $invalid[array_key_first($invalid)]['kind']='invalid';
    refused(fn()=>publish_mail_snapshot($a,[],$invalid),'Unknown application');
    check(mail_cache_rows($a['id'])===$snapshot,'publishing error rolls back the entire account snapshot');
    // Gmail lists every page before reconciling and uses stable message IDs.
    $g=make_account('gmail-fixture','google');
    cache_remote($g,'gmail:moved','mail','Moved Gmail','Keep Gmail',['folder'=>'Inbox','providerId'=>'moved','rawBase64'=>base64_encode($raw)]);
    $pages=[];
    $transport=function(string $path) use(&$pages,$raw):array {
        $pages[]=$path;
        if (str_starts_with($path,'?')) {
            parse_str(substr($path,1),$q);
            return match($q['q']) {
                'in:inbox'=>isset($q['pageToken'])?['messages'=>[['id'=>'older']]]:['messages'=>[['id'=>'newest']],'nextPageToken'=>'page-two'],
                'in:trash'=>['messages'=>[['id'=>'moved']]],
                default=>[],
            };
        }
        $id=explode('?',ltrim($path,'/'))[0];
        $labels=$id==='moved'?['TRASH']:['INBOX','UNREAD'];
        return str_contains($path,'minimal')?['labelIds'=>$labels]:['labelIds'=>$labels,'raw'=>rtrim(strtr(base64_encode($raw),'+/','-_'),'=')];
    };
    sync_google_mail($g,$transport);
    check(get_record(remote_id($g['id'],'gmail:moved'))['meta']['folder']==='Trash','Gmail move reconciles stable message into Trash');
    check(count(mail_cache_rows($g['id']))===3 && count(array_filter($pages,fn($p)=>str_contains($p,'pageToken=page-two')))===1,'Gmail pagination includes later Inbox pages');
    $before=mail_cache_rows($g['id']);
    refused(fn()=>sync_google_mail($g,function($path) { if (str_contains($path,'pageToken')) fail('fixture page failed'); return ['messages'=>[],'nextPageToken'=>'next']; }),'fixture page failed');
    check(mail_cache_rows($g['id'])===$before,'failed Gmail page does not remove cached messages');
    $pages=[]; sync_google_mail($g,$transport,true);
    check(!array_filter($pages,fn($p)=>str_contains($p,'minimal')),'Gmail repair refreshes raw cached messages instead of metadata only');
    $bad=imap_list_folders(['lines'=>['* LIST (\\Trash) "/" "Bin"'."\r\n"],'literals'=>[]]);
    check(imap_resolve_folder($bad,'Trash','trash')==='Bin','server-designated Trash discovery');
    refused(fn()=>imap_resolve_folder($bad,'Custom','trash'),'not found or is ambiguous');
    check(imap_resolve_folder([],'Trash','trash',false)===null,'absent optional default Trash is not invented');
    refused(fn()=>imap_list_folders(['lines'=>["* LIST invalid data\r\n"],'literals'=>[]]),'unreadable folder list');
    foreach (['Deleted','INBOX'] as $target) {
        fixture([...array_slice(archive_start($target),3),['UID MOVE 42 '.imap_quote($target),"{tag} OK moved\r\n"],...archive_finish($target)],function($s) use($target) {
            $location=imap_move_verified($s,'42',$target);
            check($location['serverFolder']===$target && $location['providerId']==='100' && $location['uidValidity']==='200','Trash/restore retains verified destination identifiers');
        });
    }
    check(gmail_folder(['SENT','UNREAD'])==='Archive','archiving self-sent Gmail remains available outside Inbox');
    echo "PASS mail synchronization, repair and recovery fixtures (no live provider calls).\n";
} finally {
    foreach (glob($testDir.'/*')?:[] as $file) @unlink($file); @rmdir($testDir);
}
