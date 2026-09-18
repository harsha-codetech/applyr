/*
 * Classic-script bootstrap.
 *
 * MV3 content scripts cannot be declared as ES modules, so this thin loader is
 * the one non-module file in the extension. It dynamic-imports the real content
 * script, which keeps everything downstream modular with no bundler in the build.
 */
(async () => {
  if (window.__applyrBooted) return;
  window.__applyrBooted = true;
  try {
    await import(chrome.runtime.getURL('src/content/main.js'));
  } catch (err) {
    console.error('[applyr] failed to start:', err);
  }
})();
