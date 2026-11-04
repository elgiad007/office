<?php
declare(strict_types=1);
require dirname(__DIR__).'/app/bootstrap.php';
function reader_check(bool $value,string $label): void {if(!$value)throw new RuntimeException($label);}
$record=['id'=>'reader-fixture','kind'=>'mail','body'=>'Text alternative','meta'=>['rawBase64'=>base64_encode(str_repeat('Original MIME attachment ',50000)),'bodyRawBase64'=>base64_encode('Downloaded HTML body one'),'headersBase64'=>'headers','mimeParts'=>[['part'=>'1']]]];
$summary=mail_list_record($record);
reader_check($summary['body']===$record['body'],'Text body remains available');
foreach(['rawBase64','bodyRawBase64','headersBase64','mimeParts'] as $key)reader_check(!isset($summary['meta'][$key]),'Original MIME remains on server: '.$key);
$changed=$record;$changed['meta']['bodyRawBase64']=base64_encode('Downloaded HTML body two');$next=mail_list_record($changed);
reader_check($summary['bodyHash']!==$next['bodyHash'],'Downloaded body changes invalidate HTML');
reader_check($summary['contentHash']===$next['contentHash'],'Original mutation identity stays stable');
reader_check($summary['bodyHash']===hash('sha256',$record['meta']['bodyRawBase64']),'HTML fingerprint prefers downloaded body');
$changed['meta']['read']=true;reader_check(mail_list_record($changed)['bodyHash']===$next['bodyHash'],'Metadata refresh preserves HTML fingerprint');
echo 'PASS reader summary and fingerprint; full '.strlen(json_encode($record)).' bytes, compact '.strlen(json_encode($summary))." bytes.\n";
