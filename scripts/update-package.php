<?php
declare(strict_types=1);

if (PHP_SAPI!=='cli') exit(1);
require dirname(__DIR__).'/app/bootstrap.php';

try {
    if (($argv[1]??null)==='drain') {
        $lock=fopen(data_dir().'/update-requests.lock','c+b');
        if (!$lock) throw new RuntimeException('Could not open the request lock.');
        $deadline=microtime(true)+120;
        do {
            if (flock($lock,LOCK_EX|LOCK_NB)) exit(0);
            usleep(200000);
        } while (microtime(true)<$deadline);
        throw new RuntimeException('Office still has active requests. Wait for them to finish and retry.');
    }
    if (($argv[1]??null)!=='download' || !office_release_version_valid($argv[2]??null)
        || !preg_match('/^[a-f0-9]{32}$/D',$argv[3]??'')) throw new RuntimeException('Invalid update arguments.');
    [$script,$action,$version,$job]=$argv;
    if (!version_compare($version,office_release_version(),'>')) throw new RuntimeException('The update must be newer than the installed release.');
    $manifest=office_fetch_release($version);
    if ($manifest===null) throw new RuntimeException('The signed release is no longer available.');
    $asset=$manifest['assets']['windows'];
    $name=office_release_asset_name($version,'windows');
    $path=office_update_dir()."/$job/package.zip";
    $file=fopen($path,'xb');
    if (!$file) throw new RuntimeException('Could not create the staged ZIP.');
    try {
        $status=office_update_fetch(OFFICE_RELEASES."/download/v$version/$name",static fn(string $chunk): int=>fwrite($file,$chunk)?:0,$asset['size'],240);
    } finally { fclose($file); }
    if ($status!==200 || filesize($path)!==$asset['size'] || !hash_equals($asset['sha256'],hash_file('sha256',$path))) {
        throw new RuntimeException('The Windows package failed its signed integrity check.');
    }
} catch (Throwable $error) {
    fwrite(STDERR,$error->getMessage().PHP_EOL);
    exit(1);
}
