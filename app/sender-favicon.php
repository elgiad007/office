<?php
declare(strict_types=1);

const SENDER_FAVICON_CACHE_VERSION=2;

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

/** Resolve redirects and icon links against the final page URL, including CDN hosts. */
function sender_favicon_url(string $href,string $base): ?string {
    $href=trim($href);
    if($href==='' || preg_match('/[\x00-\x20\x7f\\\\]/',$href))return null;
    if(str_starts_with($href,'//'))$href='https:'.$href;
    if(!preg_match('/^[a-z][a-z0-9+.-]*:/i',$href)){
        $parent=parse_url($base);if(!$parent || empty($parent['host']))return null;
        $origin='https://'.$parent['host'];
        if(str_starts_with($href,'/'))$href=$origin.$href;
        elseif(str_starts_with($href,'?'))$href=$origin.($parent['path']??'/').$href;
        else $href=$origin.preg_replace('~[^/]*$~','',$parent['path']??'/').$href;
    }
    $parts=parse_url($href);if(!$parts)return null;
    $host=strtolower($parts['host']??'');
    if(strtolower($parts['scheme']??'')!=='https' || !sender_favicon_domain($host) || isset($parts['port']) || isset($parts['user']) || isset($parts['pass']))return null;
    $segments=[];
    foreach(explode('/',$parts['path']??'/') as $segment){
        if($segment==='..')array_pop($segments);
        elseif($segment!=='.')$segments[]=$segment;
    }
    return 'https://'.$host.'/'.ltrim(implode('/',$segments),'/').(isset($parts['query'])?'?'.$parts['query']:'');
}

/** Retain a bounded HTML head, even on a large page. Oversized binary icons still fail. */
function sender_favicon_chunk(string &$body,string $chunk,bool $html,bool &$complete): int {
    $remaining=262144-strlen($body);
    if(!$html && strlen($chunk)>$remaining)return 0;
    $body.=substr($chunk,0,$remaining);
    if($html && (strlen($chunk)>=$remaining || preg_match('~</head\s*>|<body(?:\s|>)~i',$body))){$complete=true;return 0;}
    return strlen($chunk);
}

