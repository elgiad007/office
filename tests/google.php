<?php
declare(strict_types=1);
putenv('OFFICE_DATA_DIR='.dirname(__DIR__).'/.runtime/google-'.bin2hex(random_bytes(8)));
require dirname(__DIR__).'/app/bootstrap.php';
require dirname(__DIR__).'/app/connectors.php';
require dirname(__DIR__).'/app/account-setup.php';
require dirname(__DIR__).'/app/google.php';
function check(bool $ok, string $message): void { if (!$ok) throw new RuntimeException($message); echo "PASS $message\n"; }
function rejected(callable $fn, string $contains): void {
    try { $fn(); } catch (HttpError $e) { check(str_contains($e->getMessage(),$contains), $contains); return; }
    throw new RuntimeException('Expected rejection: '.$contains);
}
$_SESSION=[];
$settings=['client_id'=>'test.apps.googleusercontent.com','client_secret'=>'fixture-shared-secret','redirect'=>'http://127.0.0.1:8765/api.php?r=oauth-callback'];
rejected(fn()=>start_google_connection(['email'=>'person@example.com']), 'Configure Google integration');
save_google_settings($settings);
check(!str_contains(setting('google_integration'),$settings['client_secret']),'integration is encrypted');
save_google_settings(array_merge($settings,['client_secret'=>'']));
check(google_settings()['client_secret']===$settings['client_secret'],'blank secret retains current client secret');
rejected(fn()=>save_google_settings(array_merge($settings,['client_id'=>'other','client_secret'=>''])), 'client ID and client secret');
rejected(fn()=>save_google_settings(array_merge($settings,['redirect'=>'http://example.com/api.php?r=oauth-callback'])), 'exact HTTPS callback');
rejected(fn()=>save_google_settings(array_merge($settings,['redirect'=>'https://example.com/wrong'])), 'ending in api.php');
$url=start_google_connection(['email'=>'hint@example.com','calendar'=>false]);
parse_str(parse_url($url,PHP_URL_QUERY),$query);
check($query['login_hint']==='hint@example.com' && !str_contains($query['scope'],'calendar'),'email hint and mail-only scope');
check(!str_contains($url,$settings['client_secret']) && !str_contains(json_encode($_SESSION),$settings['client_secret']),'authorization URL and session hide secret');
$oauth=$_SESSION['oauth'];
$tokens=['access_token'=>'fixture-access','refresh_token'=>'fixture-refresh','expires_in'=>3600,'scope'=>'https://www.googleapis.com/auth/gmail.modify'];
rejected(fn()=>finish_google_connection($oauth, array_diff_key($tokens,['refresh_token'=>1]), ['emailAddress'=>'real@example.com']), 'offline authorization');
rejected(fn()=>finish_google_connection($oauth, array_merge($tokens,['scope'=>'']), ['emailAddress'=>'real@example.com']), 'permissions');
check((int)db()->query('SELECT COUNT(*) FROM accounts')->fetchColumn()===0,'failed consent creates no account');
$id=finish_google_connection($oauth,$tokens,['emailAddress'=>'real@example.com']);
$a=account($id);
check($a['config']['email']==='real@example.com' && $a['label']==='real@example.com','provider identity overrides typed hint');
check($a['config']['calendar']===false && $a['credentials']['client_secret']===$settings['client_secret'],'mail-only config and per-account credential snapshot');
rejected(fn()=>finish_google_connection($oauth,$tokens,['emailAddress'=>'REAL@example.com']), 'already connected');
check((int)db()->query('SELECT COUNT(*) FROM accounts')->fetchColumn()===1,'duplicate leaves one account');
save_google_settings(array_merge($settings,['client_id'=>'new.apps.googleusercontent.com','client_secret'=>'new-secret']));
start_google_connection(['id'=>$id]); $reconnect=$_SESSION['oauth'];
check(decrypt_secret($reconnect['credentials'])['client_id']===$settings['client_id'],'reconnect preserves original OAuth client');
rejected(fn()=>finish_google_connection($reconnect,$tokens,['emailAddress'=>'different@example.com']), 'original Google account');
finish_google_connection($reconnect,$tokens,['emailAddress'=>'real@example.com']);
check((int)db()->query('SELECT COUNT(*) FROM accounts')->fetchColumn()===1,'reconnect updates original account');
start_google_connection(['email'=>'second@example.com','calendar'=>true]); $calendar=$_SESSION['oauth'];
rejected(fn()=>finish_google_connection($calendar,$tokens,['emailAddress'=>'second@example.com']), 'permissions');
$tokens['scope'].=' https://www.googleapis.com/auth/calendar.readonly';
$second=finish_google_connection($calendar,$tokens,['emailAddress'=>'second@example.com']);
check(account($second)['config']['calendar']===true,'Calendar grant stored');
$legacy='legacy-google';
db()->prepare('INSERT INTO accounts(id,label,type,config,secret) VALUES(?,?,?,?,?)')->execute([$legacy,'Legacy Google','google',json_encode(['email'=>'legacy@example.com','redirect'=>$settings['redirect']]),encrypt_secret(['client_id'=>'legacy-client','client_secret'=>'legacy-secret'])]);
parse_str(parse_url(start_google_connection(['id'=>$legacy]),PHP_URL_QUERY),$legacyQuery);
check($legacyQuery['client_id']==='legacy-client' && str_contains($legacyQuery['scope'],'calendar.readonly'),'legacy connections retain credentials and Calendar access');
echo "PASS Google connection fixtures (no live provider calls).\n";
