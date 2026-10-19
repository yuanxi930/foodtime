(function () {
  const ENV_KEY = 'foodtime-cloudbase-env';
  const OWNER_KEY = 'foodtime-cloud-owner';
  const COLLECTION = 'foodtime_profiles';
  let app = null;
  let auth = null;
  let db = null;
  let envId = '';
  let userId = '';
  let userEmail = '';
  let baseline = null;
  let saving = false;
  let syncing = false;
  let timer = null;
  let poller = null;
  let pendingVerification = null;

  const button = () => document.getElementById('cloud-sync-open');
  const clone = value => JSON.parse(JSON.stringify(value));
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  function setStatus(text) {
    const b = button();
    if (b) b.textContent = text;
    if (b) b.title = text;
  }

  function unwrap(result) {
    if (result && result.error) throw new Error(result.error.message || String(result.error));
    return result && Object.prototype.hasOwnProperty.call(result, 'data') ? result.data : result;
  }

  function ensureApp(value) {
    const nextEnv = (value || '').trim();
    if (!nextEnv) throw new Error('请先填写 CloudBase 环境 ID。');
    if (app && envId !== nextEnv) throw new Error('环境 ID 已连接。更换环境请刷新页面后再连接。');
    if (app) return;
    if (!window.cloudbase || typeof window.cloudbase.init !== 'function') {
      throw new Error('CloudBase SDK 加载失败，请检查网络后刷新页面。');
    }
    app = window.cloudbase.init({ env: nextEnv, region: 'ap-shanghai' });
    auth = app.auth();
    db = app.database();
    envId = nextEnv;
    localStorage.setItem(ENV_KEY, nextEnv);
  }

  function snapshot(value) {
    const source = value || state;
    return clone(Object.assign({}, base, source, {
      favorites: Array.isArray(source.favorites) ? source.favorites : [],
      history: Array.isArray(source.history) ? source.history : [],
      custom: Array.isArray(source.custom) ? source.custom : [],
      edits: source.edits && typeof source.edits === 'object' ? source.edits : {}
    }));
  }

  function mergeItems(remoteItems, localItems) {
    const result = [];
    const seen = new Set();
    (remoteItems || []).concat(localItems || []).forEach((item, index) => {
      const key = item && (item.id || item._syncId || item.date) || JSON.stringify(item) + ':' + index;
      if (seen.has(key)) return;
      seen.add(key);
      result.push(item);
    });
    return result;
  }

  function mergeStates(previous, localValue, remoteValue) {
    const local = snapshot(localValue);
    const remote = snapshot(remoteValue || {});
    const reference = previous ? snapshot(previous) : snapshot(base);
    const merged = {};
    const keys = new Set(Object.keys(base).concat(Object.keys(local), Object.keys(remote)));
    keys.forEach(key => {
      const localChanged = !equal(local[key], reference[key]);
      const remoteChanged = !equal(remote[key], reference[key]);
      if (key === 'custom' || key === 'history') {
        if (!localChanged) merged[key] = remote[key] || [];
        else if (!remoteChanged || !previous) merged[key] = mergeItems(remote[key], local[key]);
        else merged[key] = mergeItems(remote[key], local[key]);
      } else if (key === 'favorites' && !previous) {
        merged[key] = Array.from(new Set((remote[key] || []).concat(local[key] || [])));
      } else if (key === 'edits' && localChanged && remoteChanged) {
        merged[key] = Object.assign({}, remote[key] || {}, local[key] || {});
      } else {
        merged[key] = localChanged ? local[key] : remote[key];
      }
    });
    return snapshot(merged);
  }

  function applyState(next) {
    state = snapshot(next);
    state.favorites = state.favorites || [];
    state.history = state.history || [];
    state.custom = state.custom || [];
    state.edits = state.edits || {};
    places = sample.map(place => Object.assign({}, place)).concat(state.custom);
    places.forEach(place => {
      if (state.edits[place.id]) Object.assign(place, state.edits[place.id]);
    });
    render();
  }

  function adoptAccount(nextUserId) {
    const currentOwner = localStorage.getItem(OWNER_KEY) || '';
    if (currentOwner && currentOwner !== nextUserId) {
      let cached = null;
      try { cached = JSON.parse(localStorage.getItem('foodtime-account-' + nextUserId) || 'null'); } catch (_) {}
      syncing = true;
      try { applyState(cached || base); } finally { syncing = false; }
    }
    userId = nextUserId;
    localStorage.setItem(OWNER_KEY, nextUserId);
  }

  async function readProfile() {
    const result = unwrap(await db.collection(COLLECTION).where({ uid: '{openid}' }).limit(1).get());
    const docs = Array.isArray(result) ? result : (result && result.data) || [];
    return docs[0] || null;
  }

  async function writeProfile(next) {
    await db.collection(COLLECTION).doc(userId).set({
      uid: userId,
      state: snapshot(next),
      updatedAt: Date.now(),
      schemaVersion: 1
    });
  }

  async function syncNow() {
    if (!auth || !db || !userId || syncing) return;
    syncing = true;
    clearTimeout(timer);
    setStatus('同步中…');
    try {
      const doc = await readProfile();
      const local = snapshot(state);
      let merged;
      if (!doc) {
        merged = local;
      } else {
        merged = mergeStates(baseline, local, doc.state || {});
      }
      baseline = clone(merged);
      if (!equal(local, merged)) applyState(merged);
      if (!doc || !equal(merged, doc.state || {})) await writeProfile(merged);
      baseline = clone(merged);
      setStatus('云端已同步');
    } catch (error) {
      setStatus('同步失败');
      console.error('饭点 CloudBase sync failed:', error);
      if (!document.hidden) toast('同步失败：' + (error.message || '请检查环境、登录和数据库权限'));
    } finally {
      syncing = false;
      saving = false;
      if (userId && baseline && !equal(snapshot(state), baseline)) schedule();
    }
  }

  function schedule() {
    if (!userId || syncing || saving) return;
    saving = true;
    setStatus('待同步…');
    clearTimeout(timer);
    timer = setTimeout(() => {
      saving = false;
      syncNow();
    }, 800);
  }

  async function afterLogin() {
    const user = unwrap(await auth.getCurrentUser());
    if (!user) throw new Error('登录状态未建立，请重试。');
    const nextUserId = user.uid || user.sub || '';
    userEmail = user.email || user.username || '';
    if (!nextUserId) throw new Error('CloudBase 未返回用户 ID。');
    adoptAccount(nextUserId);
    setStatus('同步中…');
    closeModal();
    await syncNow();
    startPolling();
  }

  function startPolling() {
    clearInterval(poller);
    poller = setInterval(() => {
      if (!document.hidden) syncNow();
    }, 60000);
  }

  function escHtml(value) {
    return String(value || '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function openSettings() {
    const savedEnv = localStorage.getItem(ENV_KEY) || envId;
    const account = userId ? '<div class="hint">当前账号：' + escHtml(userEmail || userId) + '</div>' : '<div class="hint">登录后，店铺、菜单、收藏和用餐记录会在同一账号的设备间同步。</div>';
    const actions = userId
      ? '<div class="modalactions"><button type="button" class="small" id="ft-export">导出本机数据</button><button type="button" class="small" id="ft-import-button">导入 JSON 备份</button><button type="button" class="small" id="ft-sync-now">立即同步</button><button type="button" class="small" id="ft-logout">退出登录</button></div>'
      : '<div class="modalactions"><button type="button" class="small" id="ft-export">导出本机数据</button><button type="button" class="small" id="ft-import-button">导入 JSON 备份</button><button type="submit" form="ft-login" class="primary">登录并同步</button></div>';
    modal('跨设备同步', '<form id="ft-env-form"><div class="field"><label>CloudBase 环境 ID</label><input class="text" id="ft-env" required value="' + escHtml(savedEnv) + '" placeholder="例如 foodtime-xxxxx"></div><p class="hint">环境 ID 可放在 GitHub Pages 前端；账号密码不会写入代码。先在 CloudBase 创建环境并按项目说明配置数据库权限。</p></form>' + account + (userId ? '' : '<form id="ft-login"><div class="field"><label>邮箱</label><input class="text" id="ft-email" type="email" required autocomplete="username" placeholder="你的登录邮箱"></div><div class="field"><label>密码</label><input class="text" id="ft-password" type="password" required autocomplete="current-password"></div></form><div class="field"><button type="button" class="small" id="ft-show-register">创建账号（邮箱验证码）</button></div><div id="ft-register-area"></div>') + actions + '<input id="ft-import-file" type="file" accept="application/json,.json" style="display:none"><p class="hint">首次登录会把本机已有清单合并到云端。换域名或设备时，可先导出，再在新页面导入。</p>');

    $('#ft-env-form').onsubmit = async event => {
      event.preventDefault();
      try {
        ensureApp($('#ft-env').value);
        toast('CloudBase 环境已连接');
      } catch (error) { toast(error.message); }
    };
    const loginForm = $('#ft-login');
    if (loginForm) loginForm.onsubmit = async event => {
      event.preventDefault();
      try {
        ensureApp($('#ft-env').value);
        const email = $('#ft-email').value.trim();
        unwrap(await auth.signIn({ username: email, password: $('#ft-password').value }));
        await afterLogin();
      } catch (error) { toast(error.message || '登录失败'); }
    };
    const registerButton = $('#ft-show-register');
    if (registerButton) registerButton.onclick = async () => {
      try {
        ensureApp($('#ft-env').value);
        const email = $('#ft-email').value.trim();
        if (!email) { toast('先填写邮箱，再申请验证码'); return; }
        pendingVerification = { email, info: unwrap(await auth.getVerification({ email })) };
        $('#ft-register-area').innerHTML = '<form id="ft-register-finish"><div class="field"><label>邮箱验证码</label><input class="text" id="ft-code" required inputmode="numeric" autocomplete="one-time-code"></div><div class="field"><label>设置密码</label><input class="text" id="ft-new-password" type="password" required minlength="8" autocomplete="new-password"></div><div class="field"><label>昵称（可选）</label><input class="text" id="ft-name" placeholder="饭点用户"></div><button class="primary" type="submit">验证并创建账号</button></form><p class="hint">验证码已发送到 ' + escHtml(email) + '。</p>';
        $('#ft-register-finish').onsubmit = async event => {
          event.preventDefault();
          try {
            const code = $('#ft-code').value.trim();
            const checked = unwrap(await auth.verify({ verification_id: pendingVerification.info.verification_id, verification_code: code }));
            unwrap(await auth.signUp({ email: pendingVerification.email, verification_code: code, verification_token: checked.verification_token, password: $('#ft-new-password').value, name: $('#ft-name').value.trim() || '饭点用户' }));
            pendingVerification = null;
            await afterLogin();
          } catch (error) { toast(error.message || '注册失败，请检查验证码和登录方式配置'); }
        };
      } catch (error) { toast(error.message || '验证码发送失败'); }
    };

    const syncButton = $('#ft-sync-now');
    if (syncButton) syncButton.onclick = () => syncNow();
    const logoutButton = $('#ft-logout');
    if (logoutButton) logoutButton.onclick = async () => {
      try {
        const savedState = JSON.stringify(snapshot(state));
        const savedEnvironment = localStorage.getItem(ENV_KEY) || '';
        const savedOwner = userId;
        if (savedOwner) localStorage.setItem('foodtime-account-' + savedOwner, savedState);
        await auth.signOut();
        localStorage.setItem('foodtime-state', savedState);
        if (savedEnvironment) localStorage.setItem(ENV_KEY, savedEnvironment);
        if (savedOwner) localStorage.setItem(OWNER_KEY, savedOwner);
        userId = '';
        userEmail = '';
        baseline = null;
        clearInterval(poller);
        setStatus('云端已退出');
        closeModal();
      } catch (error) { toast(error.message || '退出失败'); }
    };
    const exportButton = $('#ft-export');
    if (exportButton) exportButton.onclick = exportData;
    const importButton = $('#ft-import-button');
    if (importButton) importButton.onclick = () => $('#ft-import-file').click();
    const fileInput = $('#ft-import-file');
    if (fileInput) fileInput.onchange = importData;
  }

  function exportData() {
    const file = new Blob([JSON.stringify({ app: '饭点', version: 1, exportedAt: new Date().toISOString(), state: snapshot(state) }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'foodtime-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    link.click();
    URL.revokeObjectURL(url);
    toast('备份文件已导出');
  }

  function importData(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        const incoming = parsed.state || parsed;
        if (!incoming || !Array.isArray(incoming.custom) || !Array.isArray(incoming.history)) throw new Error('这不是饭点数据备份文件。');
        const merged = mergeStates(null, snapshot(state), incoming);
        applyState(merged);
        save();
        closeModal();
        toast('数据已导入并与本机清单合并');
      } catch (error) { toast(error.message || '无法读取备份文件'); }
      event.target.value = '';
    };
    reader.readAsText(file, 'utf-8');
  }

  const originalSave = save;
  save = function () {
    originalSave();
    if (userId) {
      const data = JSON.stringify(snapshot(state));
      localStorage.setItem('foodtime-account-' + userId, data);
      localStorage.setItem(OWNER_KEY, userId);
    }
    schedule();
  };

  if (button()) button().addEventListener('click', openSettings);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && userId) syncNow();
  });
  window.foodtimeCloudSync = { schedule, syncNow, openSettings };

  const storedEnv = localStorage.getItem(ENV_KEY);
  if (storedEnv) {
    try {
      ensureApp(storedEnv);
      auth.getCurrentUser().then(user => {
        if (!user) { setStatus('未登录 · 本机保存'); return; }
        adoptAccount(user.uid || user.sub || '');
        userEmail = user.email || user.username || '';
        if (userId) syncNow().then(startPolling);
      }).catch(error => {
        console.error('饭点 CloudBase init failed:', error);
        setStatus('云端不可用');
      });
    } catch (error) {
      console.error('饭点 CloudBase init failed:', error);
      setStatus('配置需检查');
    }
  } else {
    setStatus('☁ 同步设置');
  }
})();
