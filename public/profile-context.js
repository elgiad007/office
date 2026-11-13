// Generated from frontend/profile-context.ts by pnpm build. Do not edit.
let profileId;
export function setProfileContext(id) {
    profileId = id;
}
export function profileHeaders() {
    return profileId ? { 'X-Office-Profile': profileId } : {};
}
export function profileQuery() {
    return profileId ? '&profile=' + encodeURIComponent(profileId) : '';
}
export function profileStorageKey(key) {
    // The Default profile keeps the browser choices made before profiles existed.
    return profileId && profileId !== 'default' ? 'office-profile:' + profileId + ':' + key : key;
}
