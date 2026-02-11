const state = {
  user: localStorage.getItem('user') || '',
  role: localStorage.getItem('role') || 'user',
  options: null,
  records: [],
  selectedIds: new Set(),
};

const FORM_FIELDS = [
  'unit_name', 'equipment_type', 'equipment_tag_number', 'inspection_type', 'equipment_name',
  'last_inspection_year', 'inspection_possible', 'update_date', 'inspection_date', 'status', 'final_status',
  'remarks', 'observation', 'recommendation'
];

function $(id) { return document.getElementById(id); }
function isoNow() { return new Date().toISOString(); }

async function api(path, options = {}) {
  const response = await fetch(path, options);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Request failed: ${response.status}`);
  }
  const ct = response.headers.get('content-type') || '';
  return ct.includes('application/json') ? response.json() : response.text();
}

function saveIdentity() {
  const userInput = $('username');
  const roleInput = $('role');
  if (!userInput || !roleInput) return;
  state.user = userInput.value.trim() || 'guest';
  state.role = roleInput.value;
  localStorage.setItem('user', state.user);
  localStorage.setItem('role', state.role);
  alert(`Applied: ${state.user} (${state.role})`);
}

function initIdentity() {
  if ($('username')) $('username').value = state.user;
  if ($('role')) $('role').value = state.role;
  if ($('saveUser')) $('saveUser').addEventListener('click', saveIdentity);
}

function fillSelect(id, values) {
  const el = $(id);
  if (!el) return;
  el.innerHTML = values.map(v => `<option value="${v}">${v}</option>`).join('');
}

async function loadOptions() {
  state.options = await api('/api/options');
  fillSelect('unit_name', state.options.unit);
  fillSelect('equipment_type', state.options.equipment_type);
  fillSelect('inspection_type', state.options.inspection_type);
  fillSelect('inspection_possible', state.options.inspection_possible);
  fillSelect('status', state.options.status);
  fillSelect('final_status', state.options.final_status);
  fillSelect('bulk_status', state.options.status);
  fillSelect('bulk_final_status', state.options.final_status);
}

async function loadRecords() {
  state.records = await api('/api/records');
}

function renderList() {
  const tbody = $('rows');
  if (!tbody) return;
  tbody.innerHTML = state.records.map(r => {
    const checked = state.selectedIds.has(r.id) ? 'checked' : '';
    return `<tr>
      <td><input type="checkbox" data-id="${r.id}" ${checked}></td>
      <td>${r.id}</td><td>${r.unit_name || ''}</td><td>${r.equipment_type || ''}</td><td>${r.equipment_tag_number || ''}</td>
      <td>${r.inspection_type || ''}</td><td>${r.status || ''}</td><td>${r.final_status || ''}</td><td>${r.updated_by || ''}</td>
      <td>
        <a href="/form.html?id=${r.id}"><button>Edit</button></a>
        <button class="secondary" onclick="deleteRecord(${r.id})" ${state.role !== 'admin' ? 'disabled' : ''}>Delete</button>
      </td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = Number(cb.getAttribute('data-id'));
      if (cb.checked) state.selectedIds.add(id); else state.selectedIds.delete(id);
    });
  });
}

window.deleteRecord = async (id) => {
  if (state.role !== 'admin') return alert('Only admin can delete');
  if (!confirm(`Delete record ${id}?`)) return;
  try {
    await api(`/api/records/${id}?role=${state.role}`, { method: 'DELETE' });
    await loadRecords();
    renderList();
  } catch (e) {
    alert(e.message);
  }
};

async function applyBulk() {
  const ids = [...state.selectedIds];
  if (!ids.length) return alert('Please select records first.');
  try {
    await api(`/api/records/bulk-status?role=${state.role}`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ ids, status: $('bulk_status').value, final_status: $('bulk_final_status').value, updated_by: state.user || 'guest' })
    });
    alert('Selected records updated.');
    await loadRecords();
    renderList();
  } catch (e) {
    alert(e.message);
  }
}

function markSelectedComplete() {
  if (!$('bulk_status') || !$('bulk_final_status')) return;
  $('bulk_final_status').value = 'Completed';
}

