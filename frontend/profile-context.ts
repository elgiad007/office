let profileId: string | undefined;

export function setProfileContext(id: string | undefined) {
  profileId=id;
}

export function profileHeaders(): Record<string,string> {
  return profileId?{'X-Office-Profile':profileId}:{};
}

export function profileQuery(): string {
  return profileId?'&profile='+encodeURIComponent(profileId):'';
}

export function profileStorageKey(key: string): string {
  // The Default profile keeps the browser choices made before profiles existed.
  return profileId && profileId!=='default'?'office-profile:'+profileId+':'+key:key;
}
