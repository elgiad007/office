<?php
declare(strict_types=1);
require dirname(__DIR__).'/app/bootstrap.php';
require dirname(__DIR__).'/app/connectors.php';

function check(bool $ok,string $message):void { if (!$ok) throw new RuntimeException($message); echo "PASS $message\n"; }
// Scripted IMAP peer validates exact commands and returns tagged responses.
class ArchiveFixture {
    public $context;
    public static array $script=[];
    public static array $commands=[];
    private string $buffer='';
    private int $position=0;
    public function stream_open($path,$mode,$options,&$opened):bool { return true; }
    public function stream_write($data):int {
        if (!preg_match('/^(A\d+) (.*)\r\n$/s',$data,$m)) throw new RuntimeException('Invalid command framing');
        self::$commands[]=$m[2];
        $step=array_shift(self::$script);
        if (!$step || $m[2]!==$step[0]) throw new RuntimeException('Unexpected command: '.$m[2]);
        $this->buffer=str_replace('{tag}',$m[1],$step[1]); $this->position=0;
        return strlen($data);
    }
    public function stream_read($count):string { $part=substr($this->buffer,$this->position,$count); $this->position+=strlen($part); return $part; }
    public function stream_eof():bool { return false; } // Like a connected socket, stays open between commands.
    public function stream_stat():array { return []; }
}
stream_wrapper_register('archivefixture',ArchiveFixture::class);
function fixture(array $steps,callable $test):void {
    ArchiveFixture::$script=$steps; ArchiveFixture::$commands=[];
    $s=fopen('archivefixture://test','r+');
    try { $test($s); check(!ArchiveFixture::$script,'script completed'); }
    finally { fclose($s); }
}
function refused(callable $run,string $expected):void {
    try { $run(); throw new RuntimeException('Expected IMAP rejection'); }
    catch(HttpError $e) { check(str_contains($e->getMessage(),$expected),$expected); }
}
function preflight(string $listing,string $capabilities='IMAP4rev1 MOVE',string $folder='Archive'):array {
    return [
        ['CAPABILITY',"* CAPABILITY $capabilities\r\n{tag} OK done\r\n"],
        ['LIST "" "*"'.(str_contains($capabilities,'SPECIAL-USE')?' RETURN (SPECIAL-USE)':''),$listing."{tag} OK done\r\n"],
        ['STATUS '.imap_quote($folder).' (MESSAGES)',"* STATUS ".imap_quote($folder)." (MESSAGES 0)\r\n{tag} OK done\r\n"],
    ];
}
function message_response(string $id,string $body='Original message'):string {
    return '* 1 FETCH (UID '.$id.' BODY[] {'.strlen($body)."}\r\n".$body.")\r\n{tag} OK done\r\n";
}
function archive_start(string $folder='Archive'):array {
    return [...preflight('* LIST () "." '.imap_quote($folder)."\r\n",folder:$folder),
        ['UID FETCH 42 (UID BODY.PEEK[])',message_response('42')],
        ['STATUS '.imap_quote($folder).' (UIDNEXT)',"* STATUS ".imap_quote($folder)." (UIDNEXT 100)\r\n{tag} OK done\r\n"],
    ];
}
function archive_finish(string $folder='Archive'):array {
    return [
        ['UID SEARCH UID 42',"* SEARCH\r\n{tag} OK done\r\n"],
        ['EXAMINE '.imap_quote($folder),"* OK [UIDVALIDITY 200] valid\r\n{tag} OK [READ-ONLY] done\r\n"],
        ['UID SEARCH UID 100:*',"* SEARCH 100\r\n{tag} OK done\r\n"],
        ['UID FETCH 100 (UID BODY.PEEK[])',message_response('100')],
    ];
}
fixture([...archive_start(),['UID MOVE 42 "Archive"',"{tag} OK moved\r\n"],...archive_finish()],function($s) { imap_archive($s,'42','Archive'); check(count(array_filter(ArchiveFixture::$commands,fn($cmd)=>str_starts_with($cmd,'UID MOVE ')))===1,'one UID MOVE with verified source and destination'); });
fixture([...archive_start('INBOX.Archive'),['UID MOVE 42 "INBOX.Archive"',"{tag} OK moved\r\n"],...archive_finish('INBOX.Archive')],function($s) { imap_archive($s,'42','Archive'); check(true,'default resolves namespaced Archive'); });
fixture(preflight("* LIST (\\Archive) \"/\" \"Saved mail\"\r\n",'IMAP4rev1 MOVE SPECIAL-USE','Saved mail'),function($s) { check(imap_archive_folder($s,'Archive')==='Saved mail','special-use archive discovery'); });
fixture(preflight("* LIST (\\Archive) \"/\" {10}\r\nSaved mail\r\n",folder:'Saved mail'),function($s) { check(imap_archive_folder($s,'Archive')==='Saved mail','literal folder discovery'); });
fixture(preflight("* LIST () NIL \"Archive\"\r\n",'IMAP4rev2'),function($s) { check(imap_archive_folder($s,'Archive')==='Archive','IMAP4rev2 includes MOVE'); });
fixture(preflight("* LIST (\\Archive) \"/\" Other\r\n* LIST () \"/\" Archive\r\n"),function($s) { check(imap_archive_folder($s,'Archive')==='Archive','existing configured path takes priority over special-use'); });
$escaped='Saved "mail"';
fixture(preflight('* LIST () "/" '.imap_quote($escaped)."\r\n",folder:$escaped),function($s) use($escaped) { check(imap_archive_folder($s,$escaped)===$escaped,'quoted folder names unescape and re-quote correctly'); });
$statusDenied=preflight("* LIST () \".\" Archive\r\n");
$statusDenied[2][1]="{tag} NO [NOPERM] private text\r\n";
fixture($statusDenied,function($s) { refused(fn()=>imap_archive($s,'42','Archive'),'STATUS refused (NO / NOPERM)'); check(count(ArchiveFixture::$commands)===3,'failed folder validation sends no MOVE'); });
fixture([['CAPABILITY',"* CAPABILITY IMAP4rev1 UIDPLUS\r\n{tag} OK done\r\n"]],function($s) { refused(fn()=>imap_archive($s,'42','Archive'),'does not support MOVE'); check(count(ArchiveFixture::$commands)===1,'unsupported MOVE sends no mutation'); });
foreach (["* LIST () \".\" INBOX\r\n", "* LIST (\\Noselect) \".\" Archive\r\n", "* LIST () \".\" One.Archive\r\n* LIST () \".\" Two.Archive\r\n"] as $listing) {
    fixture(array_slice(preflight($listing),0,2),function($s) { refused(fn()=>imap_archive($s,'42','Archive'),'not found or is ambiguous'); check(count(ArchiveFixture::$commands)===2,'missing or ambiguous folder sends no mutation'); });
}
fixture(array_slice(preflight("* LIST (\\Archive) \".\" INBOX.Archive\r\n"),0,2),function($s) { refused(fn()=>imap_archive($s,'42','Custom'),'not found or is ambiguous'); check(true,'explicit folder is never replaced'); });
fixture(array_slice(preflight("* LIST () \".\" INBOX\r\n"),0,2),function($s) { refused(fn()=>imap_archive($s,'42','INBOX'),'different from Inbox'); });
foreach (['TRYCREATE'=>'does not exist','NOPERM'=>'denied permission','OVERQUOTA'=>'quota'] as $code=>$hint) {
    fixture([...archive_start(),['UID MOVE 42 "Archive"',"{tag} NO [$code] private server text\r\n"]],function($s) use($hint,$code) {
        try { imap_archive($s,'42','Archive'); throw new RuntimeException('Expected archive failure'); }
        catch(HttpError $e) { check(str_contains($e->getMessage(),'UID MOVE') && str_contains($e->getMessage(),$code) && str_contains($e->getMessage(),$hint),'actionable '.$code.' error'); check(!str_contains($e->getMessage(),'private server text'),'server text is not exposed'); }
    });
}
fixture([['LOGIN "user" "secret"',"{tag} NO [AUTHENTICATIONFAILED] secret user\r\n"]],function($s) {
    try { imap_command($s,'LOGIN "user" "secret"'); throw new RuntimeException('Expected login failure'); }
    catch(HttpError $e) { check(str_contains($e->getMessage(),'LOGIN') && !str_contains($e->getMessage(),'secret') && !str_contains($e->getMessage(),'"user"'),'login errors omit credentials'); }
});
fixture([['CAPABILITY',"{tag} BAD unsupported\r\n"]],function($s) { refused(fn()=>imap_command($s,'CAPABILITY'),'CAPABILITY refused (BAD)'); });
fixture([['LOGIN "user" "secret"',"{tag} NO [SECRET] secret user\r\n"]],function($s) {
    try { imap_command($s,'LOGIN "user" "secret"'); throw new RuntimeException('Expected login failure'); }
    catch(HttpError $e) { check(!str_contains(strtolower($e->getMessage()),'secret'),'unknown response codes are not echoed'); }
});
fixture([['CAPABILITY',"* CAPABILITY MOVE\r\n{tag} ok done\r\n"]],function($s) { check(count(imap_command($s,'CAPABILITY')['lines'])===2,'case-insensitive OK response'); });

