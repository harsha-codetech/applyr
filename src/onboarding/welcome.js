document.getElementById('open').addEventListener('click', async () => {
  const win = await chrome.windows.getCurrent();
  try {
    await chrome.sidePanel.open({ windowId: win.id });
  } catch (err) {
    // Older Chrome, or the call lost its user gesture.
    alert('Open the side panel from the applyr icon in your toolbar.');
  }
});
