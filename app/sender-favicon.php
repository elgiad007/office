<?php
declare(strict_types=1);

/** Only public DNS names are eligible; no IP literals, ports, or URL syntax. */
function sender_favicon_domain(string $domain): bool {
    return strlen($domain)<=253 && str_contains($domain,'.') && !filter_var($domain,FILTER_VALIDATE_IP)
        && (bool)preg_match('/\A[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+\z/D',$domain);
}

/** Resolve once and pin a public address to prevent DNS rebinding and private-network requests. */
function sender_favicon_address(string $domain): ?string {
    $addresses=@gethostbynamel($domain);
    if(!$addresses)return null;
    foreach($addresses as $address)if(!filter_var($address,FILTER_VALIDATE_IP,FILTER_FLAG_IPV4|FILTER_FLAG_GLOBAL_RANGE))return null;
    return $addresses[0];
}

function sender_favicon_fetch(string $domain,string $address,string $path,int $redirects=0): ?string {
    $body='';$location='';$curl=curl_init('https://'.$domain.$path);
    curl_setopt_array($curl,[CURLOPT_FOLLOWLOCATION=>false,CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS,
        CURLOPT_CONNECTTIMEOUT_MS=>1000,CURLOPT_TIMEOUT_MS=>2000,CURLOPT_PROXY=>'',
        CURLOPT_RESOLVE=>[$domain.':443:'.$address],CURLOPT_USERAGENT=>'Office favicon cache',
        CURLOPT_HEADERFUNCTION=>static function($curl,string $line)use(&$location):int{
            if(strncasecmp($line,'Location:',9)===0)$location=trim(substr($line,9));
            return strlen($line);
        },
        CURLOPT_WRITEFUNCTION=>static function($curl,string $chunk)use(&$body):int{
            if(strlen($body)+strlen($chunk)>262144)return 0;
            $body.=$chunk;return strlen($chunk);
        }]);
    $ok=curl_exec($curl);$status=curl_getinfo($curl,CURLINFO_RESPONSE_CODE);curl_close($curl);
    if($ok!==false && in_array($status,[301,302,303,307,308],true) && $redirects<2 && $location!==''){
        if(str_starts_with($location,'//'))$location='https:'.$location;
        if(str_starts_with($location,'/') && !str_starts_with($location,'//'))$location='https://'.$domain.$location;
        $parts=parse_url($location);$host=strtolower($parts['host']??'');
        if(!$parts || ($parts['scheme']??'')!=='https' || !sender_favicon_domain($host) || isset($parts['port']) || isset($parts['user']) || isset($parts['pass']))return null;
        $nextAddress=sender_favicon_address($host);if(!$nextAddress)return null;
        return sender_favicon_fetch($host,$nextAddress,($parts['path']??'/').(isset($parts['query'])?'?'.$parts['query']:''),$redirects+1);
    }
    return $ok!==false && $status===200 ? $body : null;
}

/** Accept raster icons only; never serve HTML or executable SVG from a sender. */
function sender_favicon_image(?string $body): ?array {
    if(!$body)return null;
    if(str_starts_with($body,"\x00\x00\x01\x00") && strlen($body)>=22){
        $count=unpack('v',substr($body,4,2))[1];
        if($count<1 || $count>256 || strlen($body)<6+16*$count)return null;
        return ['type'=>'image/x-icon','body'=>base64_encode($body)];
    }
    $info=@getimagesizefromstring($body);
    if(!$info || $info[0]>1024 || $info[1]>1024 || !in_array($info['mime'],['image/png','image/jpeg','image/gif','image/webp'],true))return null;
    return ['type'=>$info['mime'],'body'=>base64_encode($body)];
}

function sender_favicon_lookup(string $domain): ?array {
    if(!extension_loaded('curl'))return null;
    $address=sender_favicon_address($domain);if(!$address)return null;
    $icon=sender_favicon_image(sender_favicon_fetch($domain,$address,'/favicon.ico'));
    if($icon)return $icon;
    // Many sites advertise their icon in HTML instead of using /favicon.ico.
    if(!class_exists('DOMDocument'))return null;
    $html=sender_favicon_fetch($domain,$address,'/');if(!$html)return null;
    $document=new DOMDocument();$previous=libxml_use_internal_errors(true);
    try{$document->loadHTML($html,LIBXML_NONET|LIBXML_NOERROR|LIBXML_NOWARNING);}
    finally{libxml_clear_errors();libxml_use_internal_errors($previous);}
    foreach($document->getElementsByTagName('link') as $link){
        if(!preg_match('/(?:^|\s)icon(?:\s|$)/i',$link->getAttribute('rel')))continue;
        $href=trim($link->getAttribute('href'));
        if(str_starts_with($href,'//'))$href='https:'.$href;
        if(str_starts_with($href,'https://')){
            $parts=parse_url($href);
            if(!$parts || ($parts['host']??'')!==$domain || isset($parts['port']) || isset($parts['user']) || isset($parts['pass']))continue;
            $href=($parts['path']??'/').(isset($parts['query'])?'?'.$parts['query']:'');
        }elseif(preg_match('/^[a-z][a-z0-9+.-]*:/i',$href))continue;
        $path='/'.ltrim($href,'/');
        if($href==='' || str_starts_with($path,'//') || preg_match('/[\x00-\x20\x7f\\\\]/',$path))continue;
        // One advertised candidate bounds total lookup work per domain.
        return sender_favicon_image(sender_favicon_fetch($domain,$address,$path));
    }
    return null;
}

function serve_sender_favicon(string $domain): never {
    $domain=strtolower($domain);if(!sender_favicon_domain($domain))fail('Invalid sender domain.');
    $directory=data_dir().'/favicons';
    if(!is_dir($directory) && !@mkdir($directory,0700,true) && !is_dir($directory)){http_response_code(204);exit;}
    $path=$directory.'/'.hash('sha256',$domain).'.json';
    $cached=json_decode(@file_get_contents($path)?:'null',true);
    if(!is_array($cached) || ($cached['expires']??0)<time()){
        $lock=@fopen($path.'.lock','c');
        if(!$lock || !flock($lock,LOCK_EX|LOCK_NB)){if($lock)fclose($lock);http_response_code(204);exit;}
        try{
            // Recheck after acquiring the lock in case another request just populated it.
            $cached=json_decode(@file_get_contents($path)?:'null',true);
            if(!is_array($cached) || ($cached['expires']??0)<time()){
                $icon=sender_favicon_lookup($domain);
                $cached=['expires'=>time()+($icon?604800:86400),'icon'=>$icon];
                @file_put_contents($path,json_encode($cached),LOCK_EX);@chmod($path,0600);
            }
        }finally{flock($lock,LOCK_UN);fclose($lock);}
    }
    header('Cache-Control: private, max-age='.max(0,min(86400,$cached['expires']-time())));
    if(empty($cached['icon'])){http_response_code(204);exit;}
    header('Content-Type: '.$cached['icon']['type']);
    header("Content-Security-Policy: default-src 'none'; sandbox");
    echo base64_decode($cached['icon']['body']);exit;
}