$stale=archive_start(); $stale=array_slice($stale,0,4); $stale[3][1]="{tag} OK no such UID\r\n"; $stale[]=['UID SEARCH UID 42',"* SEARCH\r\n{tag} OK done\r\n"];
fixture($stale,function($s) { refused(fn()=>imap_archive($s,'42','Archive'),'no longer in its server folder'); check(!array_filter(ArchiveFixture::$commands,fn($cmd)=>str_starts_with($cmd,'UID MOVE ')),'stale cached UID sends no MOVE'); });
fixture([...archive_start(),['UID MOVE 42 "Archive"',"{tag} OK no operation\r\n"],['UID SEARCH UID 42',"* SEARCH 42\r\n{tag} OK done\r\n"]],function($s) { refused(fn()=>imap_archive($s,'42','Archive'),'still in its source server folder'); });
$missing=archive_finish(); $missing=array_slice($missing,0,3); $missing[2][1]="* SEARCH 99\r\n{tag} OK done\r\n";
fixture([...archive_start(),['UID MOVE 42 "Archive"',"{tag} OK done\r\n"],...$missing],function($s) { refused(fn()=>imap_archive($s,'42','Archive'),'could not be found in the destination'); check(true,'UID range does not mistake old highest UID for new destination'); });
$different=archive_finish(); $different[3][1]=message_response('100','A different message');
fixture([...archive_start(),['UID MOVE 42 "Archive"',"{tag} OK done\r\n"],...$different],function($s) { refused(fn()=>imap_archive($s,'42','Archive'),'could not be confirmed'); });
$concurrent=archive_finish(); $concurrent[2][1]="* SEARCH 100 101\r\n{tag} OK done\r\n"; $concurrent[3][1]=message_response('100','Concurrent delivery'); $concurrent[]=['UID FETCH 101 (UID BODY.PEEK[])',message_response('101')];
fixture([...archive_start(),['UID MOVE 42 "Archive"',"{tag} OK done\r\n"],...$concurrent],function($s) { imap_archive($s,'42','Archive'); check(true,'destination verification handles concurrent archive delivery'); });
$noNext=archive_start(); $noNext[4][1]="{tag} OK done\r\n";
fixture($noNext,function($s) { refused(fn()=>imap_archive($s,'42','Archive'),'No message was moved'); });

