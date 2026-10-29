<?php
declare(strict_types=1);
$testDir=sys_get_temp_dir().'/office-unit-'.bin2hex(random_bytes(8));
putenv('OFFICE_DATA_DIR='.$testDir);
require dirname(__DIR__).'/app/bootstrap.php';
require dirname(__DIR__).'/app/formats.php';
require dirname(__DIR__).'/app/connectors.php';
function check(bool $condition,string $message): void { if (!$condition) throw new RuntimeException($message); echo "PASS $message\n"; }
try {
    $r=save_record(['kind'=>'wiki','title'=>'home:start','body'=>'Hello','meta'=>[]]);
    $r['body']='Second'; $next=save_record($r); check($next['revision']===2,'revision increments');
    try { save_record($r); throw new RuntimeException('stale write accepted'); } catch(HttpError $e) {check($e->getCode()===409,'stale write rejected');}
    check((int)db()->query('SELECT COUNT(*) FROM revisions')->fetchColumn()===2,'history preserved');
    $encrypted=encrypt_secret(['password'=>'top secret']); check(!str_contains($encrypted,'top secret'),'credential ciphertext'); check(decrypt_secret($encrypted)['password']==='top secret','credential decrypt');
    $ics="BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:event-1\r\nSUMMARY:Hello\\, world\r\nDTSTART;TZID=America/New_York:20261029T090000\r\nRRULE:FREQ=WEEKLY\r\nBEGIN:VALARM\r\nDESCRIPTION:Do not replace event notes\r\nEND:VALARM\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
    $events=parse_ics($ics); check(count($events)===1 && $events[0]['title']==='Hello, world','ICS parses escaped title');check($events[0]['meta']['start']==='2026-10-29T09:00:00-04:00','ICS timezone kept');check($events[0]['body']==='','nested alarm ignored');
    $mail=parse_eml("Subject: =?UTF-8?B?SGVsbG8=?=\r\nFrom: a@example.com\r\nContent-Transfer-Encoding: base64\r\n\r\n".base64_encode('A message'));
    check($mail['title']==='Hello' && $mail['body']==='A message','EML headers and body decode');
    $html=parse_eml("Content-Type: text/html\r\n\r\n<p>Hello</p><img src=x onerror=bad()>");check(!str_contains($html['body'],'<'),'HTML mail rendered as text');
    try {public_host('127.0.0.1');throw new RuntimeException('private endpoint accepted');}catch(HttpError){check(true,'private endpoints blocked');}
    try {validate_record(['kind'=>'sheets','title'=>'bad','body'=>'','meta'=>['workbook'=>['sheets'=>[]]]]);throw new RuntimeException('bad workbook accepted');}catch(HttpError){check(true,'invalid workbook rejected');}
    db()->beginTransaction(); save_record(['kind'=>'tasks','title'=>'rollback','body'=>'','meta'=>[]]); db()->rollBack(); check((int)db()->query("SELECT COUNT(*) FROM records WHERE title='rollback'")->fetchColumn()===0,'batch rollback');
    // Deterministic stream fixture exercises IMAP tagged responses and literal framing without a provider.
    class MailFixture {
        public $context; private string $buffer=''; private int $pos=0;
        public function stream_open($path,$mode,$options,&$opened):bool{return true;}
        public function stream_write($data):int {preg_match('/^(A\d+)/',$data,$m);$this->buffer="* 1 FETCH (BODY[] {5}\r\nhello)\r\n".$m[1]." OK done\r\n";$this->pos=0;return strlen($data);}
        public function stream_read($count):string{$s=substr($this->buffer,$this->pos,$count);$this->pos+=strlen($s);return $s;}
        public function stream_eof():bool{return $this->pos>=strlen($this->buffer);}
        public function stream_stat():array{return [];}
    }
    stream_wrapper_register('mailfixture',MailFixture::class);$stream=fopen('mailfixture://test','r+');$response=imap_command($stream,'UID FETCH 1 (BODY.PEEK[])');check($response['literals']===['hello'],'IMAP literal/tag fixture');fclose($stream);
} finally {
    // This test-created directory has a fixed unique prefix, never user data.
    foreach (glob($testDir.'/*')?:[] as $file) @unlink($file); @rmdir($testDir);
}
