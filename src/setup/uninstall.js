(() => {
  'use strict';

  const api = window.uninstall;
  const $ = s => document.querySelector(s);
  let busy = false;

  async function boot() {
    const info = await api.info();
    $('#titleVer').textContent = `Vanilla++ ${info.version}`;
    $('#dir').value = info.installDir;
    if (info.sakura) $('#pano').src = info.sakura;
  }

  $('#min').onclick = () => api.minimize();
  $('#close').onclick = () => { if (!busy) api.close(); };
  $('#cancel').onclick = () => { if (!busy) api.close(); };

  $('#go').onclick = async () => {
    if (busy) return;
    busy = true;
    $('#err').textContent = '';
    $('#go').disabled = true;
    $('#cancel').disabled = true;
    $('#wipe').disabled = true;
    $('#progress').hidden = false;
    $('#fill').style.width = '40%';
    $('#goLabel').textContent = 'Удаляем…';
    try {
      await api.run({ wipe: $('#wipe').checked });
      $('#fill').style.width = '100%';
      $('#progText').textContent = 'Готово';
    } catch (e) {
      busy = false;
      $('#err').textContent = e.message;
      $('#go').disabled = false;
      $('#cancel').disabled = false;
      $('#wipe').disabled = false;
      $('#goLabel').textContent = 'Удалить';
      $('#progText').textContent = 'Не получилось';
    }
  };

  boot().catch(e => { $('#err').textContent = e.message; });
})();
