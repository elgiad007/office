<?php
declare(strict_types=1);
$testDir=sys_get_temp_dir().'/office-undo-'.bin2hex(random_bytes(8));putenv('OFFICE_DATA_DIR='.$testDir);
require __DIR__.'/imap.php';
require dirname(__DIR__).'/app/formats.php';
require dirname(__DIR__).'/app/mail-folders.php';
require dirname(__DIR__).'/app/mail-undo.php';
try{
    $r=save_record(['kind'=>'mail','title'=>'Full local message','body'=>str_repeat('full body ',100),'meta'=>['folder'=>'Archive','rawBase64'=>base64_encode('original EML')]]);
    $r['body'].='edited';$r=save_record($r);
    db()->prepare('INSERT INTO mail_files VALUES(?,?,?,?,?,?)')->execute([$r['id'],'file-1','note.txt','text/plain',4,base64_encode('file')]);
    $raw=db()->query('SELECT * FROM records')->fetchAll();$history=db()->query('SELECT * FROM revisions')->fetchAll();$files=db()->query('SELECT * FROM mail_files')->fetchAll();
    $deleted=delete_local_mail($r);check((int)db()->query('SELECT COUNT(*) FROM records')->fetchColumn()===0,'local mail deleted');
    $restored=undo_mail_delete($deleted['undoToken']);
    check($restored['record']['id']===$r['id']&&db()->query('SELECT * FROM records')->fetchAll()===$raw,'local undo restores full persisted record, same ID and revision');
    check(mail_list_page(['folder'=>'Archive'])['records'][0]['id']===$r['id'],'local undo restores indexed mail listing');
    check(db()->query('SELECT * FROM revisions')->fetchAll()===$history&&db()->query('SELECT * FROM mail_files')->fetchAll()===$files,'local undo restores complete history and attachment bytes');
    refused(fn()=>undo_mail_delete($deleted['undoToken']),'already used');
    db()->prepare('UPDATE mail_undo SET expires=0')->execute();refused(fn()=>undo_mail_delete($deleted['undoToken']),'expired');
    $tooBig=$r;$tooBig['body']=str_repeat('x',65*1024*1024); // Trusted DB can contain a large full record.
    db()->prepare('UPDATE records SET body=? WHERE id=?')->execute([$tooBig['body'],$r['id']]);
    refused(fn()=>delete_local_mail($tooBig),'storage is full');check(get_record($r['id'])['body']===$tooBig['body'],'oversized snapshot rejected before local deletion');
    db()->prepare('UPDATE records SET body=? WHERE id=?')->execute([$r['body'],$r['id']]);
    db()->prepare('INSERT INTO accounts(id,label,type,config,secret) VALUES(?,?,?,?,?)')->execute(['google-undo','Gmail','google','{}',encrypt_secret([])]);
    $g=save_record(['kind'=>'mail','title'=>'Gmail','body'=>'body','meta'=>['remote'=>true,'account'=>'google-undo','providerId'=>'message-1','source'=>'message-1','folder'=>'Trash','labelIds'=>['TRASH','Label_kept']]],true);
    $before=$g;$before['meta']['labelIds']=['INBOX','Label_removed','Label_kept'];$before['meta']['folder']='Inbox';
    $token=mail_undo_receipt(['before'=>$before,'after'=>$g]);$writes=0;
    $request=function($url,$method='GET',$body=null)use(&$writes){
        if($method==='GET')return ['labelIds'=>['TRASH','Label_kept','Label_new']];
        $writes++;check($body===['removeLabelIds'=>['TRASH'],'addLabelIds'=>['INBOX','Label_removed']],'Gmail restores only lost original memberships and removes Trash');
        return ['labelIds'=>['INBOX','Label_kept','Label_removed','Label_new']];
    };
    $result=undo_mail_delete($token,$request);check(in_array('Label_new',$result['record']['meta']['labelIds'],true)&&$writes===1,'Gmail undo preserves unrelated labels and confirms one write');
    $g['revision']=$result['record']['revision'];$g=save_record($g,true);
    $token=mail_undo_receipt(['before'=>$before,'after'=>$g]);
    $uncertain=function($url,$method='GET',$body=null)use(&$writes){if($method==='GET')return ['labelIds'=>['TRASH']];$writes++;throw new RuntimeException('network disconnected');};
    try{undo_mail_delete($token,$uncertain);throw new RuntimeException('uncertain write accepted');}catch(RuntimeException $e){check($e->getMessage()==='network disconnected','uncertain provider outcome surfaced');}
    refused(fn()=>undo_mail_delete($token,$uncertain),'uncertain');check($writes===2,'uncertain undo never repeats a provider write');
    db()->prepare('INSERT INTO accounts(id,label,type,config,secret) VALUES(?,?,?,?,?)')->execute(['imap-undo','IMAP','imap',json_encode(['host'=>'imap.example.com']),encrypt_secret([])]);
    $m=save_record(['kind'=>'mail','title'=>'IMAP','body'=>'body','meta'=>['remote'=>true,'account'=>'imap-undo','providerId'=>'70','serverFolder'=>'Trash','uidValidity'=>'8','source'=>mail_source('Trash','8','70'),'folder'=>'Trash','rawBase64'=>base64_encode('original')]],true);
    $original=$m;$original['meta']['serverFolder']='Projects/Original';$original['meta']['folder']='Custom folder';
    $token=mail_undo_receipt(['before'=>$original,'after'=>$m]);
    ArchiveFixture::$script=[
        ['SELECT "Trash"',"* OK [UIDVALIDITY 8] valid\r\n{tag} OK done\r\n"],
        ['UID SEARCH UID 70',"* SEARCH 70\r\n{tag} OK done\r\n"],
        ['CAPABILITY',"* CAPABILITY IMAP4rev1 MOVE\r\n{tag} OK done\r\n"],
        ['STATUS "Projects/Original" (MESSAGES)',"{tag} OK done\r\n"],
        ['STATUS "Projects/Original" (UIDNEXT)',"* STATUS \"Projects/Original\" (UIDNEXT 100)\r\n{tag} OK done\r\n"],
        ['UID MOVE 70 "Projects/Original"',"{tag} OK [COPYUID 12 70 101] moved\r\n"],
        ['UID SEARCH UID 70',"* SEARCH\r\n{tag} OK done\r\n"],
        ['EXAMINE "Projects/Original"',"* OK [UIDVALIDITY 12] valid\r\n{tag} OK done\r\n"],
        ['UID FETCH 101 (UID FLAGS)',"* 1 FETCH (UID 101 FLAGS (\\Seen))\r\n{tag} OK done\r\n"],
    ];
    $result=undo_mail_delete($token,null,fn()=>fopen('archivefixture://undo','r+'));
    check(!ArchiveFixture::$script&&$result['record']['meta']['providerId']==='101'&&$result['record']['meta']['serverFolder']==='Projects/Original','IMAP undo verifies changed UID in original folder without cached catalog');
    fixture([['UID FETCH 101 (UID X-GM-LABELS)',"* 1 FETCH (UID 101 X-GM-LABELS (\\Inbox \"Work projects\" \"A\\\"B\"))\r\n{tag} OK done\r\n"]],function($s){check(imap_undo_labels($s,'101')===['\\Inbox','Work projects','A"B'],'Gmail IMAP membership parser preserves system, spaced and escaped labels');});
    fixture([
        ['UID FETCH 101 (UID X-GM-LABELS)',"* 1 FETCH (UID 101 X-GM-LABELS (\\Inbox New))\r\n{tag} OK done\r\n"],
        ['UID STORE 101 +X-GM-LABELS ("Old label")',"{tag} OK done\r\n"],
        ['UID FETCH 101 (UID X-GM-LABELS)',"* 1 FETCH (UID 101 X-GM-LABELS (\\Inbox New \"Old label\"))\r\n{tag} OK done\r\n"],
    ],fn($s)=>imap_undo_restore_labels($s,'101',['\\Inbox','Old label'],['\\Trash']));
    check(true,'Gmail IMAP restores lost memberships and preserves newly added labels');
    for($i=0;$i<100;$i++){
        try{mail_undo_receipt(['i'=>$i]);}catch(HttpError $e){check(str_contains($e->getMessage(),'storage is full'),'receipt count bounded before deletion');break;}
    }
    check((int)db()->query('SELECT COUNT(*) FROM mail_undo')->fetchColumn()===100,'receipts are bounded without evicting successful deletions');
}finally{
    // Disposable fixture directory is intentionally left for the OS temp cleaner.
}
