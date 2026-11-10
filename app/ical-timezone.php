<?php
declare(strict_types=1);

function ics_wall_time(string $value): ?int {
    $date=DateTimeImmutable::createFromFormat('!Ymd\THis',$value,new DateTimeZone('UTC'));
    return $date && $date->format('Ymd\THis')===$value ? $date->getTimestamp() : null;
}

function ics_zone_offset(string $value): ?int {
    if (!preg_match('/^([+-])([01]\d|2[0-3])([0-5]\d)([0-5]\d)?$/D',$value,$parts)) return null;
    return ($parts[1]==='-'?-1:1)*((int)$parts[2]*3600+(int)$parts[3]*60+(int)($parts[4]??0));
}

function ics_timezones(string $raw): array {
    preg_match_all('/^BEGIN:VTIMEZONE\r?\n(.*?)^END:VTIMEZONE\r?$/ims',$raw,$components);
    $zones=[];
    foreach ($components[1] as $component) {
        if (!preg_match('/^TZID:([^\r\n]+)/mi',$component,$id)) continue;
        preg_match_all('/^BEGIN:(STANDARD|DAYLIGHT)\r?\n(.*?)^END:\1\r?$/ims',$component,$observances);
        foreach ($observances[2] as $observance) {
            preg_match('/^DTSTART:([^\r\n]+)/mi',$observance,$start);
            preg_match('/^TZOFFSETFROM:([^\r\n]+)/mi',$observance,$from);
            preg_match('/^TZOFFSETTO:([^\r\n]+)/mi',$observance,$to);
            preg_match('/^RRULE:([^\r\n]+)/mi',$observance,$rule);
            preg_match_all('/^RDATE(?:;[^:\r\n]+)?:([^\r\n]+)/mi',$observance,$rdates);
            $start=ics_wall_time($start[1]??'');
            $from=ics_zone_offset($from[1]??'');
            $to=ics_zone_offset($to[1]??'');
            if ($start===null || $from===null || $to===null) continue;
            $dates=explode(',',implode(',',$rdates[1]));
            $zones[ics_unescape($id[1])][]=['start'=>$start,'from'=>$from,'to'=>$to,'rule'=>$rule[1]??'','dates'=>$dates];
        }
    }
    return $zones;
}

// VTIMEZONE observances usually repeat on an ordinal weekday in a month.
function ics_yearly_zone_transitions(array $observance,int $year): ?array {
    $rule=[];
    foreach (explode(';',strtoupper($observance['rule'])) as $part) {
        $pair=explode('=',$part,2);
        if (count($pair)!==2) return null;
        $rule[$pair[0]]=$pair[1];
    }
    $weekdays=['MO'=>1,'TU'=>2,'WE'=>3,'TH'=>4,'FR'=>5,'SA'=>6,'SU'=>7];
    if (array_diff(array_keys($rule),['FREQ','BYMONTH','BYDAY','UNTIL','INTERVAL'])
        || ($rule['FREQ']??'')!=='YEARLY' || ($rule['INTERVAL']??'1')!=='1'
        || !preg_match('/^([+-]?[1-5])(MO|TU|WE|TH|FR|SA|SU)$/D',$rule['BYDAY']??'',$day)
        || !preg_match('/^(0?[1-9]|1[0-2])$/D',$rule['BYMONTH']??'')) return null;
    $until=null;
    if (isset($rule['UNTIL'])) {
        $until=ics_wall_time(rtrim($rule['UNTIL'],'Z'));
        if ($until===null) return null;
        $year=min($year,(int)gmdate('Y',$until)+1);
        if (str_ends_with($rule['UNTIL'],'Z')) $until+=$observance['from'];
    }
    $transitions=[];
    $ordinal=(int)$day[1]; $month=(int)$rule['BYMONTH']; $weekday=$weekdays[$day[2]];
    foreach ([$year,$year-1,$year-2] as $candidate) {
        if ($candidate<(int)gmdate('Y',$observance['start'])) continue;
        $first=new DateTimeImmutable(sprintf('%04d-%02d-01',$candidate,$month),new DateTimeZone('UTC'));
        $last=$first->modify('last day of this month');
        $date=$ordinal>0 ? 1+($weekday-(int)$first->format('N')+7)%7+7*($ordinal-1)
            : (int)$last->format('j')-((int)$last->format('N')-$weekday+7)%7+7*($ordinal+1);
        if ($date<1 || $date>(int)$last->format('j')) continue;
        $timeOfDay=($observance['start']%86400+86400)%86400;
        $at=$first->getTimestamp()+($date-1)*86400+$timeOfDay;
        if ($at>=$observance['start'] && ($until===null || $at<=$until)) $transitions[]=$at;
    }
    return $transitions;
}

function ics_embedded_offset(array $observances,int $wall): ?int {
    $latest=null; $first=null; $offset=null; $initial=null;
    foreach ($observances as $observance) {
        $transitions=[$observance['start']];
        foreach ($observance['dates'] as $date) {
            if ($date!=='' && ($at=ics_wall_time($date))!==null) $transitions[]=$at;
        }
        if ($observance['rule']!=='') {
            $yearly=ics_yearly_zone_transitions($observance,(int)gmdate('Y',$wall));
            if ($yearly===null) return null;
            $transitions=array_merge($transitions,$yearly);
        }
        foreach ($transitions as $at) {
            if ($first===null || $at<$first) { $first=$at; $initial=$observance['from']; }
            // Ambiguous and skipped wall times use the offset before the transition.
            $effective=$at+max(0,$observance['to']-$observance['from']);
            if ($effective<=$wall && ($latest===null || $effective>$latest)) {
                $latest=$effective; $offset=$observance['to'];
            }
        }
    }
    return $offset??$initial;
}

function ics_native_timezone(string $zone): ?DateTimeZone {
    try { return new DateTimeZone($zone); }
    catch (Exception) {
        $iana=class_exists('IntlTimeZone') ? IntlTimeZone::getIDForWindowsID($zone) : false;
        // Also cover this common provider identifier on hosts without PHP Intl.
        if (!$iana && strcasecmp($zone,'Eastern Standard Time')===0) $iana='America/New_York';
        return $iana ? new DateTimeZone($iana) : null;
    }
}
