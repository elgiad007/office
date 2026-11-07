<?php
declare(strict_types=1);
$testDir=sys_get_temp_dir().'/office-mail-sync-'.bin2hex(random_bytes(8));
putenv('OFFICE_DATA_DIR='.$testDir);
require __DIR__.'/imap.php'; // Includes the scripted peer and verified MOVE regressions.
require dirname(__DIR__).'/app/formats.php';
require dirname(__DIR__).'/app/mail-folders.php';
require dirname(__DIR__).'/app/mail-empty-junk.php';
require dirname(__DIR__).'/app/mail-export.php';
require dirname(__DIR__).'/app/google.php';
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
function legacy_sync_stream(array $a,mixed $s,bool $repair=false,?string $onlyPath=null,int $limit=10): int {return imap_sync_stream($a,$s,$repair,$onlyPath,$repair?100:$limit);}
try {
    $exportRaw="Subject: Export fixture\r\n\r\nCached body";
    $exportRows=[];
    foreach(['41'=>'100','42'=>'100','43'=>'100','44'=>'99'] as $uid=>$validity){
        $exportRows[]=['id'=>'export-'.$uid,'meta'=>['source'=>mail_source('INBOX',$validity,(string)$uid),'providerId'=>(string)$uid,'serverFolder'=>'INBOX']];
    }
    // A stale record can share a UID with a valid message after UIDVALIDITY changes.
    $exportRows[]=['id'=>'stale-41','meta'=>['source'=>mail_source('INBOX','99','41'),'providerId'=>'41','serverFolder'=>'INBOX']];
    $exportSize=strlen($exportRaw);
    $exportSteps=[
        examine_step('INBOX'),
        ['UID FETCH 41:43 (UID RFC822.SIZE)',"* 1 FETCH (UID 41 RFC822.SIZE $exportSize)\r\n* 2 FETCH (UID 42 RFC822.SIZE $exportSize)\r\n{tag} OK done\r\n"],
        ['UID FETCH 41:42 (UID BODY.PEEK[])',"* 1 FETCH (BODY[] {{$exportSize}}\r\n$exportRaw UID 41)\r\n* 2 FETCH (UID 42 BODY[] {{$exportSize}}\r\n$exportRaw)\r\n{tag} OK done\r\n"],
    ];
    fixture($exportSteps,function($socket)use($exportRows,$exportRaw){
        check(imap_export_bodies($socket,$exportRows,'INBOX')===['export-41'=>$exportRaw,'export-42'=>$exportRaw],
            'mail export batches bodies in one folder and preserves valid messages when a UID is missing or stale');
    });
    $exportAccount=make_account('mail-export-fixture');
    foreach(['41'=>'INBOX','42'=>'INBOX','43'=>'Archive','44'=>'Gone'] as $uid=>$folder){
        $source=mail_source($folder,'100',(string)$uid);
        cache_remote($exportAccount,$source,'mail','Export header','',[
            'providerId'=>(string)$uid,'serverFolder'=>$folder,'headerOnly'=>true,
            'folder'=>$folder==='Gone'?'Recovery copies':$folder
        ]);
    }
    $exportBatches=mail_export_plan();
    check(count($exportBatches)===2 && array_column($exportBatches,'account')===array_fill(0,2,$exportAccount['id'])
        && count($exportBatches[0]['ids'])===1 && count($exportBatches[1]['ids'])===2
        && !in_array(remote_id($exportAccount['id'],mail_source('Gone','100','44')),array_merge(...array_column($exportBatches,'ids')),true),
        'mail export plans one batch per folder and omits unavailable recovery copies');

    set_setting('preferences',['mailOffline'=>true]);
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
    fixture($steps,function($s) use($a) { check(legacy_sync_stream($a,$s)===11,'sync downloads recent Archive and older moved message'); });
    $moved=get_record($old);
    check($moved['meta']['folder']==='Archive' && $moved['meta']['serverFolder']==='Saved' && $moved['meta']['providerId']==='1','external move retains identity with destination folder and UID');
    check($moved['meta']['source']===mail_source('Saved','100','1') && $moved['meta']['read']===true && $moved['body']==='Preserve exact original','UID-after-body and flags decoded into synchronized destination');
    check(count(mail_cache_rows($a['id']))===11,'external move leaves no duplicate or stranded recovery copy');
    $unchanged=get_record($old);
    $same=mail_download($a,$unchanged['meta']['source'],$raw,array_diff_key($unchanged['meta'],array_flip(['rawBase64','remote','account','accountLabel','source'])));
    publish_mail_snapshot($a,[$unchanged['meta']['source']=>$unchanged['meta']],[$unchanged['meta']['source']=>$same],fn($r)=>$r['id']===$old);
    check(get_record($old)['revision']===$unchanged['revision'],'unchanged download preserves the open message revision');
    $same['meta']['read']=false;
    publish_mail_snapshot($a,[$unchanged['meta']['source']=>$same['meta']],[$unchanged['meta']['source']=>$same],fn($r)=>$r['id']===$old);
    check(get_record($old)['revision']===$unchanged['revision']+1,'changed provider read flag still increments the revision');
    $before=mail_cache_rows($a['id']);
    fixture([...sync_preflight(),examine_step('INBOX'),search_step('ALL',[]),['EXAMINE "Saved"',"{tag} NO [NOPERM] denied\r\n"]],function($s) use($a) { refused(fn()=>legacy_sync_stream($a,$s),'EXAMINE refused'); });
    check(mail_cache_rows($a['id'])===$before,'failed folder scan does not publish partial deletions or membership');
    $repair=[...sync_preflight(),examine_step('INBOX'),search_step('ALL',[]),examine_step('Saved'),search_step('ALL',$archiveIds),examine_step('Deleted'),search_step('ALL',[]),examine_step('INBOX'),examine_step('Saved')];
    foreach (array_map(fn($r)=>(int)$r['meta']['providerId'],mail_cache_rows($a['id'])) as $uid) $repair[]=download_step((string)$uid,$uid===1?$raw:"Subject: Other $uid\r\n\r\nRefreshed $uid");
    $repair[]=examine_step('Deleted');
    fixture($repair,function($s) use($a) { check(legacy_sync_stream($a,$s,true)===11,'repair fetches every cached member including older messages'); });
    check(get_record($old)['id']===$old,'repair retains stable record identity');
    $cachedIds=array_map(fn($r)=>$r['meta']['providerId'],mail_cache_rows($a['id']));
    $flags=''; foreach ($cachedIds as $index=>$uid) $flags.='* '.($index+1).' FETCH (UID '.$uid.' FLAGS ())'."\r\n";
    $normal=[...sync_preflight(),examine_step('INBOX'),search_step('ALL',[]),examine_step('Saved'),search_step('ALL',$archiveIds),examine_step('Deleted'),search_step('ALL',[]),examine_step('INBOX'),examine_step('Saved'),['UID FETCH '.imap_uid_set($cachedIds).' (UID FLAGS)',$flags."{tag} OK done\r\n"]];
    $normal[]=examine_step('Deleted');
    fixture($normal,function($s) use($a) { legacy_sync_stream($a,$s); });
    check(!array_filter(ArchiveFixture::$commands,fn($cmd)=>str_contains($cmd,'BODY.PEEK')),'warm sync downloads no cached message bodies');
    check(get_record($old)['meta']['read']===false,'batched flags refresh older cached messages outside the download window');
    // CONDSTORE checkpoints must preserve unchanged flags and advance only after
    // a complete publish, without assuming all servers support the extension.
    $deltaPreflight=sync_preflight();$deltaPreflight[0][1]=str_replace('MOVE SPECIAL-USE','MOVE SPECIAL-USE CONDSTORE',$deltaPreflight[0][1]);
    $deltaSelect=static fn($path,$seq)=>['EXAMINE '.imap_quote($path).' (CONDSTORE)',"* OK [UIDVALIDITY 100] valid\r\n* OK [HIGHESTMODSEQ $seq] state\r\n{tag} OK done\r\n"];
    set_setting('imap-checkpoints:'.$a['id'],['Saved'=>['validity'=>'100','modseq'=>'8']]);
    $delta=[...$deltaPreflight,$deltaSelect('INBOX','10'),search_step('ALL',[]),$deltaSelect('Saved','10'),search_step('ALL',$archiveIds),$deltaSelect('Deleted','10'),search_step('ALL',[]),examine_step('INBOX'),examine_step('Saved'),
        ['UID FETCH '.imap_uid_set($cachedIds).' (UID FLAGS) (CHANGEDSINCE 8)',"* 1 FETCH (UID 1 FLAGS (\\Seen) MODSEQ (9))\r\n{tag} OK done\r\n"],examine_step('Deleted')];
    fixture($delta,function($s)use($a){check(legacy_sync_stream($a,$s)===0,'incremental flags do not download cached bodies');});
    check(get_record($old)['meta']['read']===true,'changed flag applied from CONDSTORE response');
    check(setting('imap-checkpoints:'.$a['id'])['Saved']['modseq']==='10','successful scan advances its initial watermark');
    $unchangedDelta=[...$deltaPreflight,$deltaSelect('INBOX','10'),search_step('ALL',[]),$deltaSelect('Saved','10'),search_step('ALL',$archiveIds),$deltaSelect('Deleted','10'),search_step('ALL',[]),examine_step('INBOX'),examine_step('Saved'),examine_step('Deleted')];
    fixture($unchangedDelta,function($s)use($a){
        imap_sync_stream($a,$s);
        check(!array_filter(ArchiveFixture::$commands,fn($command)=>str_starts_with($command,'UID FETCH ')),'unchanged CONDSTORE watermarks skip every cached flag FETCH');
    });
    check(get_record($old)['meta']['read']===true,'skipped flag checks retain cached read state');
    $checkpoint=setting('imap-checkpoints:'.$a['id']);
    fixture([...$deltaPreflight,$deltaSelect('INBOX','11'),search_step('ALL',[]),['EXAMINE "Saved" (CONDSTORE)',"{tag} NO denied\r\n"]],function($s)use($a){refused(fn()=>legacy_sync_stream($a,$s),'EXAMINE refused');});
    check(setting('imap-checkpoints:'.$a['id'])===$checkpoint,'failed scan cannot advance incremental checkpoints');
    $before=mail_cache_rows($a['id']);
    fixture([...sync_preflight(),examine_step('INBOX'),search_step('ALL',[]),examine_step('Saved'),search_step('ALL',$archiveIds),examine_step('Deleted'),search_step('ALL',[]),examine_step('INBOX','101')],function($s) use($a) { refused(fn()=>legacy_sync_stream($a,$s),'Mailbox identifiers changed'); });
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
    set_setting('preferences',['mailOffline'=>true]);
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
    $pages=[];sync_google_mail($g,$transport);
    check(!array_filter($pages,fn($p)=>str_contains($p,'format=raw')),'warm Gmail sync reuses cached bodies while refreshing labels');
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
    $custom=make_account('custom-folders');
    $inboxMeta=['folder'=>'Inbox','serverFolder'=>'INBOX','uidValidity'=>'100','providerId'=>'88'];
    $inbox=save_record(mail_download($custom,mail_source('INBOX','100','88'),"Subject: Inbox stays\r\n\r\nUnrelated",$inboxMeta),true);
    $customMeta=['folder'=>'Custom folder','serverFolder'=>'Travel/Orders','uidValidity'=>'100','providerId'=>'1'];
    $customRow=save_record(mail_download($custom,mail_source('Travel/Orders','100','1'),$raw,$customMeta),true);
    $listing=sync_preflight();
    $listing[1][1]=str_replace('{tag}',"* LIST () \"/\" \"Travel/Orders\"\r\n{tag}",$listing[1][1]);
    fixture([...$listing,examine_step('Travel/Orders'),search_step('ALL',['1']),examine_step('Travel/Orders'),['UID FETCH 1 (UID FLAGS)',"* 1 FETCH (UID 1 FLAGS (\\Seen))\r\n{tag} OK done\r\n"]],function($s) use($custom) {
        check(legacy_sync_stream($custom,$s,false,'Travel/Orders',20)===0,'custom folder refresh reuses cached content');
    });
    check(get_record($inbox['id'])===$inbox,'custom scan does not reconcile unrelated Inbox');
    check(get_record($customRow['id'])['meta']['read']===true,'custom scan refreshes flags and keeps identity');
    $default=[...$listing,examine_step('INBOX'),search_step('ALL',[]),examine_step('Saved'),search_step('ALL',[]),examine_step('Deleted'),search_step('ALL',[]),examine_step('INBOX'),examine_step('Saved'),examine_step('Deleted')];
    fixture($default,function($s) use($custom) { legacy_sync_stream($custom,$s); });
    check(get_record($customRow['id'])['meta']['folder']==='Custom folder','standard sync preserves unscanned custom folders');
    $before=mail_cache_rows($custom['id']);
    fixture([...$listing,examine_step('Travel/Orders'),search_step('ALL',['1']),examine_step('Travel/Orders','101')],function($s) use($custom) { refused(fn()=>legacy_sync_stream($custom,$s,false,'Travel/Orders'),'Mailbox identifiers changed'); });
    check(mail_cache_rows($custom['id'])===$before,'failed custom scan publishes nothing');
    fixture($listing,function($s) use($custom) {
        $catalog=imap_folder_catalog($custom,$s);
        check(!mail_folder_find($catalog,'Travel/Orders')['protected'] && mail_folder_find($catalog,'Saved')['protected'],'custom catalog protects designated system folders');
    });
    fixture($listing,function($s) use($custom) { refused(fn()=>imap_manage_folder($custom,$s,'delete','Saved',''),'Standard system folders'); });
    fixture([...$listing,examine_step('Travel/Orders'),search_step('ALL',['1'])],function($s) use($custom) { refused(fn()=>imap_manage_folder($custom,$s,'delete','Travel/Orders',''),'Only empty'); });
    $created=$listing;$created[1][1]=str_replace('{tag}',"* LIST () \"/\" \"New folder\"\r\n{tag}",$created[1][1]);
    fixture([...$listing,['CREATE "New folder"',"{tag} OK created\r\n"],...$created],function($s) use($custom) {check(mail_folder_find(imap_manage_folder($custom,$s,'create','','New folder'),'New folder')['name']==='New folder','create confirmed by fresh folder listing');});
    $renamed=$listing;$renamed[1][1]=str_replace('Travel/Orders','Travel/Receipts',$renamed[1][1]);
    fixture([...$listing,['RENAME "Travel/Orders" "Travel/Receipts"',"{tag} OK renamed\r\n"],...$renamed],function($s) use($custom) {imap_manage_folder($custom,$s,'rename','Travel/Orders','Travel/Receipts');});
    check(get_record($customRow['id'])['meta']['source']===mail_source('Travel/Receipts','100','1'),'rename updates cached server identity');
    $deleted=sync_preflight();
    fixture([...$renamed,examine_step('Travel/Receipts'),search_step('ALL',[]),examine_step('INBOX'),['DELETE "Travel/Receipts"',"{tag} OK deleted\r\n"],...$deleted],function($s) use($custom) {imap_manage_folder($custom,$s,'delete','Travel/Receipts','');});
    check(get_record($customRow['id'])['meta']['folder']==='Recovery copies','deleting empty server folder preserves stale local originals in Recovery copies');
    foreach (['Travel & Orders','Voyage été/東京'] as $name) check(imap_folder_decode(imap_folder_encode($name))===$name,'international folder name round trip');
    refused(fn()=>folder_name("Travel\r\nDELETE INBOX"),'without control');
    $labels=gmail_folder_catalog(['labels'=>[['id'=>'Label_travel','name'=>'Travel','type'=>'user'],['id'=>'INBOX','name'=>'INBOX','type'=>'system'],['id'=>'DRAFT','name'=>'DRAFT','type'=>'system']]]);
    check(count($labels)===2 && mail_folder_find($labels,'INBOX')['protected'] && !mail_folder_find($labels,'Label_travel')['protected'],'Gmail separates user and system labels');
    $g2=make_account('label-scans','google');
    $gmailRaw=base64_encode($raw); $paths=[];
    $labelTransport=function($path) use(&$paths,$gmailRaw) {
        $paths[]=$path;
        if(str_starts_with($path,'?')) {parse_str(substr($path,1),$params);return isset($params['pageToken'])?['messages'=>[['id'=>'two']]]:['messages'=>[['id'=>'one']],'nextPageToken'=>'next'];}
        return ['raw'=>$gmailRaw,'labelIds'=>['INBOX','Label_travel','Label_orders']];
    };
    sync_gmail_folder($g2,'Label_travel',10,$labelTransport);
    check(count(mail_cache_rows($g2['id']))===2 && count(array_filter($paths,fn($p)=>str_contains($p,'pageToken')))===1,'Gmail custom label scan follows all pages');
    check(mail_cache_rows($g2['id'])[0]['meta']['labelIds']===['INBOX','Label_travel','Label_orders'],'multiple labels retained on one cached message');
    sync_gmail_folder($g2,'Label_orders',10,$labelTransport);
    check(count(array_filter($paths,fn($p)=>str_contains($p,'format=raw')))===2,'opening another label does not redownload the same originals');
    check(count(mail_cache_rows($g2['id']))===2,'opening a second label does not duplicate Gmail messages');
    sync_gmail_folder($g2,'Label_travel',10,fn($p)=>str_starts_with($p,'?')?[]:['labelIds'=>['INBOX','Label_orders']]);
    check(count(mail_cache_rows($g2['id']))===2 && !in_array('Label_travel',mail_cache_rows($g2['id'])[0]['meta']['labelIds'],true),'removing label elsewhere preserves mail and other labels');
    $before=mail_cache_rows($g2['id']);
    refused(fn()=>sync_gmail_folder($g2,'Label_orders',10,function($p){if(str_starts_with($p,'?'))return ['messages'=>[['id'=>'one']]];fail('label scan failed');}),'label scan failed');
    check(mail_cache_rows($g2['id'])===$before,'Gmail label scan failure keeps previous snapshot');
    // Default headers-first sync must catch a burst larger than its batch and
    // resume older history even when more arrivals appear between passes.
    set_setting('preferences',[]);$busy=make_account('busy-headers');
    $runHeaders=function(array $all,array $fresh,array $existing,int $limit=100)use($busy){
        $steps=[...sync_preflight(),examine_step('INBOX'),search_step('ALL',$all),examine_step('Saved'),search_step('ALL',[]),examine_step('Deleted'),search_step('ALL',[]),examine_step('INBOX')];
        foreach(array_chunk($fresh,25) as $chunk){
            $response='';
            // Reverse server order and put UID after each literal to exercise ownership.
            foreach(array_reverse($chunk) as $uid){$headers="Subject: Busy $uid\r\nFrom: sender@example.com\r\nMessage-ID: <busy-$uid@example.com>\r\n\r\n";$response.='* 1 FETCH (FLAGS () RFC822.SIZE 200 BODY['.IMAP_HEADER_SECTION.'] {'.strlen($headers)."}\r\n".$headers.' UID '.$uid.")\r\n";}
            $steps[]=['UID FETCH '.implode(',',$chunk).' (UID FLAGS RFC822.SIZE BODY.PEEK['.IMAP_HEADER_SECTION.']<0.32768>)',$response."{tag} OK done\r\n"];
        }
        foreach(array_chunk($existing,1000) as $chunk){$flags='';foreach($chunk as $uid)$flags.='* 1 FETCH (UID '.$uid.' FLAGS ())'."\r\n";$steps[]=['UID FETCH '.imap_uid_set($chunk).' (UID FLAGS)',$flags."{tag} OK done\r\n"];}
        $steps[]=examine_step('Saved');$steps[]=examine_step('Deleted');
        fixture($steps,fn($s)=>imap_sync_stream($busy,$s,false,null,$limit));
        check(!array_filter(ArchiveFixture::$commands,fn($cmd)=>str_contains($cmd,'BODY.PEEK[]')),'header batch never downloads full bodies');
        check(count(array_filter(ArchiveFixture::$commands,fn($cmd)=>str_contains($cmd,'BODY.PEEK[')))===(int)ceil(count($fresh)/25),'new headers take one FETCH per 25 messages including sizes');
    };
    $uids=fn($from,$to)=>array_map('strval',range($from,$to));
    activity_begin('Synchronize account','Fixture');
    $runHeaders($uids(1,250),$uids(151,250),[]);
    check(count(array_filter(ArchiveFixture::$commands,fn($command)=>str_starts_with($command,'UID FETCH ')))===4,'100 new messages require four FETCH commands instead of 101');
    activity_finish(true);
    $progress=array_values(array_filter(activity_rows(),fn($entry)=>$entry['phase']==='sync-progress'));
    check((bool)array_filter($progress,fn($entry)=>str_contains($entry['message'],'Downloading older mail · INBOX · batch message 1 of 100 · 250 messages still to cache.')),'real IMAP batches publish folder, batch position and remaining history');
    check(count(mail_cache_rows($busy['id']))===100 && setting('mail-pending:'.$busy['id'])['standard'],'first batch retains 100 newest headers and signals continuation');
    $cachedUids=fn()=>array_map(fn($r)=>$r['meta']['providerId'],mail_cache_rows($busy['id']));
    $runHeaders($uids(1,270),array_merge($uids(71,150),$uids(251,270)),$cachedUids());
    $runHeaders($uids(1,270),$uids(1,70),$cachedUids());
    check(count(mail_cache_rows($busy['id']))===270 && !setting('mail-pending:'.$busy['id'])['standard'],'resumed batches include every message and arrivals between passes');
    $header=get_record(remote_id($busy['id'],mail_source('INBOX','100','1')));
    check($header['meta']['headerOnly'] && $header['body']==='' && !isset($header['meta']['rawBase64']),'normal-sized mail starts as headers only');
    $raw="Subject: Busy 1\r\n\r\nBody downloaded on demand";
    fixture([examine_step('INBOX'),['UID FETCH 1 (UID BODY.PEEK[])',message_response('1',$raw)]],function($s)use($header,$raw){check(imap_mail_content($header,$s)===$raw,'on-demand download verifies mailbox and preserves raw content');});
    fixture([examine_step('INBOX','101')],function($s)use($header){refused(fn()=>imap_mail_content($header,$s),'Mailbox identifiers changed');});
    $g3=make_account('gmail-headers','google');$calls=[];
    $gmailHeaders=function($path)use(&$calls){$calls[]=$path;if(str_starts_with($path,'?')){parse_str(substr($path,1),$q);return ['messages'=>$q['q']==='in:inbox'?array_map(fn($n)=>['id'=>'h'.$n],range(1,125)):[]];}return ['labelIds'=>['INBOX'],'sizeEstimate'=>200,'payload'=>['headers'=>[['name'=>'Subject','value'=>'Gmail header'],['name'=>'From','value'=>'sender@example.com']]]];};
    sync_google_mail($g3,$gmailHeaders);check(count(mail_cache_rows($g3['id']))===100 && setting('mail-pending:'.$g3['id'])['standard'],'Gmail default indexes 100 headers and retains continuation');
    sync_google_mail($g3,$gmailHeaders);check(count(mail_cache_rows($g3['id']))===125 && !setting('mail-pending:'.$g3['id'])['standard'],'Gmail header sync resumes remaining identifiers');
    check(!array_filter($calls,fn($path)=>str_contains($path,'format=raw')),'Gmail headers do not download raw messages');
    set_setting('preferences',['mailOffline'=>true]);$bodyReads=0;
    sync_google_mail($g3,function($path)use($gmailHeaders,&$bodyReads){$msg=$gmailHeaders($path);if(str_contains($path,'format=raw')){$bodyReads++;$msg['raw']=base64_encode("Subject: Gmail header\r\n\r\nOffline body");}return $msg;});
    check($bodyReads===125 && !array_filter(mail_cache_rows($g3['id']),fn($r)=>!empty($r['meta']['headerOnly'])),'enabling offline downloads fills bodies for previously indexed Gmail headers');
    set_setting('preferences',[]);
    $repairBatch=function(bool $repair,int $limit=100)use($busy,$uids){
        $rows=mail_cache_rows($busy['id']);
        $queued=$repair?array_map(fn($r)=>$r['meta']['providerId'],$rows):(setting('imap-repair:'.$busy['id'])['INBOX']['ids']??[]);
        $fetch=array_slice($queued,0,100);
        $steps=[...sync_preflight(),examine_step('INBOX'),search_step('ALL',$uids(1,270)),examine_step('INBOX')];
        foreach($fetch as $uid)$steps[]=download_step($uid,"Subject: Busy $uid\r\n\r\nRepaired body $uid");
        if(!$repair)foreach(array_chunk($rows,1000) as $chunk){$flags='';$ids=[];foreach($chunk as $r){$uid=$r['meta']['providerId'];$ids[]=$uid;$flags.='* 1 FETCH (UID '.$uid.' FLAGS ())'."\r\n";}$steps[]=['UID FETCH '.imap_uid_set($ids).' (UID FLAGS)',$flags."{tag} OK done\r\n"];}
        fixture($steps,fn($s)=>imap_sync_stream($busy,$s,$repair,'INBOX',$limit));
    };
    $repairBatch(true);
    check(count(setting('imap-repair:'.$busy['id'])['INBOX']['ids'])===170,'large repair saves its remaining body identifiers');
    $repairBatch(false,400);
    check(count(setting('imap-repair:'.$busy['id'])['INBOX']['ids'])===70,'larger header windows retain the 100-body repair bound');
    $repairBatch(false);
    check(setting('imap-repair:'.$busy['id'])['INBOX']['ids']===[] && !array_filter(mail_cache_rows($busy['id']),fn($r)=>!empty($r['meta']['headerOnly'])),'later normal syncs complete all 270 repair bodies without restarting');
    $runHeaders($uids(1,670),$uids(271,670),$cachedUids(),400);
    check(count(mail_cache_rows($busy['id']))===670 && !setting('mail-pending:'.$busy['id'])['standard'],'one continuation indexes four header windows without repeating folder scans');
    check(count(array_filter(ArchiveFixture::$commands,fn($command)=>str_starts_with($command,'CAPABILITY')))===1 && count(array_filter(ArchiveFixture::$commands,fn($command)=>str_starts_with($command,'LIST ')))===1,'four continuation windows share capability and folder discovery');
    check(imap_uid_set(['9','2','3','7','8','3','4294967295'])==='2:3,7:9,4294967295','UID ranges preserve gaps, deduplicate and support maximum IMAP UIDs');
    $sparseUids=array_map(static fn($i)=>(string)(3000000000+$i*2),range(1,1000));$flagBatches=imap_flag_batches($sparseUids);
    check(count($flagBatches)===2 && array_merge(...$flagBatches)===$sparseUids && max(array_map(static fn($ids)=>strlen(imap_uid_set($ids)),$flagBatches))<=6000,'large sparse UIDs split into bounded commands without losing messages');
    // A malformed batch cannot publish any of its messages.
    set_setting('preferences',[]);$invalidBatch=make_account('invalid-header-batch');
    $headerCommand='UID FETCH 1,2 (UID FLAGS RFC822.SIZE BODY.PEEK['.IMAP_HEADER_SECTION.']<0.32768>)';
    $headerTuple=static function(string $uid,bool $size=true,bool $flags=true):string {
        $headers="Subject: Header $uid\r\n\r\n";
        return '* 1 FETCH ('.($flags?'FLAGS () ':'').($size?'RFC822.SIZE 100 ':'').'BODY['.IMAP_HEADER_SECTION.'] {'.strlen($headers)."}\r\n".$headers.' UID '.$uid.")\r\n";
    };
    $headerStart=[...sync_preflight(),examine_step('INBOX'),search_step('ALL',['1','2']),examine_step('Saved'),search_step('ALL',[]),examine_step('Deleted'),search_step('ALL',[]),examine_step('INBOX')];
    foreach([
        [$headerTuple('1'),'message size'],
        [$headerTuple('1').$headerTuple('2',false),'message size'],
        [$headerTuple('1').$headerTuple('2',true,false),'message flags'],
    ] as [$response,$reason]){
        fixture([...$headerStart,[$headerCommand,$response."{tag} OK done\r\n"]],function($s)use($invalidBatch,$reason){refused(fn()=>imap_sync_stream($invalidBatch,$s),$reason);});
        check(mail_cache_rows($invalidBatch['id'])===[],'incomplete header batch leaves the cache untouched');
        check(setting('imap-checkpoints:'.$invalidBatch['id'],[])===[],'incomplete batch does not advance checkpoints');
    }
    // An Inbox batch can be exposed without classifying absent mail in other
    // folders. A later folder failure leaves those originals and flags intact.
    $staged=make_account('staged-inbox');
    $archiveSource=mail_source('Saved','100','9');
    $archiveRow=save_record(mail_download($staged,$archiveSource,"Subject: Archive original\r\n\r\nKeep",['folder'=>'Archive','serverFolder'=>'Saved','uidValidity'=>'100','providerId'=>'9','read'=>true]),true);
    activity_begin('Synchronize account','Fixture');
    fixture([...$headerStart,[$headerCommand,$headerTuple('1').$headerTuple('2')."{tag} OK done\r\n"],['EXAMINE "Saved"',"{tag} NO denied\r\n"]],function($s)use($staged){refused(fn()=>with_account_mail_sync($staged['id'],fn()=>imap_sync_stream($staged,$s)),'EXAMINE refused');});
    activity_finish(false,'Fixture folder failure');
    check(count(mail_cache_rows($staged['id']))===3,'validated new Inbox headers survive a later folder failure');
    check(get_record($archiveRow['id'])['meta']['folder']==='Archive' && get_record($archiveRow['id'])['meta']['read']===true,'early Inbox publication never reconciles absent Archive originals');
    check((bool)array_filter(activity_rows(),fn($entry)=>$entry['phase']==='mail-cache-ready'),'early Inbox publication emits a cache-ready event');
    $junk=make_account('junk-fixture','google');
    update_mail_block($junk['id'],'domain','Example.COM');
    $rule=array_values(mail_block_rules($junk['id']))[0];
    $transport=function(string $path)use($rule):array{
        if (str_starts_with($path,'?')) {
            parse_str(substr($path,1),$q);
            return ['messages'=>array_map(fn($id)=>['id'=>$id],match($q['q']){
                'in:inbox'=>['new','old','subdomain'],'in:spam'=>['spam'],default=>[]
            })];
        }
        $id=explode('?',ltrim($path,'/'))[0];
        return ['labelIds'=>[$id==='spam'?'SPAM':'INBOX'],'internalDate'=>($rule['since']+($id==='old'?-1:1))*1000,
            'payload'=>['headers'=>[
                ['name'=>'Subject','value'=>$id],
                ['name'=>'From','value'=>$id==='subdomain'?'Sender <sender@sub.example.com>':'Sender <sender@example.com>'],
                ['name'=>'X-Spam-Status','value'=>'Yes, score=6'],
            ]]];
    };
    sync_google_mail($junk,$transport);
    $row=fn($id)=>get_record(remote_id($junk['id'],'gmail:'.$id));
    check($row('new')['meta']['junkPending']===[$rule['token']] && !isset($row('old')['meta']['junkPending']) && !isset($row('subdomain')['meta']['junkPending']),'blocks apply to new arrivals from the exact domain');
    check($row('new')['meta']['headerOnly'] && isset($row('new')['meta']['junkReason']),'spam verdict is available without a body fetch');
    check($row('spam')['meta']['folder']==='Junk','Gmail Spam maps to Junk in the standard scan');
    move_mail_junk($row('new'),true);
    sync_google_mail($junk,$transport);
    check(!isset($row('new')['meta']['junkPending']) && $row('new')['meta']['junkReviewed'],'Not Junk clears queued moves and survives repeat sync');
    $folders=imap_list_folders(['lines'=>['* LIST () "/" "Spam"','* LIST (\Junk) "/" "Courrier indésirable"'],'literals'=>[]]);
    check(imap_junk_path($junk,$folders)==='Courrier indésirable','IMAP prefers the advertised Junk role over a named fallback');
    update_mail_block($junk['id'],'domain','example.com',true);
    check(mail_block_rules($junk['id'])===[],'removing a rule clears its account entry');
    $listed=gmail_junk_ids(function($path){
        parse_str(substr($path,1),$query);
        check($query['labelIds']==='SPAM' && $query['includeSpamTrash']==='true','Gmail empty preview asks for live Spam membership');
        return isset($query['pageToken'])?['messages'=>[['id'=>'second']]]:['messages'=>[['id'=>'first']],'nextPageToken'=>'next'];
    });
    check($listed===['first','second'],'Gmail empty preview includes subsequent pages');
    $purge=make_account('imap-empty-junk');
    $before=['account'=>$purge['id'],'folder'=>'Junk','type'=>'imap','validity'=>'100','ids'=>['1','2','4']];
    foreach (['1','2','3','4'] as $uid) cache_remote($purge,mail_source('Junk','100',$uid),'mail','Junk '.$uid,'',['folder'=>'Junk','serverFolder'=>'Junk','uidValidity'=>'100','providerId'=>$uid]);
    $ok="{tag} OK done\r\n";
    fixture([
        ['UID STORE 1,4 +FLAGS.SILENT (\\Deleted)',$ok],
        ['UID EXPUNGE 1,4',$ok],
        search_step('UID 1,4',['4']),
    ],function($socket)use($before){
        $result=empty_junk_batches($before,['1','3','4'],fn($batch)=>expunge_imap_junk($socket,$batch));
        check($result['deleted']===1 && $result['skipped']===1 && $result['unconfirmed']===1,'targeted expunge skips arrivals and moved mail and reports partial completion');
        check(count(mail_cache_rows($before['account']))===3,'cache removes only confirmed expunged messages');
    });
    $gmailImap=make_account('gmail-imap-grant');
    $login=['username'=>'fixture@gmail.com','password'=>'imap-fixture-secret'];
    $config=['host'=>'imap.gmail.com','email'=>'other-address@example.com'];
    db()->prepare('UPDATE accounts SET config=?,secret=? WHERE id=?')->execute([json_encode($config),encrypt_secret($login),$gmailImap['id']]);
    $integration=['client_id'=>'client-fixture','client_secret'=>'google-fixture-secret','redirect'=>'https://office.example.com/api.php?r=oauth-callback'];
    set_setting('google_integration',encrypt_secret($integration));
    parse_str(parse_url(start_google_connection(['id'=>$gmailImap['id'],'permanentDelete'=>true]),PHP_URL_QUERY),$consent);
    check($consent['login_hint']===$login['username'] && $consent['scope']==='https://mail.google.com/','Gmail IMAP consent uses the actual IMAP login and full Gmail scope only');
    $tokens=['access_token'=>'access-fixture','refresh_token'=>'refresh-fixture','scope'=>'https://mail.google.com/','expires_in'=>3600];
    refused(fn()=>finish_google_connection($_SESSION['oauth'],$tokens,['emailAddress'=>'other-address@example.com']),'same Gmail account');
    check(gmail_imap_spam_token(account($gmailImap['id']))===null,'authorization for another account leaves no grant');
    finish_google_connection($_SESSION['oauth'],$tokens,['emailAddress'=>$login['username']]);
    $connected=account($gmailImap['id']);
    check($connected['config']===$config && $connected['credentials']===$login && gmail_imap_spam_token($connected)==='access-fixture','grant is reused separately from the unchanged IMAP account');
    $spamPath='[Gmail]/Spam';
    cache_remote($gmailImap,'spam-fixture','mail','Deleted Spam','',['folder'=>'Junk','serverFolder'=>$spamPath,'providerId'=>'12','gmailMessageId'=>'18446744073709551615']);
    cache_remote($gmailImap,'inbox-fixture','mail','Keep Inbox','',['folder'=>'Inbox','providerId'=>'12','gmailMessageId'=>'18446744073709551614']);
    forget_deleted_junk(['account'=>$gmailImap['id'],'type'=>'imap','gmailApi'=>true],['ffffffffffffffff']);
    $remaining=mail_cache_rows($gmailImap['id']);
    check(count($remaining)===1 && $remaining[0]['title']==='Keep Inbox','Gmail API deletion evicts the exact unsigned IMAP identity and preserves an unrelated matching UID');
    $routing=make_account('rule-fixture','google')+['type'=>'google'];
    $definition=[
        'id'=>'b0d030f1-0de2-4352-9a95-8d7565abc123','name'=>'Evening reports','enabled'=>true,'account'=>'',
        'folder'=>'','zone'=>'America/New_York','mode'=>'all','conditions'=>[
            ['field'=>'domain','operator'=>'is','value'=>'EXAMPLE.COM'],
            ['field'=>'date','operator'=>'is','value'=>'2026-11-06'],
            ['field'=>'time','operator'=>'after','value'=>'19:00'],
            ['field'=>'body','operator'=>'contains','value'=>'ready for review'],
        ],
    ];
    $config=save_mail_rules(['version'=>'','rules'=>[$definition]]);
    refused(fn()=>save_mail_rules(['version'=>'','rules'=>[]]),'Mail rules changed');
    $receipt=strtotime('2026-11-07T01:00:00Z');
    $aRule=$config['rules'][0]['definition'];
    $raw="From: Alice <alice@example.com>\r\nSubject: Report\r\nDate: Mon, 1 Jan 2001 00:00:00 +0000\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n<p>Ready for <b>review</b></p>";
    $messages=[];
    foreach (['current'=>$receipt,'historical'=>$receipt-3600,'blocked'=>$receipt] as $id=>$arrived) {
        $messages['gmail:'.$id]=mail_download($routing,'gmail:'.$id,$raw,['providerId'=>$id,'folder'=>'Inbox','junkArrival'=>$arrived]);
    }
    $config['rules'][0]['since']=$receipt-1800;
    set_setting('mail-rules',$config);
    update_mail_block($routing['id'],'sender','alice@example.com');
    $blocks=mail_block_rules($routing['id']);
    $blocks['sender:alice@example.com']['since']=$receipt-60;
    set_setting('mail-blocks:'.$routing['id'],$blocks);
    $messages['gmail:current']['meta']['from']='Bob <bob@example.com>';
    $membership=array_fill_keys(array_keys($messages),['folder'=>'Inbox']);
    publish_mail_snapshot($routing,$membership,$messages);
    $current=get_record(remote_id($routing['id'],'gmail:current'));
    $historical=get_record(remote_id($routing['id'],'gmail:historical'));
    $blocked=get_record(remote_id($routing['id'],'gmail:blocked'));
    check($current['meta']['receivedAt']===$receipt && $current['meta']['rulePending'] &&
        empty($historical['meta']['rulePending']) && !empty($blocked['meta']['junkPending']),'queue only arrivals after rule creation and preserve junk priority');
    check(mail_rule_match($aRule,$current)===null && mail_rule_evaluate($aRule,$routing,$current),'provider receipt crosses the local date boundary and HTML body text matches');
    $any=$aRule;
    $any['mode']='any';
    check(mail_rule_match($any,$current)===true,'any-mode can decide from headers without fetching the body');
    $request=['version'=>$config['version'],'id'=>$aRule['id']];
    $preview=mail_rule_existing($routing,$request,false);
    check(array_column($preview['matches'],'id')===[$current['id']] && $preview['destination']==='Archive','existing-mail preview omits blocked mail and shows the destination');
    $result=mail_rule_existing($routing,$request+['destinationId'=>'','messages'=>[['id'=>$current['id'],'revision'=>0]]],true);
    check($result['moved']===0 && count($result['errors'])===1,'a stale preview cannot move mail');
    echo "PASS mail synchronization, custom folders, repair, recovery and resumable header fixtures (no live provider calls).\n";
} finally {
    foreach (glob($testDir.'/locks/*')?:[] as $file) @unlink($file); @rmdir($testDir.'/locks');
    foreach (glob($testDir.'/*')?:[] as $file) @unlink($file); @rmdir($testDir);
}
