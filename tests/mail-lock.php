<?php
declare(strict_types=1);
require dirname(__DIR__).'/app/bootstrap.php';
require dirname(__DIR__).'/app/connectors.php';
if (($argv[1]??'')==='exit-held') {
    with_account_mail_lock($argv[2],static function(){echo 'exited';exit;});
}
if (($argv[1]??'')==='probe') {
    try { with_account_mail_lock($argv[2],static fn()=>null); echo 'acquired'; }
    catch (HttpError $error) { echo $error->getCode(); }
    exit;
}
$testDir=sys_get_temp_dir().'/office-mail-lock-'.bin2hex(random_bytes(8));
putenv('OFFICE_DATA_DIR='.$testDir);
function check(bool $ok,string $message): void {if(!$ok)throw new RuntimeException($message);echo "PASS $message\n";}
function probe(string $account,string $mode='probe'): string {
    $process=proc_open([PHP_BINARY,'-n',__FILE__,$mode,$account],[1=>['pipe','w'],2=>['pipe','w']],$pipes);
    if(!is_resource($process))throw new RuntimeException('Cannot start lock probe.');
    $result=stream_get_contents($pipes[1]);$errors=stream_get_contents($pipes[2]);
    fclose($pipes[1]);fclose($pipes[2]);
    if(proc_close($process)!==0 || $errors!=='')throw new RuntimeException('Lock probe failed: '.$errors);
    return $result;
}
try {
    data_dir();file_put_contents($testDir.'/locks','blocked');
    try {with_account_mail_lock('a',static fn()=>null);throw new RuntimeException('Expected directory failure.');}
    catch(HttpError $error){check($error->getCode()===503,'unavailable lock directory returns 503');}
    unlink($testDir.'/locks');
    with_account_mail_lock('a',function()use($testDir){
        check(is_file($testDir.'/locks/mail-'.hash('sha256','a').'.lock'),'first lock creates its private subfolder');
        check(probe('a')==='409','another PHP process cannot acquire the held account lock');
        check(probe('b')==='acquired','another account proceeds independently');
        check(probe('sync:a')==='acquired','scan lock remains separate from mutation lock');
    });
    check(probe('a')==='acquired','lock releases after success');
    try {with_account_mail_lock('a',static function(){throw new RuntimeException('fixture');});}
    catch(RuntimeException $error){if($error->getMessage()!=='fixture')throw $error;}
    check(probe('a')==='acquired','lock releases after an exception');
    check(probe('a','exit-held')==='exited' && probe('a')==='acquired','operating system releases the lock when its process exits');
    check((glob($testDir.'/mail-*.lock')?:[])===[],'no top-level mail lock files are created');
} finally {
    foreach(glob($testDir.'/locks/*')?:[] as $file)unlink($file);
    if(is_dir($testDir.'/locks'))rmdir($testDir.'/locks');
    if(is_file($testDir.'/locks'))unlink($testDir.'/locks');
    rmdir($testDir);
}
