const state = {
  user: localStorage.getItem('user') || 'guest',
  role: localStorage.getItem('role') || 'user',
  options: null,
  records: [],
  selectedIds: new Set(),
  activeUnitFilter: '',
};

const FORM_FIELDS = [
  'unit_name', 'equipment_type', 'equipment_tag_number', 'inspection_type', 'equipment_name',
  'last_inspection_year', 'inspection_possible', 'update_date', 'inspection_date', 'status', 'final_status',
  'remarks', 'observation', 'recommendation',
];

const $ = (id) => document.getElementById(id);
const isoNow = () => new Date().toISOString();

async function api(path, options = {}) {
  const response = await fetch(path, options);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Request failed: ${response.status}`);
  }
  const ct = response.headers.get('content-type') || '';
  return ct.includes('application/json') ? response.json() : response.text();
}

function initIdentity() {
  if ($('username')) $('username').value = state.user;
  if ($('role')) $('role').value = state.role;
  if ($('saveUser')) {
    $('saveUser').addEventListener('click', () => {
      state.user = ($('username').value || '').trim() || 'guest';
      state.role = $('role').value;
      localStorage.setItem('user', state.user);
      localStorage.setItem('role', state.role);
      alert(`Applied user: ${state.user} (${state.role})`);
    });
  }
}

function fillSelect(id, values, includeAll = false) {
  const el = $(id);
  if (!el) return;
  const allOption = includeAll ? '<option value="">All</option>' : '';
  el.innerHTML = allOption + values.map(v => `<option value="${v}">${v}</option>`).join('');
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

  fillSelect('filter_final_status', state.options.final_status, true);
  fillSelect('filter_equipment_type', state.options.equipment_type, true);
  fillSelect('dash_final_status', state.options.final_status, true);
  fillSelect('dash_equipment_type', state.options.equipment_type, true);
}

function buildRecordsQuery({ finalStatus = '', equipmentType = '', ids = [] } = {}) {
  const q = new URLSearchParams();
  if (finalStatus) q.set('final_status', finalStatus);
  if (equipmentType) q.set('equipment_type', equipmentType);
  if (ids.length) q.set('ids', ids.join(','));
  return q.toString();
}

async function loadRecords(filters = {}) {
  const query = buildRecordsQuery(filters);
  const url = query ? `/api/records?${query}` : '/api/records';
  state.records = await api(url);
}

function updateSelectionCount() {
  if ($('selectedCount')) $('selectedCount').textContent = `Selected: ${state.selectedIds.size}`;
}

function updateExportLinks() {
  const filteredFinal = $('filter_final_status')?.value || '';
  const filteredEq = $('filter_equipment_type')?.value || '';
  const selectedIds = [...state.selectedIds];

  if ($('exportFilteredLink')) {
    const q = buildRecordsQuery({ finalStatus: filteredFinal, equipmentType: filteredEq });
    $('exportFilteredLink').href = q ? `/api/export.csv?${q}` : '/api/export.csv';
  }
  if ($('exportSelectedLink')) {
    const q = buildRecordsQuery({ ids: selectedIds });
    $('exportSelectedLink').href = q ? `/api/export.csv?${q}` : '/api/export.csv';
  }
}

function renderList() {
  const tbody = $('rows');
  if (!tbody) return;

  const rows = state.records.map(r => {
    const checked = state.selectedIds.has(r.id) ? 'checked' : '';
    return `
    <tr>
      <td><input type="checkbox" data-id="${r.id}" ${checked}></td>
      <td>${r.id}</td>
      <td>${r.unit_name || ''}</td>
      <td>${r.equipment_type || ''}</td>
      <td>${r.equipment_tag_number || ''}</td>
      <td>${r.inspection_type || ''}</td>
      <td>${r.status || ''}</td>
      <td>${r.final_status || ''}</td>
      <td>${r.updated_by || ''}</td>
      <td>${r.updated_at || ''}</td>
      <td>
        <a href="/form.html?id=${r.id}"><button>Edit</button></a>
        <button class="secondary" onclick="deleteRecord(${r.id})" ${state.role !== 'admin' ? 'disabled' : ''}>Delete</button>
      </td>
    </tr>`;
  }).join('');

  tbody.innerHTML = rows;

  tbody.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = Number(cb.getAttribute('data-id'));
      if (cb.checked) state.selectedIds.add(id);
      else state.selectedIds.delete(id);
      updateSelectionCount();
      updateExportLinks();
    });
  });

  updateSelectionCount();
  updateExportLinks();
}

window.deleteRecord = async (id) => {
  if (state.role !== 'admin') return alert('Only admin can delete');
  if (!confirm(`Delete record ${id}?`)) return;
  await api(`/api/records/${id}?role=${state.role}`, { method: 'DELETE' });
  await loadRecords(getListFilters());
  renderList();
};

function getListFilters() {
  return {
    finalStatus: $('filter_final_status')?.value || '',
    equipmentType: $('filter_equipment_type')?.value || '',
  };
}

async function applyListFilters() {
  state.selectedIds.clear();
  await loadRecords(getListFilters());
  renderList();
}

async function applyBulk() {
  const ids = [...state.selectedIds];
  if (!ids.length) return alert('Please select records first.');

  await api(`/api/records/bulk-status?role=${state.role}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, status: $('bulk_status').value, final_status: $('bulk_final_status').value, updated_by: state.user }),
  });

  alert('Selected records updated successfully.');
  await loadRecords(getListFilters());
  renderList();
}