async function uploadBulk() {
  if (state.role !== 'admin') return alert('Only admin can bulk upload');
  const fileInput = $('bulkFile');
  if (!fileInput.files.length) return alert('Please choose CSV file');
  const fd = new FormData();
  fd.append('file', fileInput.files[0]);
  try {
    const res = await fetch(`/api/records/bulk-upload?role=${state.role}&user=${encodeURIComponent(state.user || 'guest')}`, { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    alert(`Uploaded ${data.inserted} records`);
    await loadRecords();
    renderList();
  } catch (e) {
    alert(e.message);
  }
}

function formPayload() {
  const payload = {};
  FORM_FIELDS.forEach(f => payload[f] = ($(f)?.value || '').trim());
  payload.updated_by = state.user || 'guest';
  if (!payload.update_date) payload.update_date = isoNow();
  if (payload.final_status === 'Completed' && !payload.inspection_date) payload.inspection_date = isoNow();
  return payload;
}

function resetForm() {
  if ($('record_id')) $('record_id').value = '';
  FORM_FIELDS.forEach(f => { if ($(f)) $(f).value = ''; });
}

async function loadFormRecordById(id) {
  if (!id) return;
  const rec = await api(`/api/records/${id}`);
  if (!rec) return;
  $('record_id').value = rec.id;
  FORM_FIELDS.forEach(f => { if ($(f)) $(f).value = rec[f] || ''; });
}

async function saveFormRecord() {
  if (state.role === 'management') return alert('Management role is view-only');
  try {
    const payload = formPayload();
    const id = $('record_id').value;
    if (id) {
      await api(`/api/records/${id}?role=${state.role}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
      alert('Record updated successfully');
    } else {
      await api(`/api/records?role=${state.role}`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
      alert('Record created successfully');
    }
  } catch (e) {
    alert(e.message);
  }
}

function markFormComplete() {
  if ($('final_status')) $('final_status').value = 'Completed';
  if ($('inspection_date')) $('inspection_date').value = isoNow();
  if ($('update_date')) $('update_date').value = isoNow();
}

function renderDashboard() {
  if (!$('dashRows')) return;
  const total = state.records.length;
  const completed = state.records.filter(r => (r.final_status || '').toLowerCase() === 'completed').length;
  const inProgress = state.records.filter(r => (r.final_status || '').toLowerCase() === 'in progress').length;
  const notStarted = state.records.filter(r => (r.final_status || '').toLowerCase() === 'not started').length;
  $('kTotal').textContent = total;
  $('kCompleted').textContent = completed;
  $('kProgress').textContent = inProgress;
  $('kNotStarted').textContent = notStarted;
  $('dashRows').innerHTML = state.records.slice(0, 100).map(r => `<tr><td>${r.id}</td><td>${r.unit_name || ''}</td><td>${r.equipment_tag_number || ''}</td><td>${r.status || ''}</td><td>${r.final_status || ''}</td><td>${r.updated_by || ''}</td><td>${r.updated_at || ''}</td></tr>`).join('');
}

async function initListPage() {
  await loadOptions();
  await loadRecords();
  renderList();
  $('applyBulk').addEventListener('click', applyBulk);
  $('uploadBulk').addEventListener('click', uploadBulk);
  $('markSelectedComplete').addEventListener('click', markSelectedComplete);
  $('clearSelection').addEventListener('click', () => { state.selectedIds.clear(); renderList(); });
}

async function initFormPage() {
  await loadOptions();
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  if (id) await loadFormRecordById(id);
  $('saveRecord').addEventListener('click', saveFormRecord);
  $('markComplete').addEventListener('click', markFormComplete);
  $('resetForm').addEventListener('click', resetForm);
  $('loadByIdBtn').addEventListener('click', async () => { await loadFormRecordById($('loadId').value); });
}

async function initDashboardPage() {
  await loadRecords();
  renderDashboard();
}

(async function init() {
  initIdentity();
  try {
    if (window.pageName === 'list') await initListPage();
    if (window.pageName === 'form') await initFormPage();
    if (window.pageName === 'dashboard') await initDashboardPage();
  } catch (e) {
    alert(`Initialization error: ${e.message}`);
  }
})();
