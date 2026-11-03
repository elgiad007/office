<?php
declare(strict_types=1);
$testDir=sys_get_temp_dir().'/office-gmail-imap-'.bin2hex(random_bytes(8));
putenv('OFFICE_DATA_DIR='.$testDir);
require __DIR__.'/imap.php';
require dirname(__DIR__).'/app/formats.php';
require dirname(__DIR__).'/app/mail-folders.php';
try {
    $folders=imap_list_folders(['lines'=>[
        "* LIST () \"/\" Trash\r\n", "* LIST () \"/\" Archive\r\n",
        "* LIST (\\All) \"/\" \"[Gmail]/Tous les messages\"\r\n",
        "* LIST (\\Trash) \"/\" \"[Gmail]/Corbeille\"\r\n",
    ],'literals'=>[]]);
    check(imap_resolve_folder($folders,'Trash','trash',true,true)==='[Gmail]/Corbeille','Gmail system Trash wins over custom Trash label');
    check(imap_resolve_folder($folders,'Archive','archive',true,true)==='[Gmail]/Tous les messages','Gmail All Mail wins over custom Archive label');
    check(imap_resolve_folder($folders,'Trash','trash')==='Trash','generic IMAP retains configured path precedence');
    check(imap_resolve_folder($folders,'[Gmail]/Corbeille','trash',true,true)==='[Gmail]/Corbeille','explicit Gmail paths retained');
    refused(fn()=>imap_resolve_folder(['Trash'=>$folders['Trash']],'Trash','trash',true,true),'system folder was not found');
    check(imap_gmail_message_id(['lines'=>["* 1 FETCH (UID 99 X-GM-MSGID 123)\r\n","* 2 FETCH (X-GM-MSGID 18446744073709551615\r\n"," UID 42)\r\n","A1 OK done\r\n"]],'42')==='18446744073709551615','Gmail identity stays an exact unsigned string and matches the correct FETCH tuple');
    foreach (['INBOX','[Gmail]/All Mail','Travel'] as $source) {
        fixture([
            ['UID FETCH 42 (UID X-GM-MSGID)',"* 1 FETCH (UID 42 X-GM-MSGID 9001)\r\n{tag} OK done\r\n"],
            ['UID MOVE 42 "[Gmail]/Trash"',"{tag} OK moved\r\n"],
            ['EXAMINE '.imap_quote($source),"* OK [UIDVALIDITY 3] valid\r\n{tag} OK done\r\n"],
            ['UID SEARCH UID 42',"* SEARCH\r\n{tag} OK done\r\n"],
            ['EXAMINE "[Gmail]/Trash"',"* OK [UIDVALIDITY 8] valid\r\n{tag} OK done\r\n"],
            ['UID SEARCH X-GM-MSGID 9001',"* SEARCH 70\r\n{tag} OK done\r\n"],
            ['UID FETCH 70 (UID X-GM-MSGID)',"* 1 FETCH (UID 70 X-GM-MSGID 9001)\r\n{tag} OK done\r\n"],
        ],function($s) use($source) {
            $location=imap_move_verified($s,'42','[Gmail]/Trash','Move',$source,true);
            check($location['gmailMessageId']==='9001' && $location['providerId']==='70','Gmail Trash verifies identity from '.$source.' even if destination UID predates UIDNEXT');
        });
    }
    db()->prepare('INSERT INTO accounts (id,label,type,config,secret) VALUES(?,?,?,?,?)')->execute(['gmail-fixture','Fixture','imap','{}','']);
    $a=['id'=>'gmail-fixture','label'=>'Fixture','config'=>['host'=>'imap.gmail.com']];
    $raw=base64_encode('Identical bytes do not prove Gmail identity');
    $rows=[];
    foreach (['source'=>'INBOX','all'=>'[Gmail]/All Mail','other'=>'Travel'] as $id=>$path) {
        $rows[$id]=save_record(['kind'=>'mail','title'=>'Fixture','body'=>'Body','meta'=>['remote'=>true,'account'=>$a['id'],'folder'=>$id==='source'?'Inbox':($id==='all'?'Archive':'Custom folder'),'serverFolder'=>$path,'uidValidity'=>'3','providerId'=>'42','source'=>mail_source($path,'3','42'),'rawBase64'=>$raw]],true);
    }
    fixture([
        ['UID FETCH 42 (UID X-GM-MSGID)',"* 1 FETCH (UID 42 X-GM-MSGID 9001)\r\n{tag} OK done\r\n"],
        ['EXAMINE "[Gmail]/All Mail"',"* OK [UIDVALIDITY 3] valid\r\n{tag} OK done\r\n"],
        ['UID FETCH 42 (UID X-GM-MSGID)',"* 1 FETCH (UID 42 X-GM-MSGID 9001)\r\n{tag} OK done\r\n"],
        ['EXAMINE "Travel"',"* OK [UIDVALIDITY 3] valid\r\n{tag} OK done\r\n"],
        ['UID FETCH 42 (UID X-GM-MSGID)',"* 1 FETCH (UID 42 X-GM-MSGID 9002)\r\n{tag} OK done\r\n"],
        ['SELECT "INBOX"',"* OK [UIDVALIDITY 3] valid\r\n{tag} OK done\r\n"],
    ],function($s) use($a,$rows) {
        $related=imap_gmail_move_copies($a,$s,$rows['source'],'INBOX','42');
        check($related===[$rows['all']['id']],'legacy cache reconciliation proves Gmail identity before removing a related copy');
        $moved=$rows['source']; $moved['meta']=array_merge($moved['meta'],['folder'=>'Trash','gmailMessageId'=>'9001','serverFolder'=>'[Gmail]/Trash','uidValidity'=>'8','providerId'=>'70','source'=>mail_source('[Gmail]/Trash','8','70')]);
        save_imap_gmail_move($moved,$related);
        check(count(mail_cache_rows($a['id']))===2 && get_record($rows['other']['id'])['meta']['serverFolder']==='Travel','successful move removes only proven cache siblings and preserves distinct byte-identical mail');
    });
    fixture([
        ['CAPABILITY',"* CAPABILITY IMAP4rev1 MOVE X-GM-EXT-1\r\n{tag} OK done\r\n"],
        ['LIST "" "*"',"* LIST () \"/\" INBOX\r\n* LIST () \"/\" Trash\r\n* LIST (\\All) \"/\" \"[Gmail]/All Mail\"\r\n* LIST (\\Trash) \"/\" \"[Gmail]/Trash\"\r\n{tag} OK done\r\n"],
        ['EXAMINE "INBOX"',"* OK [UIDVALIDITY 3] valid\r\n{tag} OK done\r\n"],
        ['UID SEARCH ALL',"* SEARCH\r\n{tag} OK done\r\n"],
        ['EXAMINE "[Gmail]/All Mail"',"* OK [UIDVALIDITY 1] valid\r\n{tag} OK done\r\n"],
        ['UID SEARCH ALL',"* SEARCH\r\n{tag} OK done\r\n"],
        ['EXAMINE "[Gmail]/Trash"',"* OK [UIDVALIDITY 8] valid\r\n{tag} OK done\r\n"],
        ['UID SEARCH ALL',"* SEARCH 70\r\n{tag} OK done\r\n"],
        ['EXAMINE "INBOX"',"* OK [UIDVALIDITY 3] valid\r\n{tag} OK done\r\n"],
        ['EXAMINE "[Gmail]/All Mail"',"* OK [UIDVALIDITY 1] valid\r\n{tag} OK done\r\n"],
        ['EXAMINE "[Gmail]/Trash"',"* OK [UIDVALIDITY 8] valid\r\n{tag} OK done\r\n"],
        ['UID FETCH 70 (UID FLAGS X-GM-MSGID)',"* 1 FETCH (UID 70 FLAGS (\\Seen) X-GM-MSGID 9001)\r\n{tag} OK done\r\n"],
    ],function($s) use($a,$rows) {
        check(imap_sync_stream($a,$s)===0,'Gmail sync refreshes system Trash flags without redownloading cached content');
        $cached=mail_cache_rows($a['id']);
        check(count($cached)===2 && get_record($rows['source']['id'])['meta']['folder']==='Trash' && get_record($rows['source']['id'])['meta']['gmailMessageId']==='9001','sync preserves verified Trash identity without resurrecting Inbox or All Mail copies');
    });
    db()->prepare('INSERT INTO accounts (id,label,type,config,secret) VALUES(?,?,?,?,?)')->execute(['large-fixture','Large fixture','imap','{}','']);
    set_setting('preferences',['mailOffline'=>true]);
    $largeAccount=['id'=>'large-fixture','label'=>'Large fixture','config'=>['host'=>'imap.gmail.com']];
    $headers="Subject: Large message\r\nFrom: sender@example.com\r\nTo: receiver@example.com\r\nMessage-ID: <large@example.com>\r\n\r\n";
    $small="Subject: Normal message after large one\r\n\r\nDownloaded body";
    $largeSteps=[
        ['CAPABILITY',"* CAPABILITY IMAP4rev1 MOVE X-GM-EXT-1\r\n{tag} OK done\r\n"],
        ['LIST "" "*"',"* LIST () \"/\" INBOX\r\n* LIST (\\All) \"/\" \"[Gmail]/All Mail\"\r\n* LIST (\\Trash) \"/\" \"[Gmail]/Trash\"\r\n{tag} OK done\r\n"],
    ];
    foreach(['INBOX'=>['1','2'],'[Gmail]/All Mail'=>[],'[Gmail]/Trash'=>[]] as $path=>$uids){
        $largeSteps[]=['EXAMINE '.imap_quote($path),"* OK [UIDVALIDITY 1] valid\r\n{tag} OK done\r\n"];
        $largeSteps[]=['UID SEARCH ALL','* SEARCH'.($uids?' '.implode(' ',$uids):'')."\r\n{tag} OK done\r\n"];
    }
    $largeSteps[]=['EXAMINE "INBOX"',"* OK [UIDVALIDITY 1] valid\r\n{tag} OK done\r\n"];
    $largeSteps[]=['UID FETCH 1,2 (UID RFC822.SIZE)',"* 1 FETCH (UID 1 RFC822.SIZE 8124123)\r\n* 2 FETCH (RFC822.SIZE ".strlen($small)." UID 2)\r\n{tag} OK done\r\n"];
    $largeSteps[]=['UID FETCH 1 (UID FLAGS X-GM-MSGID BODY.PEEK['.IMAP_HEADER_SECTION.']<0.32768>)','* 1 FETCH (UID 1 FLAGS (\\Seen) X-GM-MSGID 99001 BODY['.IMAP_HEADER_SECTION.']<0> {'.strlen($headers)."}\r\n".$headers.")\r\n{tag} OK done\r\n"];
    $largeSteps[]=['UID FETCH 2 (UID FLAGS X-GM-MSGID BODY.PEEK[])','* 2 FETCH (UID 2 FLAGS () X-GM-MSGID 99002 BODY[] {'.strlen($small)."}\r\n".$small.")\r\n{tag} OK done\r\n"];
    foreach(['[Gmail]/All Mail','[Gmail]/Trash'] as $path)$largeSteps[]=['EXAMINE '.imap_quote($path),"* OK [UIDVALIDITY 1] valid\r\n{tag} OK done\r\n"];
    fixture($largeSteps,function($s) use($largeAccount){
        check(imap_sync_stream($largeAccount,$s)===2,'large message does not abort the following normal download');
        $cache=mail_cache_rows($largeAccount['id']);$byUid=[];foreach($cache as $row)$byUid[$row['meta']['providerId']]=$row;
        check($byUid[1]['title']==='Large message'&&$byUid[1]['meta']['messageSize']===8124123&&$byUid[1]['meta']['headerOnly']===true&&!isset($byUid[1]['meta']['rawBase64']),'large message retains size, headers and identity without pretending to have original EML');
        check($byUid[2]['body']==='Downloaded body'&&!isset($byUid[2]['meta']['headerOnly']),'normal message is still completely downloaded');
        check(!in_array('UID FETCH 1 (UID FLAGS X-GM-MSGID BODY.PEEK[])',ArchiveFixture::$commands,true),'oversized body is never requested');
    });
    // The existing body-free move fixtures also apply to the 8 MB header-only copy.
    fixture([
        ['UID FETCH 1 (UID X-GM-MSGID)',"* 1 FETCH (UID 1 X-GM-MSGID 99001)\r\n{tag} OK done\r\n"],
        ['UID MOVE 1 "[Gmail]/Trash"',"{tag} OK moved\r\n"],
        ['EXAMINE "INBOX"',"* OK [UIDVALIDITY 1] valid\r\n{tag} OK done\r\n"],
        ['UID SEARCH UID 1',"* SEARCH\r\n{tag} OK done\r\n"],
        ['EXAMINE "[Gmail]/Trash"',"* OK [UIDVALIDITY 8] valid\r\n{tag} OK done\r\n"],
        ['UID SEARCH X-GM-MSGID 99001',"* SEARCH 77\r\n{tag} OK done\r\n"],
        ['UID FETCH 77 (UID X-GM-MSGID)',"* 1 FETCH (UID 77 X-GM-MSGID 99001)\r\n{tag} OK done\r\n"],
    ],function($s){check(imap_move_verified($s,'1','[Gmail]/Trash','Move','INBOX',true)['providerId']==='77','large Gmail message can be trashed using identity verification without body download');});
    echo "PASS Gmail IMAP folder collision, message identity, verified Trash, large-message sync and cache reconciliation fixtures (no live moves).\n";
} finally {
    foreach (glob($testDir.'/locks/*')?:[] as $file) @unlink($file); @rmdir($testDir.'/locks');
    foreach (glob($testDir.'/*')?:[] as $file) @unlink($file); @rmdir($testDir);
}
