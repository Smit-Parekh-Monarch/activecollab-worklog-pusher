const portInput = document.getElementById('portInput');
const statusBadge = document.getElementById('statusBadge');
const statusText  = document.getElementById('statusText');
const btnOpen     = document.getElementById('btnOpen');
const btnFigma    = document.getElementById('btnFigma');
const hint        = document.getElementById('hint');
const btnRetry    = document.getElementById('btnRetry');

// persist port setting
const STORAGE_KEY = 'wlp_port';
chrome.storage.local.get([STORAGE_KEY], (res) => {
  if (res[STORAGE_KEY]) portInput.value = res[STORAGE_KEY];
  check();
});
portInput.addEventListener('change', () => {
  chrome.storage.local.set({ [STORAGE_KEY]: portInput.value });
  check();
});

function baseUrl() { return `http://localhost:${portInput.value}`; }

async function check() {
  statusBadge.className = 'status checking';
  statusText.textContent = 'Checking server…';
  btnOpen.disabled = true;
  btnFigma.disabled = true;
  hint.style.display = 'none';

  try {
    const res = await fetch(baseUrl() + '/api/worklogs', { signal: AbortSignal.timeout(2000) });
    if (!res.ok) throw new Error('bad status');
    const data = await res.json();
    const count = data.files ? data.files.length : '?';

    statusBadge.className = 'status ok';
    statusText.textContent = `Server running · ${count} work-log${count !== 1 ? 's' : ''}`;
    btnOpen.disabled = false;
    btnFigma.disabled = false;
  } catch {
    statusBadge.className = 'status err';
    statusText.textContent = 'Server not running';
    hint.style.display = 'block';
  }
}

function openTab(path) {
  chrome.tabs.query({ url: baseUrl() + path + '*' }, (tabs) => {
    if (tabs.length) {
      chrome.tabs.update(tabs[0].id, { active: true });
      chrome.windows.update(tabs[0].windowId, { focused: true });
    } else {
      chrome.tabs.create({ url: baseUrl() + path });
    }
    window.close();
  });
}

btnOpen.addEventListener('click',  () => openTab('/'));
btnFigma.addEventListener('click', () => openTab('/figma/'));
btnRetry.addEventListener('click', check);
