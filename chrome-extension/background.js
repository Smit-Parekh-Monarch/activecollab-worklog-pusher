// keyboard shortcut Alt+Shift+W → open or focus the pusher tab
chrome.commands.onCommand.addListener((cmd) => {
  if (cmd !== 'open-pusher') return;
  const url = 'http://localhost:5050/';
  chrome.tabs.query({ url }, (tabs) => {
    if (tabs.length) {
      chrome.tabs.update(tabs[0].id, { active: true });
      chrome.windows.update(tabs[0].windowId, { focused: true });
    } else {
      chrome.tabs.create({ url });
    }
  });
});