function markSelectedComplete() {
  if (!$('bulk_final_status')) return;
  $('bulk_final_status').value = 'Completed';
  if ($('bulk_status')) $('bulk_status').value = 'Handover';
}

async function uploadBulk() {
  if (state.role !== 'admin') return alert('Only admin can bulk upload');
  const file = $('bulkFile').files[0];
  if (!file) return alert('Select CSV file first');

  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`/api/records/bulk-upload?role=${state.role}&user=${encodeURIComponent(state.user)}`, { method: 'POST', body: fd });
  const data = await res.json();
  if (!res.ok) return alert(data.error || 'Upload failed');
  alert(`Uploaded ${data.inserted} records`);
  await loadRecords(getListFilters());
  renderList();
}

function formPayload() {
  const payload = {};
  FORM_FIELDS.forEach(f => { payload[f] = ($(f)?.value || '').trim(); });
  payload.updated_by = state.user;
  if (!payload.update_date) payload.update_date = isoNow();
  if (payload.final_status === 'Completed' && !payload.inspection_date) payload.inspection_date = isoNow();
  return payload;
}

function setFormModeLabel(text) {
  if ($('formMode')) $('formMode').textContent = text;
}

function resetForm() {
  if ($('record_id')) $('record_id').value = '';
  FORM_FIELDS.forEach(f => { if ($(f)) $(f).value = ''; });
  if ($('final_status')) $('final_status').value = 'Not Started';
  setFormModeLabel('Create Mode');
}

async function loadFormRecordById(id) {
  if (!id) return;
  const rec = await api(`/api/records/${id}`);
  if (!rec) return;
  $('record_id').value = rec.id;
  FORM_FIELDS.forEach(f => { if ($(f)) $(f).value = rec[f] || ''; });
  setFormModeLabel(`Edit Mode: #${rec.id}`);
}

