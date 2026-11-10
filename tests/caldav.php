<?php
declare(strict_types=1);
require __DIR__.'/../app/bootstrap.php';
require __DIR__.'/../app/connectors.php';

function expect_caldav(bool $ok,string $message): void {
    if (!$ok) throw new RuntimeException($message);
}

$mailbox=['type'=>'imap','config'=>['host'=>'mail.example.test','email'=>'luc@example.test'],
    'credentials'=>['username'=>'luc@example.test','password'=>'fixture-password']];
$multistatus=static fn(string $responses): string => '<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">'.$responses.'</d:multistatus>';
$response=static fn(string $href,string $props,string $status='200 OK'): string =>
    '<d:response><d:href>'.$href.'</d:href><d:propstat><d:prop>'.$props.'</d:prop><d:status>HTTP/1.1 '.$status.'</d:status></d:propstat></d:response>';
$calendar='<d:resourcetype><d:collection/><c:calendar/></d:resourcetype>';
$tasks='<c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set>';
$origin='https://mail.example.test:2080';
$responses=[
    $origin.'/.well-known/caldav'=>['status'=>301,'location'=>'/dav/','body'=>''],
    $origin.'/dav/'=>['status'=>207,'location'=>'','body'=>$multistatus($response('/dav/','<d:current-user-principal><d:href>../users/luc/</d:href></d:current-user-principal>'))],
    $origin.'/users/luc/'=>['status'=>207,'location'=>'','body'=>$multistatus($response('/users/luc/','<c:calendar-home-set><d:href>/home/luc/</d:href></c:calendar-home-set>'))],
    $origin.'/home/luc/'=>['status'=>207,'location'=>'','body'=>$multistatus(
        $response('/home/luc/personal/',$calendar.'<d:displayname>Personal</d:displayname>')
        .$response('/home/luc/work/',$calendar.'<d:displayname>Work</d:displayname>')
        .$response('/home/luc/tasks/',$calendar.$tasks)
        .$response('/home/luc/denied/',$calendar,'403 Forbidden')
        .$response('https://other.example.test/cal/',$calendar))],
];
$request=static function(string $url,string $method,array $headers) use ($responses,$origin): array {
    expect_caldav($method==='PROPFIND','Discovery must be read-only.');
    expect_caldav(in_array('Authorization: Basic '.base64_encode('luc@example.test:fixture-password'),$headers,true),'Known mail host should receive saved credentials.');
    expect_caldav(in_array($url===$origin.'/home/luc/'?'Depth: 1':'Depth: 0',$headers,true),'Unexpected discovery depth.');
    return $responses[$url];
};
$result=discover_caldav($mailbox,[$origin.'/.well-known/caldav'=>true],microtime(true)+2,$request);
expect_caldav(array_column($result['calendars'],'label')===['Personal','Work'],'Only readable event collections should be discovered.');

$thirdParty='https://calendar.other.test/dav/';
$request=static function(string $url,string $method,array $headers) use ($origin,$thirdParty): array {
    if ($url===$origin.'/dav/') return ['status'=>302,'location'=>$thirdParty,'body'=>''];
    expect_caldav($url===$thirdParty,'Unexpected redirect target.');
    expect_caldav(!array_filter($headers,static fn($header)=>str_starts_with($header,'Authorization:')),'Discovery sent credentials to an unapproved hostname.');
    return ['status'=>401,'location'=>'','body'=>''];
};
$result=discover_caldav($mailbox,[$origin.'/dav/'=>true],microtime(true)+2,$request);
expect_caldav(($result['approval']??null)===$thirdParty,'An advertised third-party endpoint should require approval.');
foreach (['http://example.test/','https://a:b@example.test/','https://example.test:2079/','https://example.test\\evil/'] as $url) {
    try { caldav_validate_url($url); throw new RuntimeException('Unsafe URL was accepted.'); }
    catch (HttpError) { /* Expected. */ }
}
echo "PASS CalDAV discovery, collection filtering, and credential boundaries.\n";
