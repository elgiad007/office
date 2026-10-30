function messageTime(record) {
  for(const value of [record.meta?.date,record.meta?.sentAt]){
    if(typeof value!=='string'||!value.trim())continue;
    const time=Date.parse(value);
    if(Number.isFinite(time))return time;
  }
  // Cache updates must never make undated mail appear newly received.
  return -Infinity;
}

export function compareMail(a,b) {
  const aTime=messageTime(a),bTime=messageTime(b);
  if(aTime!==bTime)return aTime>bTime?-1:1;
  return a.id<b.id?-1:a.id>b.id?1:0;
}
