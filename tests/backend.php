<?php
declare(strict_types=1);
$testDir=sys_get_temp_dir().'/office-unit-'.bin2hex(random_bytes(8));
putenv('OFFICE_DATA_DIR='.$testDir);
require dirname(__DIR__).'/app/bootstrap.php';
require dirname(__DIR__).'/app/formats.php';
require dirname(__DIR__).'/app/mail-html.php';
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
    $alternative="Content-Type: multipart/alternative;\r\n boundary=\"alt.+\"\r\n\r\nIgnored preamble\r\n--alt.+\r\nContent-Type: text/html\r\n\r\n<p>HTML alternative</p>\r\n--alt.+\r\nContent-Type: text/plain; charset=iso-8859-1\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nCaf=E9 plain body\r\n--alt.+--\r\nIgnored epilogue";
    $nested="Subject: Nested mail\r\nContent-Type: multipart/mixed; boundary=outer\r\n\r\n--outer\r\nContent-Type: text/plain\r\nContent-Disposition: attachment; filename=secret.txt\r\n\r\nDo not show attached text\r\n--outer\r\n".$alternative."\r\n--outer\r\nContent-Type: application/pdf\r\nContent-Transfer-Encoding: base64\r\n\r\n".base64_encode('Do not show binary attachment')."\r\n--outer--\r\n";
    $parsed=parse_eml($nested);check($parsed['body']==='Café plain body' && $parsed['title']==='Nested mail','nested mixed/alternative prefers decoded plain text and excludes attachments');
    check($parsed['meta']['hasHtml'] && eml_html($nested)['html']==='<p>HTML alternative</p>','HTML alternative retained separately from text and attachments');
    $sanitized=safe_mail_html('<style>.heading{color:red}</style><table><tr><td>Layout</td></tr></table><script>alert(1)</script><iframe src="https://evil.invalid"></iframe><meta http-equiv="refresh" content="0;url=https://evil.invalid"><a href="javascript:alert(1)" onclick="alert(1)">Link</a><img src="https://example.invalid/pixel" onerror="alert(1)">',[],false);
    check(str_contains($sanitized,'color:red') && str_contains($sanitized,'<table>') && !str_contains($sanitized,'<script') && !str_contains($sanitized,'<iframe') && !str_contains($sanitized,'http-equiv') && !str_contains($sanitized,'javascript:') && !str_contains($sanitized,'onerror') && !str_contains($sanitized,'https://example.invalid'),'HTML layouts retained while active content and unapproved images removed');
    $cssFixture='/* color:red */ .card{color:rgb(0,0,0) !important;background:linear-gradient(white,#eee),url("https://images.invalid/white.png");font-family:"color:red";margin:0}';
    $darkCss=dark_mail_css($cssFixture);
    check(str_contains($darkCss,'color:oklch(from rgb(0,0,0) max(l, 0.86) c h) !important') && str_contains($darkCss,'linear-gradient(oklch(from white min(l, 0.27) c h),oklch(from #eee min(l, 0.27) c h))'),'dark mail adapts explicit CSS colors and gradients');
    check(str_contains($darkCss,'/* color:red */') && str_contains($darkCss,'url("https://images.invalid/white.png")') && str_contains($darkCss,'font-family:"color:red";margin:0'),'dark mail preserves URLs, CSS strings and layout declarations');
    $officeHtml='<p style="margin:0"><o:p>&nbsp;</o:p></p><font color="000000">Signature</font><script>bad()</script>';
    $officeDark=safe_mail_html($officeHtml,[],false,'dark');
    check(str_contains($officeDark,"<span>\u{00a0}</span>") && str_contains($officeDark,'oklch(from #000000') && !str_contains($officeDark,'<script'),'Outlook spacers and legacy signature colors survive safe dark rendering');
    $htmlSource="Content-Type: multipart/related; boundary=rel; start=\"<root>\"\r\n\r\n--rel\r\nContent-Type: image/png\r\nContent-ID: <image>\r\n\r\nIMAGE\r\n--rel\r\nContent-Type: text/html; charset=iso-8859-1\r\nContent-ID: <root>\r\nContent-Transfer-Encoding: base64\r\n\r\n".base64_encode("<head><title>Hidden title</title></head><style>hidden style</style><script>bad()</script><p>Caf\xe9 &amp; tea</p><p>Next<br>line &lt;safe&gt;</p><img src='https://example.invalid/tracker'>")."\r\n--rel--\r\n";
    check(parse_eml($htmlSource)['body']==="Café & tea\nNext\nline <safe>",'related HTML root decodes charset before text conversion and removes active content');
    check(parse_eml(str_replace("\r\n","\n",$nested))['body']==='Café plain body','LF-only multipart boundaries');
    check(parse_eml("Content-Type: multipart/mixed; boundary=x\r\n\r\n--x\r\nContent-Type: text/plain\r\nContent-Disposition: attachment; filename=a.txt\r\n\r\nAttachment only\r\n--x--")['body']!== 'Attachment only','attachment-only mail has a download fallback');
    check(str_contains(parse_eml("Content-Type: multipart/mixed\r\n\r\nMalformed")['body'],'No readable message body'),'missing boundary falls back without leaking MIME source');
    check(parse_eml("Content-Type: text/plain\r\nContent-Transfer-Encoding: base64\r\n\r\nMA==")['body']==='0','zero-valued decoded body retained');
    $deep="Content-Type: text/plain\r\n\r\nToo deep";for($i=0;$i<23;$i++)$deep="Content-Type: multipart/mixed; boundary=d$i\r\n\r\n--d$i\r\n".$deep."\r\n--d$i--";
    check(str_contains(parse_eml($deep)['body'],'No readable message body'),'MIME nesting limit');
    $many="Content-Type: multipart/mixed; boundary=m\r\n\r\n";for($i=0;$i<505;$i++)$many.="--m\r\nContent-Type: text/plain\r\n\r\nPart $i\r\n";$many.="--m--\r\n";
    check(!str_contains(parse_eml($many)['body'],'Part 504'),'MIME part count limit');
    $legacy=['kind'=>'mail','title'=>'Legacy cache','body'=>'This multipart message is preserved in its original EML format. Download it to view attachments or complex formatting in a full mail client.','meta'=>['multipart'=>true,'rawBase64'=>base64_encode($nested),'folder'=>'Inbox','read'=>false]];
    $cached=save_record($legacy);check($cached['body']==='Café plain body' && $cached['revision']===1 && !$cached['meta']['read'] && $cached['meta']['rawBase64']===base64_encode($nested),'legacy cache displays original body without revision or flag changes');
    $q=db()->prepare('SELECT body FROM records WHERE id=?');$q->execute([$cached['id']]);check($q->fetchColumn()===$legacy['body'],'legacy display does not rewrite stored data');
    $edited=save_record(array_replace($legacy,['title'=>'Local body','body'=>'Keep local edits']));check($edited['body']==='Keep local edits','legacy hydration preserves local body edits');
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
    with_account_mail_lock('fixture-account',function() {
        try { with_account_mail_lock('fixture-account',fn()=>throw new RuntimeException('Overlapping sync acquired the lock')); throw new RuntimeException('Expected lock conflict'); }
        catch(HttpError $e) { check($e->getCode()===409,'sync and archive on the same account cannot overlap'); }
        check(with_account_mail_lock('another-account',fn()=>true),'different accounts may run concurrently');
    });
    try { with_account_mail_lock('fixture-account',fn()=>throw new RuntimeException('fixture failure')); } catch(RuntimeException) {}
    check(with_account_mail_lock('fixture-account',fn()=>true),'account lock released after failure');
} finally {
    // This test-created directory has a fixed unique prefix, never user data.
    foreach (glob($testDir.'/*')?:[] as $file) @unlink($file); @rmdir($testDir);
}
