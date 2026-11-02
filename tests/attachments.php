<?php
declare(strict_types=1);
$testDir=sys_get_temp_dir().'/office-attachments-'.bin2hex(random_bytes(8));putenv('OFFICE_DATA_DIR='.$testDir);
require __DIR__.'/imap.php';
require dirname(__DIR__).'/app/formats.php';
require dirname(__DIR__).'/app/mail-folders.php';
try{
    $bytes="\x00\xffBinary\r\nunchanged";
    $raw=attachment_mime_body('Message text',[['name'=>'résumé.pdf','type'=>'application/pdf','bytes'=>$bytes],['name'=>'résumé.pdf','type'=>'application/pdf','bytes'=>'second']]);
    $mail=save_record(['kind'=>'mail','title'=>'Files','body'=>parse_eml($raw)['body'],'meta'=>['folder'=>'Archive','rawBase64'=>base64_encode($raw)]]);
    $files=attachment_manifest($mail);
    check(count($files)===2 && $files[0]['name']==='résumé.pdf' && $files[0]['size']===strlen($bytes),'MIME builder round-trips Unicode filenames, binary bytes and sizes');
    check($mail['body']==='Message text','MIME attachments stay out of the message body');
    check(attachment_bytes($mail,$files[0]['part'])[1]===$bytes,'individual attachment download preserves exact bytes');
    $summary=mail_list_record($mail);$summary['meta']['read']=true;$mail=save_record($summary);
    check(attachment_raw($mail)===$raw,'saving a lightweight local summary preserves the original MIME source');
    $zip=attachment_zip($mail);check(str_starts_with($zip,"PK\x03\x04") && str_contains($zip,'résumé (2).pdf'),'Save all builds a ZIP with unique filenames');
    check(attachment_parameter("attachment; filename*0*=UTF-8''caf%C3; filename*1*=%A9.pdf",'filename')==='café.pdf','RFC 2231 continuation filenames decode');
    check(attachment_name("../../unsafe\r\n\0.pdf")==='_.._unsafe___.pdf','filename paths and controls are sanitized');
    $inline="Content-Type: image/png\r\nContent-Disposition: inline; filename=logo.png\r\nContent-ID: <logo>\r\n\r\nPNG";
    check(!attachment_mime_parts($inline)[0]['attachment'],'inline logos stay separate from file attachments');
    $draft=save_record(['kind'=>'mail','title'=>'Draft','body'=>'Body','meta'=>['folder'=>'Drafts']]);
    $upload=attachment_request(['id'=>$draft['id'],'revision'=>$draft['revision'],'action'=>'upload','name'=>'file.bin','type'=>'application/octet-stream','data'=>base64_encode($bytes)]);
    check($upload['record']['revision']===2 && $upload['attachments'][0]['available'],'upload persists bytes and advances the draft revision');
    refused(fn()=>attachment_request(['id'=>$draft['id'],'revision'=>1,'action'=>'remove','part'=>$upload['attachments'][0]['part']]),'Draft changed');
    check(count(attachment_cached($draft['id']))===1,'stale remove leaves the file intact');
    $local=attachment_request(['id'=>$mail['id'],'action'=>'forward']);
    check(count($local['attachments'])===2 && attachment_draft_files($local['record'])[0]['bytes']===$bytes,'forwarded draft retains attachment bytes');
    $removed=attachment_request(['id'=>$draft['id'],'revision'=>2,'action'=>'remove','part'=>$upload['attachments'][0]['part']]);
    check(!$removed['attachments'] && !$removed['record']['meta']['hasAttachments'],'removing the last file clears the attachment indicator');
    refused(fn()=>attachment_decode('not base64%','base64'),'encoding is invalid');
    refused(fn()=>attachment_request(['id'=>$draft['id'],'revision'=>3,'action'=>'upload','name'=>'large.bin','data'=>base64_encode(str_repeat('x',MAIL_FILE_LIMIT+1))]),'10 MB');
    check(get_record($draft['id'])['revision']===3,'oversized upload rolls back without changing the draft');
    $tree='(("TEXT" "PLAIN" ("CHARSET" "UTF-8") NIL NIL "7BIT" 10 1 NIL NIL)("APPLICATION" "PDF" ("NAME" "report.pdf") NIL NIL "BASE64" 24 NIL ("ATTACHMENT" ("FILENAME" "report.pdf"))) "MIXED" ("BOUNDARY" "x"))';
    $r=['id'=>'fixture','meta'=>['providerId'=>'7','serverFolder'=>'INBOX','source'=>mail_source('INBOX','100','7')]];
    fixture([
        ['EXAMINE "INBOX"',"* OK [UIDVALIDITY 100] valid\r\n{tag} OK done\r\n"],
        ['UID FETCH 7 (UID BODYSTRUCTURE)',"* 1 FETCH (UID 8 BODYSTRUCTURE (\"TEXT\" \"PLAIN\" NIL NIL NIL \"7BIT\" 1 1))\r\n* 2 FETCH (BODYSTRUCTURE ".$tree." UID 7)\r\n{tag} OK done\r\n"],
    ],function($s)use($r){$parts=attachment_imap_metadata($r,$s);check(count($parts)===2 && !$parts[0]['attachment'] && $parts[1]['part']==='2' && $parts[1]['name']==='report.pdf','IMAP metadata discovery selects the requested UID without file downloads');});
    $encoded=base64_encode($bytes);
    fixture([
        ['EXAMINE "INBOX"',"* OK [UIDVALIDITY 100] valid\r\n{tag} OK done\r\n"],
        ['UID FETCH 7 (UID BODY.PEEK[2])','* 1 FETCH (BODY[2] {'.strlen($encoded)."}\r\n".$encoded." UID 7)\r\n{tag} OK done\r\n"],
    ],function($s)use($r,$bytes){check(attachment_imap_file($r,$s,['part'=>'2','encoding'=>'base64'])===$bytes,'on-demand IMAP fetch validates identity and uses BODY.PEEK for the selected part');});
    fixture([['EXAMINE "INBOX"',"* OK [UIDVALIDITY 101] changed\r\n{tag} OK done\r\n"]],function($s)use($r){refused(fn()=>attachment_imap_file($r,$s,['part'=>'2','encoding'=>'base64']),'Mailbox identifiers changed');});
    fixture([
        ['EXAMINE "INBOX"',"* OK [UIDVALIDITY 100] valid\r\n{tag} OK done\r\n"],
        ['UID FETCH 7 (UID BODY.PEEK[2])',"* 1 FETCH (UID 7 BODY[2] {0}\r\n)\r\n{tag} OK done\r\n"],
    ],function($s)use($r){check(attachment_imap_file($r,$s,['part'=>'2','encoding'=>'base64'])==='','zero-byte IMAP attachment downloads as an empty file');});
    $parts=attachment_gmail_parts(['mimeType'=>'multipart/mixed','parts'=>[['partId'=>'0','mimeType'=>'text/plain','body'=>['size'=>4,'data'=>'VGV4dA']],['partId'=>'1','mimeType'=>'application/pdf','filename'=>'scan.pdf','body'=>['size'=>2000000,'attachmentId'=>'remote-file']]]]);
    check(count($parts)===2 && $parts[1]['attachment'] && $parts[1]['gmailAttachment']==='remote-file' && !isset($parts[1]['gmailData']),'Gmail metadata keeps remote attachment IDs separate from file content');
    db()->prepare('INSERT INTO accounts(id,label,type,config,secret) VALUES(?,?,?,?,?)')->execute(['files-recovery','Fixture','imap','{}','']);
    $recovery=save_record(['kind'=>'mail','title'=>'Recovery files','body'=>'Downloaded text','meta'=>['remote'=>true,'account'=>'files-recovery','folder'=>'Recovery copies','mimeParts'=>[['part'=>'2','name'=>'cached.bin','type'=>'application/octet-stream','size'=>strlen($bytes),'attachment'=>true,'encoding'=>'base64','headers'=>[]]]]],true);
    attachment_store($recovery['id'],['part'=>'2','name'=>'cached.bin','type'=>'application/octet-stream'],$bytes);
    $localCopy=recovery_mail_action($recovery,'keep-local');
    check(empty($localCopy['meta']['remote']) && attachment_bytes($localCopy,'2')[1]===$bytes,'saving a recovery copy locally preserves cached file bytes before deleting the source');
    db()->prepare('DELETE FROM records WHERE id=?')->execute([$local['record']['id']]);check(!attachment_cached($local['record']['id']),'deleting a message cascades its cached attachment files');
    echo "PASS attachment MIME, cache, draft, forwarding, ZIP, encoding and provider-part fixtures (no live sends).\n";
}finally{
    foreach(glob($testDir.'/*')?:[] as $file)@unlink($file);@rmdir($testDir);
}
