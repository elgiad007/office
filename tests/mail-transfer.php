<?php
declare(strict_types=1);
$testDir=sys_get_temp_dir().'/office-transfer-'.bin2hex(random_bytes(8));putenv('OFFICE_DATA_DIR='.$testDir);
require dirname(__DIR__).'/app/bootstrap.php';
require dirname(__DIR__).'/app/formats.php';
require dirname(__DIR__).'/app/connectors.php';
require dirname(__DIR__).'/app/mail-folders.php';
require dirname(__DIR__).'/app/mail-transfer.php';
function check(bool $ok,string $message): void {if(!$ok)throw new RuntimeException($message);echo "PASS $message\n";}
function rejected(callable $fn,string $message): void {try{$fn();throw new RuntimeException('Expected rejection');}catch(HttpError $e){check(str_contains($e->getMessage(),$message),$message);}}
class AppendPeer {
    public $context;public static string $raw='';public static bool $refuse=false;public static bool $noUid=false;
    private string $buffer='';private string $tag='';private bool $literal=false;
    function stream_open($path,$mode,$options,&$opened): bool{return true;}
    function stream_write($data): int {
        if(!$this->literal){
            check((bool)preg_match('/^(T[a-f0-9]+) APPEND "Travel" \(\\\\Seen\) "01-Nov-2026 12:00:00 \+0000" \{'.strlen(self::$raw).'\}\r\n$/',$data,$m),'APPEND includes exact folder, flags, date and literal length');
            $this->tag=$m[1];$this->literal=true;$this->buffer=self::$refuse?$this->tag." NO refused\r\n":"+ ready\r\n";
        }else{
            check($data===self::$raw."\r\n",'original bytes sent after continuation');
            $this->buffer=$this->tag.' OK '.(self::$noUid?'':'[APPENDUID 8 42] ')."stored\r\n";
        }
        return strlen($data);
    }
    function stream_read($count): string {$part=substr($this->buffer,0,$count);$this->buffer=substr($this->buffer,strlen($part));return $part;}
    function stream_eof(): bool{return false;}
    function stream_stat(): array{return [];}
}
stream_wrapper_register('appendpeer',AppendPeer::class);
try{
    $raw="From: sender@example.com\r\nTo: owner@example.com\r\nSubject: Original\r\nDate: Sun, 1 Nov 2026 12:00:00 +0000\r\n\r\nFull original body.\r\n";
    AppendPeer::$raw=$raw;
    $append=static function()use($raw){$s=fopen('appendpeer://test','r+');try{return imap_append_original($s,'Travel',$raw,true,'2026-11-01T12:00:00Z');}finally{fclose($s);}};
    $location=$append();check($location['providerId']==='42'&&$location['uidValidity']==='8','APPENDUID records destination identity');
    AppendPeer::$refuse=true;rejected($append,'source was kept');AppendPeer::$refuse=false;
    AppendPeer::$noUid=true;rejected($append,'without a destination identifier');AppendPeer::$noUid=false;
    foreach(['source','dest'] as $id)db()->prepare('INSERT INTO accounts VALUES(?,?,?,?,?,?,?)')->execute([$id,$id,'imap','{}','',null,null]);
    $dest=['id'=>'dest','type'=>'imap','label'=>'Destination'];set_setting('mail-folders:dest',[['id'=>'Travel','name'=>'Travel','role'=>'Custom folder']]);
    $row=['id'=>'source-message','kind'=>'mail','title'=>'Original','body'=>'Body','meta'=>['remote'=>true,'account'=>'source','source'=>'imap-folder:INBOX:3:7','providerId'=>'7','folder'=>'Inbox','read'=>true]];
    $copies=0;$trashes=0;$events=[];
    $original=fn()=>$raw;
    $copy=function()use(&$copies,&$events,$location){$copies++;$events[]='copy';return $location;};
    $verify=function($a,$f,$l,$hash)use($raw,&$events){$events[]='verify';check($hash===hash('sha256',$raw),'verification uses original fingerprint');return [$raw,$l+['folder'=>'Custom folder']];};
    $trash=function()use(&$trashes,&$events){$events[]='trash';$trashes++;};
    $run=fn($r)=>transfer_remote_mail($r,$dest,'Travel',$original,$copy,$verify,$trash);
    $record=$run($row);check($events===['copy','verify','trash'],'copy is verified before source is removed');
    check($record['meta']['account']==='dest'&&$record['meta']['rawBase64']===base64_encode($raw),'destination cache preserves full original and account');
    $run($row);check($copies===1&&$trashes===1,'retry after success never creates another copy or trashes twice');
    $row['id']='cleanup-failure';$failTrash=function(){fail('Cleanup unavailable');};
    rejected(fn()=>transfer_remote_mail($row,$dest,'Travel',$original,$copy,$verify,$failTrash),'Cleanup unavailable');
    $before=$copies;$run($row);check($copies===$before,'cleanup retry reuses the verified destination');
    $row['id']='verify-failure';$before=$trashes;
    rejected(fn()=>transfer_remote_mail($row,$dest,'Travel',$original,$copy,fn()=>fail('Verification failed'),$trash),'Verification failed');
    check($trashes===$before,'failed verification leaves the source untouched');
    $row['id']='copy-uncertain';$uncertain=function()use(&$copies){$copies++;fail('Connection dropped');};
    rejected(fn()=>transfer_remote_mail($row,$dest,'Travel',$original,$uncertain,$verify,$trash),'Connection dropped');
    $before=$copies;rejected(fn()=>$run($row),'previous copy could not be confirmed');check($copies===$before,'uncertain write is never repeated');
    $row['id']='large';$before=$copies;rejected(fn()=>transfer_remote_mail($row,$dest,'Travel',fn()=>str_repeat('x',IMAP_BODY_LIMIT+1),$copy,$verify,$trash),'complete original');check($copies===$before,'oversized message fails before copying');
}finally{
    foreach(glob($testDir.'/*')?:[] as $file)@unlink($file);@rmdir($testDir);
}
