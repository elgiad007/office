<?php
declare(strict_types=1);
$testDir=sys_get_temp_dir().'/office-mail-index-'.bin2hex(random_bytes(8));mkdir($testDir);putenv('OFFICE_DATA_DIR='.$testDir);
require dirname(__DIR__).'/app/bootstrap.php';
require dirname(__DIR__).'/app/backup.php';
function check_index(bool $ok,string $message): void {if(!$ok)throw new RuntimeException($message);echo "PASS $message\n";}
try {
    // Start with a pre-migration database, including RFC dates from imported mail.
    $legacy=new PDO('sqlite:'.$testDir.'/office.sqlite');
    $legacy->exec('CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,meta TEXT NOT NULL,revision INTEGER NOT NULL,updated TEXT NOT NULL)');
    $insert=$legacy->prepare('INSERT INTO records VALUES(?,?,?,?,?,?,?)');
    for($i=0;$i<205;$i++)$insert->execute([sprintf('mail-%03d',$i),'mail','Message '.$i,'Body '.$i,json_encode(['folder'=>'Inbox','date'=>gmdate(DATE_RFC2822,1700000000+$i),'hasAttachments'=>false,'hasHtml'=>false,'rawBase64'=>base64_encode(str_repeat('original ',100))]),1,'2026-01-01T00:00:00Z']);
    $legacy=null;$db=db();
    check_index((int)$db->query('SELECT COUNT(*) FROM mail_index')->fetchColumn()===205,'legacy mail backfilled');
    $first=mail_list_page(['page'=>'1']);$second=mail_list_page(['page'=>'1','offset'=>'100']);$last=mail_list_page(['page'=>'1','offset'=>'200']);
    check_index(count($first['records'])===100&&$first['mailPage']['total']===205&&$first['mailPage']['more'],'first page is bounded and has full count');
    $ids=array_column(array_merge($first['records'],$second['records'],$last['records']),'id');
    check_index(count(array_unique($ids))===205&&$ids[0]==='mail-204'&&end($ids)==='mail-000'&&!$last['mailPage']['more'],'stable pages in RFC message-date order without gaps');
    check_index(!isset($first['records'][0]['meta']['rawBase64'])&&$first['records'][0]['hasOriginal'],'paged summaries exclude originals');
    check_index(count(mail_list_page(['folder'=>'Inbox'])['records'])===205,'complete scoped view available for search and alternate grouping');
    $plan=implode(' ',array_column($db->query("EXPLAIN QUERY PLAN SELECT id FROM mail_index WHERE folder='Inbox' ORDER BY message_time DESC,id LIMIT 100")->fetchAll(),'detail'));
    check_index(str_contains($plan,'mail_index_folder_date')&&!str_contains($plan,'TEMP B-TREE'),'folder/date query uses covering index without sorting');
    check_index(mail_index_time(['date'=>'invalid','sentAt'=>'2026-01-01T01:00:00+01:00'])===1767225600000&&mail_index_time([])===null,'invalid date falls back to sentAt; missing dates stay undated');
    check_index(mail_index_time(['date'=>'1970-01-01T00:00:00.9999Z'])===999&&mail_index_time(['date'=>'1969-12-31T23:59:59.500Z'])===-500,'timestamps retain browser millisecond precision before and after the epoch');
    $local=save_record(['kind'=>'mail','title'=>'Undated','body'=>'','meta'=>['folder'=>'Inbox','hasAttachments'=>false,'hasHtml'=>false]]);
    $local['meta']['folder']='Junk';save_record($local);
    check_index(mail_list_page(['folder'=>'Local Junk'])['records'][0]['id']===$local['id'],'folder edits update metadata in the same save');
    $db->beginTransaction();$local=get_record($local['id']);$local['meta']['folder']='Trash';save_record($local);$db->rollBack();
    check_index(mail_list_page(['folder'=>'Local Junk'])['records'][0]['id']===$local['id'],'rollback restores both record and index');
    foreach(['imap','google'] as $type)$db->prepare('INSERT INTO accounts(id,label,type,config,secret) VALUES(?,?,?,?,?)')->execute([$type,$type,$type,'{}','']);
    $imap=save_record(['kind'=>'mail','title'=>'IMAP','body'=>'','meta'=>['remote'=>true,'account'=>'imap','folder'=>'Inbox','serverFolder'=>'inbox','hasAttachments'=>false,'hasHtml'=>false]],true);
    $gmail=save_record(['kind'=>'mail','title'=>'Gmail','body'=>'','meta'=>['remote'=>true,'account'=>'google','folder'=>'Inbox','labelIds'=>['INBOX','Label_custom'],'hasAttachments'=>false,'hasHtml'=>false]],true);
    check_index(array_column(mail_list_page(['account'=>'imap','folder'=>'INBOX','page'=>'1'])['records'],'id')===[$imap['id']],'IMAP Inbox comparison preserves case-insensitive behavior');
    check_index(array_column(mail_list_page(['account'=>'google','folder'=>'Label_custom','page'=>'1'])['records'],'id')===[$gmail['id']],'Gmail labels preserve multiple folder membership');
    $gmail['meta']['folder']='Recovery copies';save_record($gmail,true);
    check_index(mail_list_page(['account'=>'google','folder'=>'INBOX'])['records']===[],'recovery copies excluded from account scopes');
    $db->prepare('DELETE FROM records WHERE id=?')->execute([$local['id']]);
    check_index(mail_list_page(['folder'=>'Local Junk'])['records']===[],'deletion cascades into metadata');
    $db->exec('DELETE FROM records');
    restore_office_backup([['id'=>'restored','kind'=>'mail','title'=>'Restored','body'=>'','meta'=>['remote'=>true,'account'=>'old','folder'=>'Archive','date'=>'2026-01-02T00:00:00Z']]],[],[],[],[]);
    check_index(mail_list_page(['folder'=>'Archive'])['records'][0]['id']==='restored'&&(int)$db->query('SELECT remote FROM mail_index')->fetchColumn()===0,'legacy backup restore rebuilds metadata after detaching provider');
    ensure_mail_index($db);check_index((int)$db->query('SELECT COUNT(*) FROM mail_index')->fetchColumn()===1,'migration is idempotent');
} finally {
    foreach(glob($testDir.'/*')?:[] as $file)@unlink($file);@rmdir($testDir);
}
