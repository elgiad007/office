<?php
declare(strict_types=1);

// Email styling is retained only inside an opaque, script-free sandbox.
function safe_mail_html(string $html,array $images,bool $remote=false): string {
    if (!class_exists('DOMDocument')) return '<p>HTML viewing requires the PHP DOM extension. Choose Text only to read this email.</p>';
    $doc=new DOMDocument(); $previous=libxml_use_internal_errors(true);
    $doc->loadHTML('<?xml encoding="UTF-8">'.$html,LIBXML_NONET|LIBXML_NOERROR|LIBXML_NOWARNING);
    libxml_clear_errors(); libxml_use_internal_errors($previous);
    $allowed=explode(' ','html head body title style p div span br hr h1 h2 h3 h4 h5 h6 table thead tbody tfoot tr td th caption colgroup col a img b strong i em u s strike small big sub sup blockquote pre code ul ol li dl dt dd center font address section article header footer main figure figcaption');
    $attributes=explode(' ','class id style title lang dir width height align valign bgcolor color face size border cellpadding cellspacing colspan rowspan role aria-label alt');
    foreach (iterator_to_array($doc->getElementsByTagName('*')) as $node) {
        $tag=strtolower($node->tagName);
        if (!in_array($tag,$allowed,true)) { $node->parentNode?->removeChild($node); continue; }
        foreach (iterator_to_array($node->attributes) as $attr) {
            $name=strtolower($attr->name);
            if (in_array($name,$attributes,true)) continue;
            if ($tag==='a' && $name==='href' && preg_match('~^(https?://|mailto:)~i',trim($attr->value))) continue;
            if ($tag==='img' && $name==='src') continue;
            $node->removeAttributeNode($attr);
        }
        if ($tag==='a') { $node->setAttribute('target','_blank'); $node->setAttribute('rel','noopener noreferrer'); }
        if ($tag==='img') {
            $src=trim($node->getAttribute('src'));
            if (str_starts_with(strtolower($src),'cid:')) $src=$images[rawurldecode(substr($src,4))]??'';
            if (!preg_match('~^data:image/(png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$~i',$src) && !($remote && preg_match('~^https://~i',$src))) $src='';
            $node->removeAttribute('src');
            if ($src!=='') $node->setAttribute('src',$src);
            $node->setAttribute('referrerpolicy','no-referrer');
        }
    }
    $head=$doc->getElementsByTagName('head')->item(0);
    if (!$head) { $head=$doc->createElement('head'); $doc->documentElement->insertBefore($head,$doc->documentElement->firstChild); }
    $defaults=$doc->createElement('style','html{color-scheme:light;background:#fff;color:#111}body{margin:16px;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}');
    $head->insertBefore($defaults,$head->firstChild);
    $charset=$doc->createElement('meta'); $charset->setAttribute('charset','utf-8'); $head->insertBefore($charset,$head->firstChild);
    foreach (iterator_to_array($doc->childNodes) as $node) if ($node->nodeType===XML_PI_NODE) $doc->removeChild($node);
    return '<!doctype html>'.$doc->saveHTML($doc->documentElement);
}
