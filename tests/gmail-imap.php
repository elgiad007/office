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
            ['UID FETCH 42 (UID BODY.PEEK[])',message_response('42')],
            ['UID FETCH 42 (UID X-GM-MSGID)',"* 1 FETCH (UID 42 X-GM-MSGID 9001)\r\n{tag} OK done\r\n"],
            ['UID MOVE 42 "[Gmail]/Trash"',"{tag} OK moved\r\n"],
            ['EXAMINE '.imap_quote($source),"* OK [UIDVALIDITY 3] valid\r\n{tag} OK done\r\n"],
            ['UID SEARCH UID 42',"* SEARCH\r\n{tag} OK done\r\n"],
            ['EXAMINE "[Gmail]/Trash"',"* OK [UIDVALIDITY 8] valid\r\n{tag} OK done\r\n"],
            ['UID SEARCH X-GM-MSGID 9001',"* SEARCH 70\r\n{tag} OK done\r\n"],
            ['UID FETCH 70 (UID BODY.PEEK[])',message_response('70')],
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
        ['UID FETCH 70 (UID FLAGS X-GM-MSGID BODY.PEEK[])','* 1 FETCH (UID 70 FLAGS (\\Seen) X-GM-MSGID 9001 BODY[] {'.strlen(base64_decode($raw))."}\r\n".base64_decode($raw).")\r\n{tag} OK done\r\n"],
    ],function($s) use($a,$rows) {
        check(imap_sync_stream($a,$s)===1,'Gmail sync reads system Trash rather than custom Trash label');
        $cached=mail_cache_rows($a['id']);
        check(count($cached)===2 && get_record($rows['source']['id'])['meta']['folder']==='Trash' && get_record($rows['source']['id'])['meta']['gmailMessageId']==='9001','sync preserves verified Trash identity without resurrecting Inbox or All Mail copies');
    });
    echo "PASS Gmail IMAP folder collision, message identity, verified Trash and cache reconciliation fixtures (no live moves).\n";
} finally {
    foreach (glob($testDir.'/*')?:[] as $file) @unlink($file); @rmdir($testDir);
}
