<?php
declare(strict_types=1);

// Relative colors keep the sender's hue while bringing text and surfaces into
// separate lightness ranges. This runs on CSS only; the email stays script-free.
function dark_mail_css(string $css): string {
    $quoted='"(?:[^"\\\\]|\\\\.)*"|\'(?:[^\'\\\\]|\\\\.)*\'|/\*.*?\*/';
    $pattern='~(?:'.$quoted.')(*SKIP)(*F)|(?<![\w-])(?<property>color|background-color|background-image|background|-webkit-text-fill-color|text-decoration-color)\s*:\s*(?<value>(?:(?:'.$quoted.')|(?<parens>\((?:[^()"\']+|"(?:[^"\\\\]|\\\\.)*"|\'(?:[^\'\\\\]|\\\\.)*\'|(?&parens))*\))|[^;{}()"\'])+)~is';
    return preg_replace_callback($pattern,function(array $match): string {
        $property=strtolower($match['property']);
        $value=trim($match['value']);
        $important=preg_match('/\s*!important\s*$/i',$value)?' !important':'';
        $value=preg_replace('/\s*!important\s*$/i','',$value);
        if (preg_match('/^(inherit|initial|unset|revert|revert-layer|transparent|none)$/i',$value)) return $match[0];
        if ($property==='background'||$property==='background-image') $value=dark_mail_background($value);
        elseif ($property==='background-color') $value="oklch(from $value min(l, 0.27) c h)";
        else $value="oklch(from $value max(l, 0.86) c h)";
        return $property.':'.$value.$important;
    },$css)??$css;
}

function dark_mail_background(string $value): string {
    if (preg_match('/^var\(.*\)$/is',$value)) return "oklch(from $value min(l, 0.27) c h)";
    // Protect URLs and strings, including data images; change only color tokens.
    $names='aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen canvas canvastext window windowtext buttonface buttontext field fieldtext';
    $pattern='~(?:url\((?:[^()]+|(?<urlparen>\((?:[^()]+|(?&urlparen))*\)))*\)|"(?:[^"\\\\]|\\\\.)*"|\'(?:[^\'\\\\]|\\\\.)*\'|/\*.*?\*/)(*SKIP)(*F)|(?<color>\#[a-f0-9]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)(?<paren>\((?:[^()]+|(?&paren))*\))|\b(?:'.str_replace(' ','|',$names).')\b)~is';
    return preg_replace_callback($pattern,fn(array $match)=>'oklch(from '.$match['color'].' min(l, 0.27) c h)',$value)??$value;
}

// Email styling is retained only inside an opaque, script-free sandbox.
function safe_mail_html(string $html,array $images,bool $remote=false,string $theme='light',string $accent='green'): string {
    if (!class_exists('DOMDocument')) return '<p>HTML viewing requires the PHP DOM extension. Choose Text only to read this email.</p>';
    $doc=new DOMDocument(); $previous=libxml_use_internal_errors(true);
    $doc->loadHTML('<?xml encoding="UTF-8">'.$html,LIBXML_NONET|LIBXML_NOERROR|LIBXML_NOWARNING);
    libxml_clear_errors(); libxml_use_internal_errors($previous);
    $allowed=explode(' ','html head body title style p div span br hr h1 h2 h3 h4 h5 h6 table thead tbody tfoot tr td th caption colgroup col a img b strong i em u s strike small big sub sup blockquote pre code ul ol li dl dt dd center font address section article header footer main figure figcaption');
    $attributes=explode(' ','class id style title lang dir width height align valign bgcolor color face size border cellpadding cellspacing colspan rowspan role aria-label alt');
    foreach (iterator_to_array($doc->getElementsByTagName('*')) as $node) {
        $tag=strtolower($node->tagName);
        if ($tag==='o:p') {
            $replacement=$doc->createElement('span');
            while ($node->firstChild) $replacement->appendChild($node->firstChild);
            $node->parentNode?->replaceChild($replacement,$node);
            $node=$replacement; $tag='span';
        }
        if (!in_array($tag,$allowed,true)) { $node->parentNode?->removeChild($node); continue; }
        foreach (iterator_to_array($node->attributes) as $attr) {
            $name=strtolower($attr->name);
            if (in_array($name,$attributes,true)) continue;
            if ($tag==='a' && $name==='href' && preg_match('~^(https?://|mailto:)~i',trim($attr->value))) continue;
            if ($tag==='img' && $name==='src') continue;
            $node->removeAttributeNode($attr);
        }
        if ($theme==='dark') {
            if ($tag==='style') $node->textContent=dark_mail_css($node->textContent);
            if ($node->hasAttribute('style')) $node->setAttribute('style',dark_mail_css($node->getAttribute('style')));
            foreach (['color','bgcolor'] as $attribute) {
                if (!$node->hasAttribute($attribute)) continue;
                $value=trim($node->getAttribute($attribute));
                if (preg_match('/^[a-f0-9]{6}$/i',$value)) $value='#'.$value;
                // Attributes accept colors, never arbitrary CSS declarations.
                if (preg_match('/^(?:#[a-f0-9]{3,8}|[a-z]+)$/i',$value)) {
                    $property=$attribute==='color'?'color':'background-color';
                    $node->setAttribute('style',dark_mail_css($property.':'.$value).';'.$node->getAttribute('style'));
                }
            }
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
    // Low-specificity defaults let the sender's CSS and legacy color attributes win.
    $dark=$theme==='dark';
    $scheme=$dark?'dark':'light';
    $background=$dark?'#202622':'#fff';
    $text=$dark?'#e2e8df':'#282d27';
    $links=['green'=>['#426549','#a4c99e'],'blue'=>['#365d8a','#9dbfe7'],'plum'=>['#785279','#d3aed2']];
    $link=($links[$accent]??$links['green'])[$dark?1:0];
    $defaults=$doc->createElement('style',":where(html){color-scheme:$scheme;background:$background;color:$text}:where(a){color:$link}body{margin:16px;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}");
    $head->insertBefore($defaults,$head->firstChild);
    $charset=$doc->createElement('meta'); $charset->setAttribute('charset','utf-8'); $head->insertBefore($charset,$head->firstChild);
    foreach (iterator_to_array($doc->childNodes) as $node) if ($node->nodeType===XML_PI_NODE) $doc->removeChild($node);
    return '<!doctype html>'.$doc->saveHTML($doc->documentElement);
}