fixture([['UID FETCH 42 (UID BODY.PEEK[])',"* 1 FETCH (BODY[] {5}\r\nhello UID 42)\r\n{tag} OK done\r\n"]],function($s) { check(imap_message_content($s,'42')==='hello','UID after body literal'); });
fixture([['UID FETCH 42 (UID BODY.PEEK[])',"* 1 FETCH (UID 99 BODY[] {5}\r\nother)\r\n* 2 FETCH (UID 42 BODY[] {5}\r\nhello)\r\n{tag} OK done\r\n"]],function($s) { check(imap_message_content($s,'42')==='hello','unsolicited literal is not mistaken for requested content'); });
fixture([['UID FETCH 42 (UID BODY.PEEK[])',"* 1 FETCH (UID 42 FLAGS (\\Seen))\r\n{tag} OK done\r\n"]],function($s) { refused(fn()=>imap_message_content($s,'42'),'without readable content'); });
$unreadable=array_slice($stale,0,4); $unreadable[]=['UID SEARCH UID 42',"* SEARCH 42\r\n{tag} OK done\r\n"];
fixture($unreadable,function($s) { refused(fn()=>imap_archive($s,'42','Archive'),'content could not be read'); check(!array_filter(ArchiveFixture::$commands,fn($cmd)=>str_starts_with($cmd,'UID MOVE ')),'unreadable message sends no MOVE'); });
fixture([['UID SEARCH ALL',"* SEARCH\r\n{tag} OK done\r\n"]],function($s) { check(imap_search_ids($s,'ALL')===[],'empty Inbox search'); });
fixture([['UID SEARCH ALL',"{tag} OK done\r\n"]],function($s) { refused(fn()=>imap_search_ids($s,'ALL'),'did not return a message search result'); });
fixture([['UID SEARCH ALL',"* SEARCH 42 broken\r\n{tag} OK done\r\n"]],function($s) { refused(fn()=>imap_search_ids($s,'ALL'),'invalid message search result'); });
