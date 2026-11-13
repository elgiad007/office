<?php
declare(strict_types=1);

const OFFICE_RELEASES = 'https://github.com/elgiad007/office/releases';
const OFFICE_UPDATE_MAX_ZIP = 256 * 1024 * 1024;

function office_release_version(): string {
    return trim((string)file_get_contents(__DIR__.'/VERSION'));
}

function office_release_version_valid(mixed $version): bool {
    return is_string($version) && preg_match('/^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$/D',$version)===1;
}

function office_update_dir(): string {
    return dirname(__DIR__).'/.office-update';
}

function office_windows_release(): bool {
    return is_file(__DIR__.'/windows-release');
}

function office_windows_updater(): bool {
    return PHP_OS_FAMILY==='Windows' && office_windows_release() && getenv('OFFICE_PORTABLE_WINDOWS')==='1'
        && in_array($_SERVER['REMOTE_ADDR']??'',['127.0.0.1','::1'],true)
        && function_exists('proc_open') && is_readable(__DIR__.'/release-key.pem');
}

function office_update_request_gate(): void {
    if (PHP_SAPI==='cli' || getenv('OFFICE_PORTABLE_WINDOWS')!=='1' || !office_windows_release()) return;
    $base=basename($_SERVER['SCRIPT_FILENAME']??'');
    if ($base==='api.php' && ($_GET['r']??'')==='update-progress' && ($_SERVER['REQUEST_METHOD']??'')==='GET') return;
    $dir=office_update_dir();
    $marker=$dir.'/maintenance';
    if ($base==='api.php' && ($_GET['r']??'')==='status' && ($_SERVER['REQUEST_METHOD']??'')==='GET' && is_file($marker)) {
        $token=trim((string)file_get_contents($marker));
        if ($token!=='' && hash_equals($token,$_SERVER['HTTP_X_OFFICE_UPDATE_HEALTH']??'')) return;
    }
    $lock=@fopen(installation_data_dir().'/update-requests.lock','c+b');
    if (!$lock || !flock($lock,LOCK_SH|LOCK_NB) || is_file($marker)) {
        http_response_code(503);
        header('Cache-Control: no-store');
        header('Content-Type: application/json; charset=utf-8');
        header('Retry-After: 3');
        echo '{"error":"Office is restarting for an update. Try again shortly."}';
        exit;
    }
    // PHP releases this resource at request shutdown, after application work.
    $GLOBALS['office_update_request_lock']=$lock;
}

function office_update_fetch(string $url, callable $write, int $limit, int $seconds): int {
    if (!extension_loaded('curl')) throw new RuntimeException('The PHP cURL extension is required to check for updates.');
    $received=0;
    $ch=curl_init($url);
    curl_setopt_array($ch,[
        CURLOPT_CONNECTTIMEOUT=>8,CURLOPT_TIMEOUT=>$seconds,CURLOPT_FOLLOWLOCATION=>true,CURLOPT_MAXREDIRS=>3,
        CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS,CURLOPT_REDIR_PROTOCOLS=>CURLPROTO_HTTPS,
        CURLOPT_USERAGENT=>'Portable Office updater',
        CURLOPT_WRITEFUNCTION=>static function($handle,string $chunk) use (&$received,$limit,$write): int {
            if ((int)curl_getinfo($handle,CURLINFO_RESPONSE_CODE)!==200) return strlen($chunk);
            $received+=strlen($chunk);
            return $received<=$limit ? $write($chunk) : 0;
        },
    ]);
    $ok=curl_exec($ch);
    $status=(int)curl_getinfo($ch,CURLINFO_RESPONSE_CODE);
    if (!$ok || ($status!==200 && $status!==404)) throw new RuntimeException('The release server could not be reached. Try again shortly.');
    return $status;
}

function office_release_asset_name(string $version,string $platform): string {
    return "portable-office-v$version-$platform.zip";
}

function office_read_release_manifest(string $envelope,string $key): array {
    $signed=json_decode($envelope,true,8,JSON_THROW_ON_ERROR);
    $payload=is_string($signed['payload']??null)?base64_decode($signed['payload'],true):false;
    $signature=is_string($signed['signature']??null)?base64_decode($signed['signature'],true):false;
    if ($payload===false || $signature===false || openssl_verify($payload,$signature,$key,OPENSSL_ALGO_SHA256)!==1) {
        throw new RuntimeException('The release signature could not be verified.');
    }
    $manifest=json_decode($payload,true,8,JSON_THROW_ON_ERROR);
    if (($manifest['format']??null)!==1 || !office_release_version_valid($manifest['version']??null)) {
        throw new RuntimeException('The signed release manifest is unsupported.');
    }
    foreach (['windows','hosting'] as $platform) {
        $asset=$manifest['assets'][$platform]??null;
        if (!is_int($asset['size']??null) || $asset['size']<1 || $asset['size']>OFFICE_UPDATE_MAX_ZIP
            || !is_string($asset['sha256']??null) || !preg_match('/^[a-f0-9]{64}$/D',$asset['sha256'])) {
            throw new RuntimeException('The signed release manifest has invalid package details.');
        }
    }
    return $manifest;
}