/** Each HTTPS hop resolves and pins a public address; cURL never follows redirects itself. */
function sender_favicon_fetch_url(string $url,bool $html,float $deadline,int $redirects=0): ?array {
    $url=sender_favicon_url($url,$url);if(!$url || microtime(true)>=$deadline)return null;
    $host=parse_url($url,PHP_URL_HOST);$address=sender_favicon_address($host);if(!$address)return null;
    $remaining=(int)(($deadline-microtime(true))*1000);if($remaining<=0)return null;
    $body='';$location='';$complete=false;$curl=curl_init($url);
    curl_setopt_array($curl,[CURLOPT_FOLLOWLOCATION=>false,CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS,
        CURLOPT_CONNECTTIMEOUT_MS=>min(1500,$remaining),CURLOPT_TIMEOUT_MS=>min(3000,$remaining),CURLOPT_PROXY=>'',
        CURLOPT_RESOLVE=>[$host.':443:'.$address],CURLOPT_USERAGENT=>'Office favicon cache',CURLOPT_ENCODING=>'',
        CURLOPT_HEADERFUNCTION=>static function($curl,string $line)use(&$location):int{
            if(strncasecmp($line,'Location:',9)===0)$location=trim(substr($line,9));
            return strlen($line);
        },
        CURLOPT_WRITEFUNCTION=>static function($curl,string $chunk)use(&$body,&$complete,$html):int{
            return sender_favicon_chunk($body,$chunk,$html,$complete);
        }]);
    $ok=curl_exec($curl);$status=curl_getinfo($curl,CURLINFO_RESPONSE_CODE);curl_close($curl);
    if(in_array($status,[301,302,303,307,308],true) && $redirects<4 && $location!==''){
        $next=sender_favicon_url($location,$url);
        return $next?sender_favicon_fetch_url($next,$html,$deadline,$redirects+1):null;
    }
    return ($ok!==false || $complete) && $status===200 ? ['body'=>$body,'url'=>$url] : null;
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

/** Strip recognizable mailing prefixes, rather than guessing a domain from its last two labels. */
function sender_favicon_domains(string $domain): array {
    if(!sender_favicon_domain($domain))return [];
    $domains=[$domain];$labels=explode('.',$domain);
    while(count($labels)>2 && count($domains)<4 && in_array($labels[0],['rs','s','e','em','email','mail','news','newsletter','newsletters','notifications','notify','updates','discover','bounce','bounces','marketing'],true)){
        array_shift($labels);$parent=implode('.',$labels);
        if(count($labels)===2 && strlen($labels[1])===2 && in_array($labels[0],['co','com','org','net','edu','gov','govt','ac','sch','school','nom','or','ne','gr','go','lg','asn','id'],true))break;
        $domains[]=$parent;
    }
    return $domains;
}

function sender_favicon_links(string $html,string $url): array {
    if(!class_exists('DOMDocument'))return [];
    $document=new DOMDocument();$previous=libxml_use_internal_errors(true);
    try{$document->loadHTML($html,LIBXML_NONET|LIBXML_NOERROR|LIBXML_NOWARNING);}
    finally{libxml_clear_errors();libxml_use_internal_errors($previous);}
    $base=$document->getElementsByTagName('base')->item(0);
    if($base)$url=sender_favicon_url($base->getAttribute('href'),$url)??$url;
    $icons=[];$touch=[];
    foreach($document->getElementsByTagName('link') as $link){
        $rel=$link->getAttribute('rel');
        if(!preg_match('/(?:^|\s)(icon|apple-touch-icon)(?:\s|$)/i',$rel))continue;
        $href=sender_favicon_url($link->getAttribute('href'),$url);
        if(!$href || preg_match('/\.svg(?:[?#]|$)/i',$href) || strtolower($link->getAttribute('type'))==='image/svg+xml')continue;
        if(stripos($rel,'apple-touch-icon')!==false)$touch[]=$href;else $icons[]=$href;
    }
    return array_slice(array_values(array_unique([...$icons,...$touch])),0,4);
}

/** Optional transport lets fixtures exercise discovery without pre-populated icons. */
function sender_favicon_lookup(string $domain,?callable $fetch=null): ?array {
    if(!$fetch && !extension_loaded('curl'))return null;
    $deadline=microtime(true)+8;
    $fetch??=static fn(string $url,bool $html)=>sender_favicon_fetch_url($url,$html,$deadline);
    $seen=[];
    foreach(sender_favicon_domains($domain) as $candidate){
        if(microtime(true)>=$deadline)break;
        $origin='https://'.$candidate;
        $result=$fetch($origin.'/favicon.ico',false);
        $icon=sender_favicon_image($result['body']??null);if($icon)return $icon;
        $page=$fetch($origin.'/',true);if(!$page)continue;
        foreach(sender_favicon_links($page['body'],$page['url']) as $url){
            if(isset($seen[$url]))continue;$seen[$url]=true;
            $result=$fetch($url,false);$icon=sender_favicon_image($result['body']??null);if($icon)return $icon;
        }
        $final=sender_favicon_url('/favicon.ico',$page['url']);
        if($final && $final!==$origin.'/favicon.ico' && !isset($seen[$final])){
            $seen[$final]=true;$result=$fetch($final,false);$icon=sender_favicon_image($result['body']??null);if($icon)return $icon;
        }
    }
    return null;
}

function sender_favicon_cache_fresh(mixed $cached): bool {
    return is_array($cached) && ($cached['expires']??0)>=time()
        && (!empty($cached['icon']) || ($cached['version']??0)===SENDER_FAVICON_CACHE_VERSION);
}

function serve_sender_favicon(string $domain): never {
    $domain=strtolower($domain);if(!sender_favicon_domain($domain))fail('Invalid sender domain.');
    $directory=data_dir().'/favicons';
    if(!is_dir($directory) && !@mkdir($directory,0700,true) && !is_dir($directory)){http_response_code(204);exit;}
    $path=$directory.'/'.hash('sha256',$domain).'.json';
    $cached=json_decode(@file_get_contents($path)?:'null',true);
    if(!sender_favicon_cache_fresh($cached)){
        $lock=@fopen($path.'.lock','c');
        if(!$lock || !flock($lock,LOCK_EX|LOCK_NB)){if($lock)fclose($lock);http_response_code(204);exit;}
        try{
            // Recheck after acquiring the lock in case another request just populated it.
            $cached=json_decode(@file_get_contents($path)?:'null',true);
            if(!sender_favicon_cache_fresh($cached)){
                $icon=sender_favicon_lookup($domain);
                $cached=['version'=>SENDER_FAVICON_CACHE_VERSION,'expires'=>time()+($icon?604800:900),'icon'=>$icon];
                @file_put_contents($path,json_encode($cached),LOCK_EX);@chmod($path,0600);
            }
        }finally{flock($lock,LOCK_UN);fclose($lock);}
    }
    if(empty($cached['icon'])){header('Cache-Control: no-store');http_response_code(204);exit;}
    header('Cache-Control: private, max-age='.max(0,min(86400,$cached['expires']-time())));
    header('Content-Type: '.$cached['icon']['type']);
    header("Content-Security-Policy: default-src 'none'; sandbox");
    echo base64_decode($cached['icon']['body']);exit;
}
