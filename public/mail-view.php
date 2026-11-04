<?php
declare(strict_types=1);
require dirname(__DIR__).'/app/bootstrap.php';
require dirname(__DIR__).'/app/formats.php';
require dirname(__DIR__).'/app/mail-html.php';
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
$remote=($_GET['images']??'')==='1';
$nonce=base64_encode(random_bytes(24));
header("Content-Security-Policy: default-src 'none'; script-src 'nonce-$nonce'; style-src 'unsafe-inline'; img-src data:".($remote?' https:':'')."; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox");
try {
    start_session(); owner();
    $record=get_record((string)($_GET['id']??''));
    if ($record['kind']!=='mail' || ($record['meta']['folder']??'')==='Drafts') fail('Select a received email.',400);
    $meta=$record['meta'];
    $raw=isset($meta['bodyRawBase64'])?base64_decode($meta['bodyRawBase64'],true):(isset($meta['rawBase64']) ? base64_decode($meta['rawBase64'],true) : ($meta['raw']??''));
    if (!is_string($raw) || strlen($raw)>32*1024*1024) fail('Original email is unavailable.',400);
    $content=eml_html($raw);
    $theme=($_GET['theme']??'')==='dark'?'dark':'light';
    if (($_GET['colors']??'')==='original') $theme='light';
    $accent=is_string($_GET['accent']??null)?$_GET['accent']:'green';
    $html=safe_mail_html($content['html']?:'<p>This email has no HTML version. Choose Text only.</p>',$content['images'],$remote,$theme,$accent);
    // Only this first-party script gets the unpredictable CSP nonce. Sanitization
    // removes sender scripts and event handlers before the bridge is appended.
    $bridge=<<<'JS'
(()=>{
  let keys=new Set(['g','G','n','N','Tab']),sequenceTime=0;
  addEventListener('message',event=>{
    if(event.source!==parent)return;
    const data=event.data;
    if(!data||typeof data!=='object'||Array.isArray(data))return;
    if(data.type==='office-mail-config'&&Object.keys(data).length===2&&Array.isArray(data.keys)&&data.keys.length<=64&&data.keys.every(key=>typeof key==='string'&&key.length<=32)){keys=new Set(data.keys);return;}
    if(data.type!=='office-mail-scroll'||Object.keys(data).length!==2||!['up','down','start','end'].includes(data.direction))return;
    const root=document.scrollingElement;
    if(root)scrollTo({top:data.direction==='start'?0:data.direction==='end'?root.scrollHeight:scrollY+(data.direction==='up'?-1:1)*Math.max(40,innerHeight*.15),behavior:'instant'});
  });
  addEventListener('keydown',event=>{
    if(!event.defaultPrevented&&!event.isComposing&&!event.altKey&&!event.shiftKey&&(event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();parent.postMessage({type:'office-mail-save',ctrlKey:event.ctrlKey,metaKey:event.metaKey,repeat:event.repeat},'*');return;}
    if(event.defaultPrevented||event.isComposing||event.ctrlKey||event.metaKey||event.altKey||event.target.closest('input,textarea,select,[contenteditable]'))return;
    if(event.target.closest('a,button')&&['Enter',' ','Tab','ContextMenu','F10'].includes(event.key))return;
    if(event.key==='F10'&&!event.shiftKey)return;
    if(['F10','ContextMenu'].includes(event.key)&&getSelection()?.toString())return;
    if(/^[1-7]$/.test(event.key)&&Date.now()-sequenceTime>900)return;
    sequenceTime=event.key==='g'?Date.now():0;
    if(!keys.has(event.key)||(event.key==='Tab'&&(!event.shiftKey||event.target.closest('a,button'))))return;
    event.preventDefault();parent.postMessage({type:'office-mail-key',key:event.key,shiftKey:event.shiftKey,repeat:event.repeat},'*');
  });
  addEventListener('contextmenu',event=>{
    if(event.defaultPrevented||event.target.closest('input,textarea,select,[contenteditable],a,button')||getSelection()?.toString())return;
    event.preventDefault();parent.postMessage({type:'office-mail-context',x:event.clientX,y:event.clientY},'*');
  });
  parent.postMessage({type:'office-mail-ready'},'*');
})();
JS;
    echo str_replace('</body>','<script nonce="'.htmlspecialchars($nonce,ENT_QUOTES).'">'.$bridge.'</script></body>',$html);
} catch (Throwable $error) {
    http_response_code($error instanceof HttpError ? $error->getCode() : 500);
    echo '<p>'.htmlspecialchars($error instanceof HttpError ? $error->getMessage() : 'Email could not be displayed. Choose Text only.',ENT_QUOTES|ENT_SUBSTITUTE,'UTF-8').'</p>';
}