function office_fetch_release(?string $version=null): ?array {
    $keyFile=__DIR__.'/release-key.pem';
    if (!is_readable($keyFile)) throw new RuntimeException('This build has no release signing key. Open GitHub Releases to check manually.');
    if (!extension_loaded('openssl')) throw new RuntimeException('The PHP OpenSSL extension is required to verify updates.');
    if ($version!==null && !office_release_version_valid($version)) throw new RuntimeException('Invalid release version.');
    $path=$version===null?'latest/download':"download/v$version";
    $body='';
    $status=office_update_fetch(OFFICE_RELEASES."/$path/office-update.json",static function(string $chunk) use (&$body): int {
        $body.=$chunk;
        return strlen($chunk);
    },65536,20);
    if ($status===404) return null;
    try { $manifest=office_read_release_manifest($body,(string)file_get_contents($keyFile)); }
    catch (JsonException) { throw new RuntimeException('The release manifest could not be read.'); }
    if ($version!==null && $manifest['version']!==$version) throw new RuntimeException('The signed release version does not match the requested version.');
    return $manifest;
}

function office_update_check(): array {
    $installed=office_release_version();
    $platform=office_windows_release()?'windows':'hosting';
    $manifest=office_fetch_release();
    $latest=$manifest['version']??null;
    $available=$latest!==null && version_compare($latest,$installed,'>');
    return [
        'installed'=>$installed,'latest'=>$latest,'available'=>$available,
        'canInstall'=>$available && office_windows_updater(),
        'download'=>$available?OFFICE_RELEASES."/download/v$latest/".office_release_asset_name($latest,$platform):null,
        'notes'=>$latest!==null?OFFICE_RELEASES."/tag/v$latest":null,
    ];
}

function office_queue_update(mixed $version): string {
    if (!office_windows_updater()) fail('Installation from Office is available in signed Windows releases.',403);
    if (!office_release_version_valid($version) || !version_compare($version,office_release_version(),'>')) fail('Choose a newer Office release.');
    $root=dirname(__DIR__);
    $dir=office_update_dir();
    if (!is_dir($dir) && !@mkdir($dir,0700) && !is_dir($dir)) fail('Office cannot create its private update directory.',503);
    $id=bin2hex(random_bytes(16));
    $pending=@fopen($dir.'/pending','x');
    if (!$pending) fail('An update is already in progress. Check the Updates page or the Windows recovery instructions.',409);
    try {
        $port=filter_var($_SERVER['SERVER_PORT']??null,FILTER_VALIDATE_INT,['options'=>['min_range'=>1024,'max_range'=>65535]]);
        if (!$port) throw new RuntimeException('Office could not identify its local server port.');
        if (!@mkdir("$dir/$id",0700) || !@copy("$root/scripts/update-windows.ps1","$dir/$id/recover.ps1")) {
            throw new RuntimeException('Office could not prepare the Windows recovery script.');
        }
        if (fwrite($pending,$id)!==strlen($id)) throw new RuntimeException('Office could not record the update.');
        fclose($pending);
        $powershell=getenv('SystemRoot').'\System32\WindowsPowerShell\v1.0\powershell.exe';
        $process=proc_open([$powershell,'-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',
            'scripts/update-windows.ps1','-Launch','-Job',$id,'-Version',$version,'-Port',(string)$port],
            [['file','NUL','r'],['file','NUL','w'],['file','NUL','w']],$pipes,$root,null,['bypass_shell'=>true]);
        if (!is_resource($process) || proc_close($process)!==0) throw new RuntimeException('Office could not start the Windows updater.');
    } catch (Throwable $error) {
        if (is_resource($pending)) fclose($pending);
        @unlink($dir.'/pending');
        throw $error;
    }
    return $id;
}

function office_update_progress(mixed $job): array {
    if (!office_windows_updater() || !is_string($job) || !preg_match('/^[a-f0-9]{32}$/D',$job)) fail('Update not found.',404);
    $dir=office_update_dir();
    $status=@file_get_contents("$dir/$job/state");
    $phase=trim((string)$status);
    if (!in_array($phase,['downloading','waiting','installing','complete','failed','recovery'],true)) {
        if (@file_get_contents($dir.'/pending')!==$job) fail('Update not found.',404);
        $phase='downloading';
    }
    if (in_array($phase,['complete','failed'],true) && @file_get_contents($dir.'/maintenance')===$job) $phase='installing';
    return ['phase'=>$phase,'installed'=>office_release_version()];
}
