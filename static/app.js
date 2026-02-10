const state = {
  user: localStorage.getItem('user') || 'guest',
  role: localStorage.getItem('role') || 'user',
  options: {},
  records: []
};

const fields = [
  'unit_name', 'equipment_type', 'equipment_tag_number', 'inspection_type', 'equipment_name',
  'last_inspection_year', 'inspection_possible', 'update_date', 'inspection_date', 'status', 'final_status',
  'remarks', 'observation', 'recommendation'
];

function setUserUI() {
  username.value = state.user;
  role.value = state.role;
  uploadSection.classList.toggle('hidden', state.role !== 'admin');
  formSection.classList.toggle('hidden', state.role === 'management');
  const deleteButtons = document.querySelectorAll('.deleteBtn');
  deleteButtons.forEach(btn => btn.disabled = state.role !== 'admin');
}

async function fetchOptions() {
  state.options = await (await fetch('/api/options')).json();
  fillSelect('unit_name', state.options.unit);
  fillSelect('equipment_type', state.options.equipment_type);
  fillSelect('inspection_type', state.options.inspection_type);
  fillSelect('inspection_possible', state.options.inspection_possible);
  fillSelect('status', state.options.status);
  fillSelect('final_status', state.options.final_status);
  fillSelect('bulk_status', state.options.status);
  fillSelect('bulk_final_status', state.options.final_status);
}

function fillSelect(id, values) {
  document.getElementById(id).innerHTML = values.map(v => `<option value="${v}">${v}</option>`).join('');
}

async function fetchRecords() {
  state.records = await (await fetch('/api/records')).json();
  renderTable();
  renderDashboard();
}

function renderTable() {
  const tbody = document.querySelector('#recordsTable tbody');
  tbody.innerHTML = state.records.map(r => `
    <tr>
      <td>${r.id}</td><td>${r.unit_name || ''}</td><td>${r.equipment_type || ''}</td>
      <td>${r.equipment_tag_number || ''}</td><td>${r.inspection_type || ''}</td>
      <td>${r.status || ''}</td><td>${r.final_status || ''}</td><td>${r.updated_by || ''}</td>
      <td>
        <button onclick="editRecord(${r.id})">Edit</button>
        <button class="deleteBtn" onclick="deleteRecord(${r.id})" ${state.role !== 'admin' ? 'disabled' : ''}>Delete</button>
      </td>
    </tr>`).join('');
}

function renderDashboard() {
  totalCount.textContent = state.records.length;
  completedCount.textContent = state.records.filter(r => (r.final_status || '').toLowerCase() === 'completed').length;
  inProgressCount.textContent = state.records.filter(r => (r.final_status || '').toLowerCase() === 'in progress').length;
}

function resetForm() {
  recordId.value = '';
  fields.forEach(f => document.getElementById(f).value = '');
}

window.editRecord = (id) => {
  const r = state.records.find(x => x.id === id);
  if (!r) return;
  recordId.value = r.id;
  fields.forEach(f => document.getElementById(f).value = r[f] || '');
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.deleteRecord = async (id) => {
  if (state.role !== 'admin') return alert('Only admin can delete.');
  await fetch(`/api/records/${id}?role=${state.role}`, { method: 'DELETE' });
  await fetchRecords();
};

inspectionForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = Object.fromEntries(fields.map(f => [f, document.getElementById(f).value]));
  payload.updated_by = state.user;
  if (payload.final_status === 'Completed' && !payload.inspection_date) payload.inspection_date = new Date().toISOString();

  const id = recordId.value;
  if (id) {
    await fetch(`/api/records/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  } else {
    await fetch('/api/records', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  }
  resetForm();
  await fetchRecords();
});

markComplete.addEventListener('click', () => {
  final_status.value = 'Completed';
  inspection_date.value = new Date().toISOString();
  update_date.value = new Date().toISOString();
});

bulkUpdateBtn.addEventListener('click', async () => {
  const ids = bulk_ids.value.split(',').map(s => Number(s.trim())).filter(Boolean);
  await fetch('/api/records/bulk-status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, status: bulk_status.value, final_status: bulk_final_status.value, updated_by: state.user })
  });
  await fetchRecords();
});

uploadBtn.addEventListener('click', async () => {
  if (state.role !== 'admin') return alert('Only admin can bulk upload.');
  const file = bulkFile.files[0];
  if (!file) return alert('Pick a CSV file.');
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`/api/records/bulk-upload?role=${state.role}&user=${encodeURIComponent(state.user)}`, {
    method: 'POST', body: formData
  });
  const data = await res.json();
  if (!res.ok) return alert(data.error || 'Upload failed');
  alert(`Uploaded ${data.inserted} rows.`);
  await fetchRecords();
});

applyUser.addEventListener('click', () => {
  state.user = username.value.trim() || 'guest';
  state.role = role.value;
  localStorage.setItem('user', state.user);
  localStorage.setItem('role', state.role);
  setUserUI();
});

(async () => {
  await fetchOptions();
  await fetchRecords();
  setUserUI();
})();
