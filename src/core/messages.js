/** Message contract between the content script, the service worker and the side panel. */

export const MSG = {
  // content -> background
  SCAN_RESULT: 'scan-result',
  FILL_RESULT: 'fill-result',
  NEED_VALUES: 'need-values',
  NEED_FILE: 'need-file',
  LEARN_ANSWER: 'learn-answer',
  SUBMIT_DETECTED: 'submit-detected',
  PAGE_META: 'page-meta',

  // background/panel -> content
  SCAN: 'scan',
  FILL: 'fill',
  FILL_ONE: 'fill-one',
  HIGHLIGHT: 'highlight',
  CLEAR_HIGHLIGHT: 'clear-highlight',
  PING: 'ping',

  // panel -> background
  GET_STATE: 'get-state',
  SAVE_PROFILE: 'save-profile',
  PATCH_VALUES: 'patch-values',
  PATCH_SETTINGS: 'patch-settings',
  ADD_FILE: 'add-file',
  LIST_FILES: 'list-files',
  DELETE_FILE: 'delete-file',
  LIST_MEMORY: 'list-memory',
  SAVE_MEMORY: 'save-memory',
  UPDATE_MEMORY: 'update-memory',
  DELETE_MEMORY: 'delete-memory',
  LIST_APPS: 'list-apps',
  SAVE_APP: 'save-app',
  DELETE_APP: 'delete-app',
  EXPORT_ALL: 'export-all',
  IMPORT_ALL: 'import-all',
  WIPE_ALL: 'wipe-all',
  REQUEST_SITE_ACCESS: 'request-site-access',
  SITE_ACCESS_STATUS: 'site-access-status',
  TRIGGER_SCAN: 'trigger-scan',
  TRIGGER_FILL: 'trigger-fill',

  // background -> panel
  STATE_CHANGED: 'state-changed',
  SCAN_UPDATED: 'scan-updated'
};

/** Per-field outcome codes surfaced in the panel and the in-page overlay. */
export const OUTCOME = {
  FILLED: 'filled',        // written and verified
  UNVERIFIED: 'unverified', // written but readback did not match
  SKIPPED: 'skipped',      // already had a value, or user has no data for it
  SENSITIVE: 'sensitive',  // demographic field, opt-in is off
  UNRESOLVED: 'unresolved', // could not map to any canonical field
  FAILED: 'failed'         // adapter threw
};
