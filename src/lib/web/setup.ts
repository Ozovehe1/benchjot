// The sign-up step that connects the user's free accounts (/welcome/boosts): everyone passes
// through it once, nobody is held there. This cookie records that this browser has been through it.
export const SETUP_COOKIE = "bj_setup";
export const SETUP_COOKIE_VALUE = `${SETUP_COOKIE}=1; path=/; max-age=31536000; samesite=lax`;
