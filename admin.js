// admin.js - stable, defensive, restores CRUD + comments, removes approve/reject,
// fixes logout, stabilizes Chart rendering so sidebar doesn't shift
(() => {
  const $ = id => document.getElementById(id);

  // wait for DOM ready to attach handlers (prevents missing-element bugs)
  function onReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else setTimeout(fn, 0);
  }

  onReady(() => {
    // --- auth guard & logout ---
    const adminUser = JSON.parse(localStorage.getItem('user') || 'null');
    if (!adminUser || adminUser.role !== 'admin') {
      localStorage.clear();
      window.location = 'login.html';
      return;
    }

    const logoutBtn = $('logoutBtn');
    if (logoutBtn) {
      logoutBtn.removeEventListener?.('click', null);
      logoutBtn.addEventListener('click', () => {
        try { localStorage.removeItem('user'); sessionStorage.clear(); } catch(e){}
        window.location = 'login.html';
      });
    }

    // --- local state & chart refs ---
    let usersCache = [];
    let companiesCache = [];
    let timesheetsCache = [];
    let chartHoursUser = null;
    let chartBillable = null;
    let chartMonthly = null;

    // --- small helpers ---
    function showPage(pageId) {
      const pages = ['pageDashboard','pageUsers','pageCompanies','pageTimesheets','pageCalendar','pageSettings'];
      pages.forEach(p => { const el = $(p); if (el) el.classList.add('hidden'); });
      const target = $(pageId); if (target) target.classList.remove('hidden');

      // nav active style
      const navMap = { navDashboard:'pageDashboard', navUsers:'pageUsers', navCompanies:'pageCompanies', navTimesheets:'pageTimesheets', navCalendar:'pageCalendar', navSettings:'pageSettings' };
      Object.keys(navMap).forEach(nid => {
        const el = $(nid); if (!el) return;
        if (navMap[nid] === pageId) el.classList.add('bg-blue-800','rounded'); else el.classList.remove('bg-blue-800','rounded');
      });
    }

    function safeLog(...args){ console.log('[admin]', ...args); }
    function safeError(...args){ console.error('[admin]', ...args); }

    function showMsg(el, txt, isError=false){
      if (!el) return;
      el.textContent = txt;
      el.style.color = isError ? '#b91c1c' : '#065f46';
      if (txt) setTimeout(()=> el.textContent = '', 4000);
    }

    function safeDestroyChart(c){
      try { if (c && typeof c.destroy === 'function') c.destroy(); } catch(e){ safeError('chart destroy', e); }
    }

    // ensure canvas containers have fixed height (prevents layout shifts)
    function prepareCanvasHeights(){
      const set = (id, h) => {
        const el = $(id);
        if (!el) return;
        el.style.height = h + 'px';
        el.height = h;
      };
      set('chartHoursUser', 260);
      set('chartBillable', 240);
      set('chartMonthly', 300);
    }

    // --- NAV wiring ---
    const navMap = {
      navDashboard: 'pageDashboard',
      navUsers: 'pageUsers',
      navCompanies: 'pageCompanies',
      navTimesheets: 'pageTimesheets',
      navCalendar: 'pageCalendar',
      navSettings: 'pageSettings'
    };
    Object.keys(navMap).forEach(nid=>{
      const el = $(nid);
      if (!el) return;
      el.addEventListener('click', () => {
        const page = navMap[nid];
        showPage(page);
        if (page === 'pageDashboard') loadDashboard().catch(e=>safeError(e));
        if (page === 'pageUsers') loadUsers().catch(e=>safeError(e));
        if (page === 'pageCompanies') loadCompanies().catch(e=>safeError(e));
        if (page === 'pageTimesheets') loadTimesheets().catch(e=>safeError(e));
        if (page === 'pageCalendar') buildCalendar(calYear, calMonth).catch(e=>safeError(e));
      });
    });

    // --- DASHBOARD & CHARTS ---
    async function loadDashboard(){
      try {
        prepareCanvasHeights();

        // totals
        let totals = {};
        try { totals = await window.electronAPI.reportTotals(); } catch(e){ safeError('reportTotals', e); totals = {}; }

        $('kpiUsers').textContent = totals.totalUsers || 0;
        $('kpiHours').textContent = totals.totalHoursThisMonth || 0;
        $('kpiAmount').textContent = `₹${(totals.billableAmount||0).toFixed(2)}`;
        $('kpiTopUser').textContent = totals.topUser || '—';

        // timesheet data (for charts)
        let all = [];
        try { all = await window.electronAPI.timesheetGetAll(); } catch(e){ safeError('timesheetGetAll', e); all = []; }

        // compute hours per user
        const mapHours = {};
        (all||[]).forEach(r=>{
          try {
            const s = (r.start_time||'00:00').split(':').map(Number);
            const e = (r.end_time||'00:00').split(':').map(Number);
            const smins = (s[0]||0)*60 + (s[1]||0);
            const emins = (e[0]||0)*60 + (e[1]||0);
            const worked = Math.max(0, emins - smins - (Number(r.break_minutes)||0));
            const hours = worked / 60;
            if (!mapHours[r.username]) mapHours[r.username] = 0;
            mapHours[r.username] += hours;
          } catch(err){}
        });
        const users = Object.keys(mapHours);
        const hoursData = users.map(u => Math.round(mapHours[u]*100)/100);

        // destroy old charts (safe)
        safeDestroyChart(chartHoursUser);
        safeDestroyChart(chartBillable);
        safeDestroyChart(chartMonthly);

        // render charts inside requestAnimationFrame (prevents layout blocking)
        requestAnimationFrame(()=>{
          try {
            const c1 = $('chartHoursUser')?.getContext('2d');
            if (c1) {
              chartHoursUser = new Chart(c1, {
                type: 'bar',
                data: { labels: users, datasets: [{ label:'Hours', data: hoursData, backgroundColor: 'rgba(59,130,246,0.85)' }] },
                options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}} }
              });
            }

            const billableCount = (all||[]).filter(r=>Number(r.billable)===1).length;
            const nonBillableCount = (all||[]).length - billableCount;
            const c2 = $('chartBillable')?.getContext('2d');
            if (c2) {
              chartBillable = new Chart(c2, {
                type: 'doughnut',
                data: { labels:['Billable','Non-billable'], datasets:[{ data:[billableCount, nonBillableCount], backgroundColor:['#10b981','#ef4444'] }] },
                options: { responsive:true, maintainAspectRatio:false }
              });
            }

            // monthly trend last 6 months
            const monthMap = {};
            (all||[]).forEach(r=>{
              try {
                const d = new Date(r.date);
                if (isNaN(d)) return;
                const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
                if (!monthMap[key]) monthMap[key] = 0;
                const st = (r.start_time||'00:00').split(':').map(Number);
                const et = (r.end_time||'00:00').split(':').map(Number);
                const worked = Math.max(0, ((et[0]||0)*60 + (et[1]||0)) - ((st[0]||0)*60 + (st[1]||0)) - (Number(r.break_minutes)||0));
                monthMap[key] += worked/60;
              } catch(e){}
            });

            const labels = []; const data = [];
            const now = new Date();
            for (let i=5;i>=0;i--){
              const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
              labels.push(d.toLocaleString(undefined, { month:'short', year:'numeric' }));
              const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
              data.push(Math.round((monthMap[key]||0)*100)/100);
            }

            const c3 = $('chartMonthly')?.getContext('2d');
            if (c3) {
              chartMonthly = new Chart(c3, {
                type: 'line',
                data: { labels, datasets:[{ label:'Hours', data, borderColor:'#4f46e5', backgroundColor:'rgba(79,70,229,0.08)', tension:0.2, fill:true }] },
                options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}} }
              });
            }
          } catch (chartErr) {
            safeError('chart render', chartErr);
          }
        });

      } catch (e) {
        safeError('loadDashboard', e);
      }
    }

    // --- USERS CRUD ---
    async function loadUsers(){
      try {
        const rows = await window.electronAPI.adminGetUsers();
        usersCache = rows || [];
        const container = $('usersList');
        container.innerHTML = '';
        usersCache.forEach(u=>{
          const div = document.createElement('div');
          div.className = 'p-3 border-b flex justify-between items-center';
          const left = document.createElement('div');
          left.innerHTML = `<div class="font-semibold">${u.username} ${u.role==='admin' ? '<span class="text-xs text-gray-500">[admin]</span>':''}</div>
                            <div class="text-sm text-gray-600">${u.company_name || 'No Company'}</div>
                            <div class="text-sm text-gray-500">Active: ${u.active ? 'Yes' : 'No'}</div>`;
          const right = document.createElement('div'); right.style.display='flex'; right.style.gap='8px';

          // edit
          const edit = document.createElement('button'); edit.className='px-2 py-1 bg-indigo-600 text-white rounded'; edit.textContent='Edit';
          edit.addEventListener('click', ()=> openEditUserModal(u));
          right.appendChild(edit);

          // reset (not for current admin)
          if (!(u.role === 'admin' && u.id === adminUser.id)){
            const reset = document.createElement('button'); reset.className='px-2 py-1 bg-yellow-400 rounded'; reset.textContent='Reset Pwd';
            reset.addEventListener('click', ()=> openResetPwdModal(u));
            right.appendChild(reset);
          } else {
            const span = document.createElement('span'); span.className='text-sm text-gray-400'; span.textContent='This is you';
            right.appendChild(span);
          }

          // toggle active
          const toggle = document.createElement('button'); toggle.className='px-2 py-1 border rounded';
          toggle.textContent = u.active ? 'Deactivate' : 'Activate';
          toggle.addEventListener('click', async ()=>{
            try {
              const res = await window.electronAPI.adminEditUser({ userId: u.id, username: u.username, role: u.role, company_id: u.company_id, active: u.active ? 0 : 1 });
              if (res && res.success) { await loadUsers(); await loadSummaryAndCounts(); } else alert(res.message || 'Failed');
            } catch (err) { safeError(err); alert('Error'); }
          });
          right.appendChild(toggle);

          // delete
          const del = document.createElement('button'); del.className='px-2 py-1 bg-red-600 text-white rounded'; del.textContent='Delete';
          del.addEventListener('click', async ()=>{
            if (!confirm(`Delete user ${u.username}? This will remove their timesheets.`)) return;
            try {
              const res = await window.electronAPI.adminDeleteUser({ userId: u.id });
              if (res && res.success) { await loadUsers(); await loadSummaryAndCounts(); } else alert(res.message || 'Delete failed');
            } catch (err) { safeError(err); alert('Error'); }
          });
          right.appendChild(del);

          div.appendChild(left); div.appendChild(right);
          container.appendChild(div);
        });

      } catch (err) { safeError('loadUsers', err); }
    }

    // create user
    const btnCreateUser = $('btnCreateUser');
    if (btnCreateUser) {
      btnCreateUser.addEventListener('click', async ()=>{
        const username = $('usrName').value.trim();
        const password = $('usrPass').value.trim();
        const role = $('usrRole').value;
        const company_id = $('usrCompany').value || null;
        if (!username || !password) { showMsg($('usrMsg'), 'Provide username & password', true); return; }
        try {
          const res = await window.electronAPI.adminCreateUser({ username, password, role, company_id });
          if (res && res.success) { $('usrName').value=''; $('usrPass').value=''; await loadUsers(); await loadCompanies(); await loadSummaryAndCounts(); showMsg($('usrMsg'), 'Created'); }
          else showMsg($('usrMsg'), res.message || 'Error', true);
        } catch (err) { safeError(err); showMsg($('usrMsg'), 'Error', true); }
      });
    }

    // --- COMPANIES (list + add) ---
    async function loadCompanies(){
      try {
        const comps = await window.electronAPI.companyList();
        companiesCache = comps || [];
        const list = $('companyList'); list.innerHTML = '';
        comps.forEach(c=>{
          const li = document.createElement('li'); li.className='p-2 border-b flex justify-between items-center';
          li.innerHTML = `<span>${c.company_name}</span>`;
          list.appendChild(li);
        });

        // fill selects
        const usrCompany = $('usrCompany'); if (usrCompany) {
          usrCompany.innerHTML = '<option value="">-- Company (optional) --</option>';
          comps.forEach(c => { const opt=document.createElement('option'); opt.value=c.id; opt.textContent=c.company_name; usrCompany.appendChild(opt); });
        }
        const editUsrCompany = $('editUsrCompany'); if (editUsrCompany) {
          editUsrCompany.innerHTML = '<option value="">-- Company (optional) --</option>';
          comps.forEach(c => { const opt=document.createElement('option'); opt.value=c.id; opt.textContent=c.company_name; editUsrCompany.appendChild(opt); });
        }

      } catch (err) { safeError('loadCompanies', err); }
    }

    const btnAddCompany = $('btnAddCompany');
    if (btnAddCompany) btnAddCompany.addEventListener('click', async ()=>{
      const name = $('compName').value.trim(); if (!name) return;
      try {
        const res = await window.electronAPI.companyCreate({ name });
        if (res && res.success) { $('compName').value=''; await loadCompanies(); await loadSummaryAndCounts(); }
        else alert(res.message || 'Add failed');
      } catch (err) { safeError(err); alert('Error'); }
    });

    // --- TIMESHEETS (list, edit, delete, comment) ---
    async function loadTimesheets(){
      try {
        const rows = await window.electronAPI.timesheetGetAll();
        timesheetsCache = rows || [];
        const container = $('tsList'); container.innerHTML = '';
        timesheetsCache.forEach(r=>{
          const div = document.createElement('div'); div.className='p-3 border-b flex justify-between items-start';
          div.innerHTML = `<div>
              <div class="font-semibold">${r.username} — ${r.date}</div>
              <div class="text-sm text-gray-600">${r.task}</div>
              <div class="text-sm text-gray-500">Time: ${r.start_time} - ${r.end_time} | Break: ${r.break_minutes}m | Company: ${r.company_name||'N/A'}</div>
              <div class="text-sm text-gray-500">Status: ${r.status||'pending'}</div>
            </div>`;
          const actions = document.createElement('div'); actions.style.display='flex'; actions.style.flexDirection='column'; actions.style.gap='6px';

          // comment (kept)
          const cmBtn = document.createElement('button'); cmBtn.className='px-3 py-1 border rounded'; cmBtn.textContent='Comment';
          cmBtn.addEventListener('click', ()=> openCommentPrompt(r.id));
          actions.appendChild(cmBtn);

          // edit
          const eBtn = document.createElement('button'); eBtn.className='px-3 py-1 bg-indigo-600 text-white rounded'; eBtn.textContent='Edit';
          eBtn.addEventListener('click', ()=> openEditTimesheetModal(r));
          actions.appendChild(eBtn);

          // delete
          const dBtn = document.createElement('button'); dBtn.className='px-3 py-1 bg-red-600 text-white rounded'; dBtn.textContent='Delete';
          dBtn.addEventListener('click', async ()=>{
            if (!confirm('Delete this timesheet?')) return;
            try {
              const res = await window.electronAPI.timesheetDelete({ id: r.id });
              if (res && res.success) { await loadTimesheets(); await loadSummaryAndCounts(); } else alert(res.message || 'Delete failed');
            } catch (err) { safeError(err); alert('Error'); }
          });
          actions.appendChild(dBtn);

          div.appendChild(actions);
          container.appendChild(div);
        });
      } catch (err) { safeError('loadTimesheets', err); }
    }

    function openCommentPrompt(timesheetId){
      const txt = prompt('Add a comment (visible to operator):','');
      if (!txt) return;
      (async ()=>{
        try {
          const res = await window.electronAPI.commentAdd({ timesheet_id: timesheetId, user_id: adminUser.id, commenter_role: 'admin', comment: txt });
          if (res && res.success) { alert('Comment added'); await loadTimesheets(); } else alert(res.message || 'Failed');
        } catch(err){ safeError(err); alert('Error'); }
      })();
    }

    // edit timesheet modal
    let editingTS = null;
    function openEditTimesheetModal(ts){
      editingTS = ts;
      $('modalEditTS').classList.remove('hidden');
      $('tsEditTask').value = ts.task || '';
      $('tsEditStart').value = ts.start_time || '';
      $('tsEditEnd').value = ts.end_time || '';
      $('tsEditBreak').value = ts.break_minutes || 0;
      $('tsEditRate').value = ts.rate_per_hour || 0;
    }

    $('tsEditCancel').addEventListener('click', ()=> { editingTS=null; $('modalEditTS').classList.add('hidden'); });

    $('tsEditSave').addEventListener('click', async ()=>{
      if (!editingTS) return;
      const task = $('tsEditTask').value.trim();
      const start = $('tsEditStart').value;
      const end = $('tsEditEnd').value;
      const br = Number($('tsEditBreak').value || 0);
      const rate = Number($('tsEditRate').value || 0);
      function computeAmount(s,e,br,rate){
        try {
          const sh = parseInt(s.split(':')[0],10), sm = parseInt(s.split(':')[1],10);
          const eh = parseInt(e.split(':')[0],10), em = parseInt(e.split(':')[1],10);
          const smins = sh*60 + sm, emins = eh*60 + em;
          if (emins <= smins) return null;
          const worked = emins - smins - br;
          if (worked <= 0) return null;
          return Math.round((worked/60)*rate*100)/100;
        } catch(e){ return null; }
      }
      const amount = computeAmount(start,end,br,rate);
      if (amount === null) { alert('Invalid time range'); return; }

      const payload = { id: editingTS.id, date: editingTS.date, task, start_time: start, end_time: end, break_minutes: br, billable: editingTS.billable, rate_per_hour: rate, billable_amount: amount, company_id: editingTS.company_id, status: editingTS.status };
      try {
        const res = await window.electronAPI.timesheetUpdate(payload);
        if (res && res.success) { editingTS=null; $('modalEditTS').classList.add('hidden'); await loadTimesheets(); await loadSummaryAndCounts(); } else alert(res.message || 'Failed');
      } catch (err) { safeError(err); alert('Error'); }
    });

    // --- CALENDAR (admin all users) ---
    let calYear = new Date().getFullYear();
    let calMonth = new Date().getMonth();
    $('calPrev').addEventListener('click', ()=> changeCalMonth(-1));
    $('calNext').addEventListener('click', ()=> changeCalMonth(1));

    function changeCalMonth(delta){
      calMonth += delta;
      if (calMonth < 0) { calMonth = 11; calYear -= 1; }
      if (calMonth > 11) { calMonth = 0; calYear += 1; }
      buildCalendar(calYear, calMonth);
    }

    async function buildCalendar(year, month){
      try {
        const all = await window.electronAPI.timesheetGetAll();
        const map = {};
        (all||[]).forEach(r => (map[r.date] = map[r.date] || []).push(r));

        const first = new Date(year, month, 1);
        const last = new Date(year, month+1, 0);
        $('calMonthLabel').textContent = first.toLocaleString(undefined, { month:'long', year:'numeric' });

        const grid = $('calendarGrid'); grid.innerHTML = '';
        for (let i=0;i<first.getDay();i++) grid.appendChild(document.createElement('div'));
        for (let d=1; d<= last.getDate(); d++){
          const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
          const cell = document.createElement('div'); cell.className='cal-day'; cell.textContent = d;
          if (map[dateStr]) { cell.classList.add('marked'); cell.title = `${map[dateStr].length} entries`; cell.addEventListener('click', ()=> showCalEntries(dateStr, map[dateStr])); }
          else cell.addEventListener('click', ()=> showCalEntries(dateStr, []));
          if (dateStr === new Date().toISOString().split('T')[0]) cell.classList.add('today');
          grid.appendChild(cell);
        }

        // user filter
        const sel = $('calUserFilter');
        if (sel) {
          sel.innerHTML = '<option value="">All users</option>';
          const users = [...new Set((all||[]).map(r=>r.username))];
          users.forEach(u => { const opt = document.createElement('option'); opt.value = u; opt.textContent = u; sel.appendChild(opt); });
          sel.onchange = () => {
            const val = sel.value;
            if (!val) buildCalendar(calYear, calMonth);
            else {
              const filtered = (all||[]).filter(r => r.username === val);
              const fmap = {}; filtered.forEach(r => (fmap[r.date] = fmap[r.date] || []).push(r));
              grid.innerHTML = '';
              for (let i=0;i<first.getDay();i++) grid.appendChild(document.createElement('div'));
              for (let d=1; d<= last.getDate(); d++) {
                const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
                const cell = document.createElement('div'); cell.className='cal-day'; cell.textContent=d;
                if (fmap[dateStr]) { cell.classList.add('marked'); cell.title = `${fmap[dateStr].length} entries`; cell.addEventListener('click', ()=> showCalEntries(dateStr, fmap[dateStr])); }
                else cell.addEventListener('click', ()=> showCalEntries(dateStr, []));
                if (dateStr === new Date().toISOString().split('T')[0]) cell.classList.add('today');
                grid.appendChild(cell);
              }
            }
          };
        }

      } catch (err) { safeError('buildCalendar', err); }
    }

    function showCalEntries(dateStr, rows){
      const out = $('calEntries');
      out.innerHTML = `<div class="font-semibold mb-2">Entries for ${dateStr}</div>` + (rows.length ? rows.map(r=>`
        <div class="p-2 border-b">
          <div><strong>${r.username}</strong> — ${r.task}</div>
          <div class="text-sm text-gray-600">${r.start_time} - ${r.end_time} | Break ${r.break_minutes}m | ₹${Number(r.billable_amount||0).toFixed(2)} | Status: ${r.status || 'pending'}</div>
        </div>
      `).join('') : '<div class="text-sm text-gray-600">No entries</div>');
    }

    // --- reset pwd & edit user flows ---
    let editingUser = null;
    function openEditUserModal(user){
      editingUser = user;
      $('modalEditUser').classList.remove('hidden');
      $('editUsrName').value = user.username || '';
      $('editUsrRole').value = user.role || 'operator';
      $('editUsrCompany').value = user.company_id || '';
    }
    $('editUsrCancel').addEventListener('click', ()=> { editingUser = null; $('modalEditUser').classList.add('hidden'); });
    $('editUsrSave').addEventListener('click', async ()=>{
      if (!editingUser) return;
      const username = $('editUsrName').value.trim();
      const role = $('editUsrRole').value;
      const company_id = $('editUsrCompany').value || null;
      try {
        const res = await window.electronAPI.adminEditUser({ userId: editingUser.id, username, role, company_id, active: editingUser.active });
        if (res && res.success) { editingUser=null; $('modalEditUser').classList.add('hidden'); await loadUsers(); await loadSummaryAndCounts(); }
        else alert(res.message || 'Save failed');
      } catch (err) { safeError(err); alert('Error'); }
    });

    let resettingUser = null;
    function openResetPwdModal(user){
      resettingUser = user;
      $('modalResetPwd').classList.remove('hidden');
      $('resetPwdNew').value = '';
    }
    $('resetPwdCancel').addEventListener('click', ()=> { resettingUser=null; $('modalResetPwd').classList.add('hidden'); });
    $('resetPwdSave').addEventListener('click', async ()=>{
      const np = $('resetPwdNew').value.trim();
      if (!np || !resettingUser) return alert('Password required');
      try {
        const res = await window.electronAPI.adminResetPassword({ userId: resettingUser.id, newPassword: np });
        if (res && res.success) { alert('Password reset'); resettingUser=null; $('modalResetPwd').classList.add('hidden'); }
        else alert(res.message || 'Reset failed');
      } catch (err) { safeError(err); alert('Error'); }
    });

    // --- settings (admin change own password) ---
    $('setChange').addEventListener('click', async ()=>{
      const oldP = $('setOld').value || '', newP = $('setNew').value || '', conf = $('setConfirm').value || '';
      if (!oldP || !newP) { showMsg($('setMsg'), 'Fill fields', true); return; }
      if (newP !== conf) { showMsg($('setMsg'), 'Passwords do not match', true); return; }
      try {
        const res = await window.electronAPI.userChangePassword({ userId: adminUser.id, oldPassword: oldP, newPassword: newP });
        if (res && res.success) { showMsg($('setMsg'), 'Changed — logging out'); setTimeout(()=>{ localStorage.clear(); window.location='login.html';}, 1200); }
        else showMsg($('setMsg'), res.message || 'Failed', true);
      } catch (err) { safeError(err); showMsg($('setMsg'), 'Error', true); }
    });

    // --- summary counts loader ---
    async function loadSummaryAndCounts(){
      try {
        const totals = await window.electronAPI.reportTotals();
        $('kpiUsers').textContent = totals.totalUsers || 0;
        $('kpiHours').textContent = totals.totalHoursThisMonth || 0;
        $('kpiAmount').textContent = `₹${(totals.billableAmount||0).toFixed(2)}`;
      } catch (err) { safeError(err); }
    }

    // --- init: load initial data & show dashboard ---
    async function init(){
      try {
        showPage('pageDashboard');
        // close modals by clicking outside
        document.querySelectorAll('.modal-bg').forEach(m => m.addEventListener('click', e => { if (e.target === m) m.classList.add('hidden'); }));

        // initial loads
        await loadCompanies();
        await loadUsers();
        await loadTimesheets();
        await buildCalendar(calYear, calMonth);

        // load charts but don't block UI
        loadDashboard().catch(e=>safeError(e));
        await loadSummaryAndCounts();

        // ensure charts resize correctly on window resize
        window.addEventListener('resize', ()=> {
          try { chartHoursUser?.resize(); chartBillable?.resize(); chartMonthly?.resize(); } catch(e){}
        });
      } catch (err) { safeError('init', err); }
    }

    // run init
    init();
  });
})();