async function saveFormRecord() {
  if (state.role === 'management') return alert('Management role is view-only');

  const payload = formPayload();
  const id = $('record_id').value;

  if (id) {
    await api(`/api/records/${id}?role=${state.role}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    alert('Record updated');
  } else {
    const result = await api(`/api/records?role=${state.role}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    $('record_id').value = result.id;
    setFormModeLabel(`Edit Mode: #${result.id}`);
    alert('Record created');
  }
}

function markFormComplete() {
  $('final_status').value = 'Completed';
  $('status').value = 'Handover';
  $('inspection_date').value = isoNow();
  $('update_date').value = isoNow();
}

function autoPopulateRemarks() {
  const st = $('status').value;
  const fs = $('final_status').value;
  const unit = $('unit_name').value;
  $('remarks').value = `Unit ${unit}: Status '${st}', Final '${fs}' updated by ${state.user} on ${new Date().toLocaleString()}.`;
}

function countBy(records, key) {
  return records.reduce((acc, r) => {
    const k = r[key] || 'N/A';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
}

function drawDonut(canvasId, items) {
  const c = $(canvasId);
  if (!c) return;
  const ctx = c.getContext('2d');
  const W = c.width, H = c.height;
  ctx.clearRect(0, 0, W, H);

  const total = items.reduce((s, x) => s + x.value, 0) || 1;
  const cx = 130, cy = H / 2, radius = 85, hole = 45;
  let angle = -Math.PI / 2;

  items.forEach((item) => {
    const arc = (item.value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, angle, angle + arc);
    ctx.closePath();
    ctx.fillStyle = item.color;
    ctx.fill();
    angle += arc;
  });

  ctx.beginPath();
  ctx.arc(cx, cy, hole, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();

  ctx.fillStyle = '#1f2937';
  ctx.font = 'bold 18px Segoe UI';
  ctx.fillText(`${total}`, cx - 14, cy + 5);
  ctx.font = '12px Segoe UI';
  ctx.fillText('Total', cx - 16, cy + 22);

  items.forEach((item, i) => {
    const y = 30 + i * 24;
    ctx.fillStyle = item.color;
    ctx.beginPath();
    ctx.arc(270, y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1f2937';
    ctx.font = '12px Segoe UI';
    ctx.fillText(`${item.label}: ${item.value}`, 282, y + 4);
  });
}

function drawBarChart(canvasId, dataset) {
  const c = $(canvasId);
  if (!c) return;
  const ctx = c.getContext('2d');
  const W = c.width, H = c.height;
  ctx.clearRect(0, 0, W, H);

  const keys = Object.keys(dataset);
  const vals = Object.values(dataset);
  const max = Math.max(1, ...vals);

  const left = 45;
  const bottom = H - 30;
  const usableW = W - left - 20;
  const barW = Math.max(18, usableW / Math.max(1, keys.length) - 10);

  ctx.strokeStyle = '#94a3b8';
  ctx.beginPath();
  ctx.moveTo(left, 20);
  ctx.lineTo(left, bottom);
  ctx.lineTo(W - 10, bottom);
  ctx.stroke();

  keys.forEach((k, i) => {
    const v = dataset[k];
    const h = ((bottom - 30) * v) / max;
    const x = left + 10 + i * (barW + 10);
    const y = bottom - h;

    ctx.fillStyle = '#ea580c';
    ctx.fillRect(x, y, barW, h);
    ctx.fillStyle = '#1f2937';
    ctx.font = '11px Segoe UI';
    ctx.fillText(String(v), x + 2, y - 4);
    ctx.save();
    ctx.translate(x + 2, bottom + 12);
    ctx.rotate(-0.35);
    ctx.fillText(k, 0, 0);
    ctx.restore();
  });
}

function buildUnitSummary(records) {
  const map = {};
  records.forEach((r) => {
    const unit = r.unit_name || 'N/A';
    if (!map[unit]) map[unit] = { total: 0, completed: 0, inProgress: 0, notStarted: 0 };
    map[unit].total += 1;
    const fs = (r.final_status || '').toLowerCase();
    if (fs === 'completed') map[unit].completed += 1;
    else if (fs === 'in progress') map[unit].inProgress += 1;
    else map[unit].notStarted += 1;
  });
  return map;
}

function renderDashboard(records = state.records) {
  if (!$('dashRows')) return;

  const completed = records.filter(r => (r.final_status || '').toLowerCase() === 'completed').length;
  const progress = records.filter(r => (r.final_status || '').toLowerCase() === 'in progress').length;
  const notStarted = records.filter(r => (r.final_status || '').toLowerCase() === 'not started').length;

  $('kTotal').textContent = records.length;
  $('kCompleted').textContent = completed;
  $('kProgress').textContent = progress;
  $('kNotStarted').textContent = notStarted;

  drawDonut('statusDonut', [
    { label: 'Completed', value: completed, color: '#22c55e' },
    { label: 'In Progress', value: progress, color: '#3b82f6' },
    { label: 'Not Started', value: notStarted, color: '#f97316' },
  ]);

  drawBarChart('equipmentBars', countBy(records, 'equipment_type'));

  const unitSummary = buildUnitSummary(records);
  const uRows = Object.keys(unitSummary).sort().map(unit => {
    const u = unitSummary[unit];
    return `<tr>
      <td><span class="unit-link" data-unit="${unit}">${unit}</span></td>
      <td>${u.total}</td>
      <td>${u.completed}</td>
      <td>${u.inProgress}</td>
      <td>${u.notStarted}</td>
    </tr>`;
  }).join('');
  $('unitSummaryRows').innerHTML = uRows;

  $('unitSummaryRows').querySelectorAll('.unit-link').forEach((el) => {
    el.addEventListener('click', async () => {
      state.activeUnitFilter = el.getAttribute('data-unit');
      const status = $('dash_final_status').value;
      const eq = $('dash_equipment_type').value;
      const all = await api('/api/records');
      const filtered = all.filter(r => {
        const sOk = !status || (r.final_status || '').toLowerCase() === status.toLowerCase();
        const eOk = !eq || (r.equipment_type || '').toLowerCase() === eq.toLowerCase();
        const uOk = !state.activeUnitFilter || (r.unit_name || '') === state.activeUnitFilter;
        return sOk && eOk && uOk;
      });
      $('dashInfo').textContent = `Filtered by unit: ${state.activeUnitFilter}`;
      renderDashboardTable(filtered);
    });
  });

  renderDashboardTable(records);
}

function renderDashboardTable(records) {
  $('dashRows').innerHTML = records.slice(0, 200).map(r => `
    <tr>
      <td>${r.id}</td>
      <td>${r.unit_name || ''}</td>
      <td>${r.equipment_type || ''}</td>
      <td>${r.equipment_tag_number || ''}</td>
      <td>${r.status || ''}</td>
      <td>${r.final_status || ''}</td>
      <td>${r.updated_by || ''}</td>
      <td>${r.updated_at || ''}</td>
    </tr>`).join('');
}

async function initListPage() {
  await loadOptions();
  await loadRecords();
  renderList();

  $('applyFilters').addEventListener('click', applyListFilters);
  $('resetFilters').addEventListener('click', async () => {
    $('filter_final_status').value = '';
    $('filter_equipment_type').value = '';
    state.selectedIds.clear();
    await loadRecords();
    renderList();
  });

  $('applyBulk').addEventListener('click', applyBulk);
  $('markSelectedComplete').addEventListener('click', markSelectedComplete);
  $('clearSelection').addEventListener('click', () => {
    state.selectedIds.clear();
    renderList();
  });
  $('uploadBulk').addEventListener('click', uploadBulk);

  $('selectAll').addEventListener('change', () => {
    const checked = $('selectAll').checked;
    state.selectedIds.clear();
    if (checked) state.records.forEach(r => state.selectedIds.add(r.id));
    renderList();
  });
}

async function initFormPage() {
  await loadOptions();
  if ($('final_status')) $('final_status').value = 'Not Started';

  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  if (id) await loadFormRecordById(id);

  $('saveRecord').addEventListener('click', saveFormRecord);
  $('markComplete').addEventListener('click', markFormComplete);
  $('copyStatusToRemarks').addEventListener('click', autoPopulateRemarks);
  $('resetForm').addEventListener('click', resetForm);
  $('loadByIdBtn').addEventListener('click', () => loadFormRecordById($('loadId').value));
}

async function initDashboardPage() {
  await loadOptions();
  await loadRecords();
  renderDashboard();

  $('dashApplyFilter').addEventListener('click', async () => {
    state.activeUnitFilter = '';
    const status = $('dash_final_status').value;
    const eq = $('dash_equipment_type').value;
    await loadRecords({ finalStatus: status, equipmentType: eq });
    $('dashInfo').textContent = status || eq ? `Filtered: ${status || 'All status'} / ${eq || 'All equipment'}` : 'All records';
    renderDashboard();
  });

  document.querySelectorAll('#kpiWrap .clickable').forEach((box) => {
    box.addEventListener('click', async () => {
      const status = box.getAttribute('data-status');
      $('dash_final_status').value = status;
      await loadRecords({ finalStatus: status, equipmentType: $('dash_equipment_type').value });
      $('dashInfo').textContent = `Filtered by KPI click: ${status}`;
      renderDashboard();
    });
  });
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
