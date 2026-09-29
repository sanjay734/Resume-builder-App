const API = '/api';
let TOKEN = localStorage.getItem('token') || '';
let USER = JSON.parse(localStorage.getItem('user') || 'null');
let RESUMES = [];
let CURRENT_RESUME_ID = localStorage.getItem('currentResumeId') || '';

async function api(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && TOKEN) {
    // Token was present but server rejected it (server restarted / data reset / expired session).
    // This is the root cause of "Login required" / "not found" cascades — fix it here, once, instead of in every page.
    forceLogout('Your session expired — please log in again.');
    throw new Error('Session expired');
  }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
function forceLogout(message) {
  localStorage.clear(); TOKEN = ''; USER = null; CURRENT_RESUME_ID = '';
  document.getElementById('app').classList.add('hidden');
  document.getElementById('authScreen').classList.remove('hidden');
  if (message) document.getElementById('authMsg').textContent = message;
}
function show(el) { el.classList.remove('hidden'); }

// ---------------- AUTH ----------------
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('loginForm').classList.toggle('hidden', btn.dataset.tab !== 'login');
    document.getElementById('registerForm').classList.toggle('hidden', btn.dataset.tab !== 'register');
  });
});
document.getElementById('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  try { onAuthSuccess(await api('POST', '/auth/login', { email: document.getElementById('loginEmail').value, password: document.getElementById('loginPassword').value })); }
  catch (err) { document.getElementById('authMsg').textContent = err.message; }
});
document.getElementById('registerForm').addEventListener('submit', async e => {
  e.preventDefault();
  try { onAuthSuccess(await api('POST', '/auth/register', { name: document.getElementById('regName').value, email: document.getElementById('regEmail').value, password: document.getElementById('regPassword').value })); }
  catch (err) { document.getElementById('authMsg').textContent = err.message; }
});
function onAuthSuccess(data) {
  TOKEN = data.token; USER = data.user;
  localStorage.setItem('token', TOKEN); localStorage.setItem('user', JSON.stringify(USER));
  showApp();
}
document.getElementById('logoutBtn').addEventListener('click', () => {
  localStorage.clear(); TOKEN = ''; USER = null;
  document.getElementById('app').classList.add('hidden');
  document.getElementById('authScreen').classList.remove('hidden');
});

// ---------------- NAV ----------------
function goToPage(page) {
  document.querySelectorAll('.nav-btn[data-page]').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  if (page === 'dashboard') loadDashboard();
  if (page === 'applications') loadApplications();
  if (page === 'analytics') loadAnalytics();
  if (page === 'tailored') loadVersions();
}
document.querySelectorAll('.nav-btn[data-page]').forEach(btn => btn.addEventListener('click', () => goToPage(btn.dataset.page)));
document.querySelectorAll('[data-goto]').forEach(btn => btn.addEventListener('click', () => goToPage(btn.dataset.goto)));

async function showApp() {
  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('welcomeName').textContent = ', ' + (USER?.name || '');
  document.getElementById('todayDate').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  try {
    await loadResumes(); // this call validates the token; api() will forceLogout() on 401 automatically
    loadDashboard();
  } catch (e) { /* forceLogout already handled the UI switch if this was a session issue */ }
}

// ---------------- RESUMES ----------------
async function loadResumes() {
  RESUMES = await api('GET', '/resumes');
  // BUG FIX: if the cached CURRENT_RESUME_ID no longer exists on the server (fresh install, cleared data, etc.), drop it instead of trying to PUT a resume that isn't there.
  if (CURRENT_RESUME_ID && !RESUMES.find(r => r.id === CURRENT_RESUME_ID)) {
    CURRENT_RESUME_ID = '';
    localStorage.removeItem('currentResumeId');
  }
  const sel = document.getElementById('resumeSelect');
  sel.innerHTML = '<option value="">-- New Resume --</option>' + RESUMES.map(r => `<option value="${r.id}">${r.title}</option>`).join('');
  if (CURRENT_RESUME_ID) { sel.value = CURRENT_RESUME_ID; fillResumeForm(RESUMES.find(r => r.id === CURRENT_RESUME_ID)); }
  else { fillResumeForm({}); }
}

document.getElementById('resumeSelect').addEventListener('change', e => {
  if (!e.target.value) { CURRENT_RESUME_ID = ''; localStorage.removeItem('currentResumeId'); fillResumeForm({}); return; }
  const r = RESUMES.find(x => x.id === e.target.value);
  if (r) { fillResumeForm(r); CURRENT_RESUME_ID = r.id; localStorage.setItem('currentResumeId', r.id); }
});

function fillResumeForm(r) {
  document.getElementById('rTitle').value = r.title || 'My Resume';
  document.getElementById('rName').value = r.personal?.name || '';
  document.getElementById('rSummary').value = r.personal?.summary || '';
  document.getElementById('rEducation').value = (r.education || []).map(e => `${e.degree} - ${e.institution}`).join('\n');
  document.getElementById('rExperience').value = (r.experience || []).map(e => `${e.role} @ ${e.company}\n` + (e.bullets || []).map(b => '- ' + b).join('\n')).join('\n\n');
  document.getElementById('rSkills').value = (r.skills || []).join(', ');
  document.getElementById('rProjects').value = (r.projects || []).map(p => `${p.title}: ${p.description}`).join('\n');
  updatePreview();
}

function parseExperience(text) {
  return text.split(/\n\s*\n/).filter(Boolean).map(block => {
    const lines = block.split('\n').filter(Boolean);
    const [role, company] = (lines[0] || '').split('@').map(s => s.trim());
    return { role: role || '', company: company || '', bullets: lines.slice(1).map(l => l.replace(/^-\s*/, '').trim()).filter(Boolean) };
  });
}

function currentFormPayload() {
  return {
    title: document.getElementById('rTitle').value,
    personal: { name: document.getElementById('rName').value, summary: document.getElementById('rSummary').value },
    education: document.getElementById('rEducation').value.split('\n').filter(Boolean).map(line => { const [degree, institution] = line.split(' - '); return { degree: (degree || '').trim(), institution: (institution || '').trim() }; }),
    experience: parseExperience(document.getElementById('rExperience').value),
    skills: document.getElementById('rSkills').value.split(',').map(s => s.trim()).filter(Boolean),
    projects: document.getElementById('rProjects').value.split('\n').filter(Boolean).map(line => { const [title, ...rest] = line.split(':'); return { title: (title || '').trim(), description: rest.join(':').trim() }; })
  };
}

function updatePreview() {
  const p = currentFormPayload();
  const prev = document.getElementById('resumePreview');
  prev.innerHTML = `
    <div class="rp-name">${p.personal.name || 'Your name'}</div>
    <div class="rp-summary">${p.personal.summary || 'Your professional summary will appear here.'}</div>
    ${p.skills.length ? `<h4>Skills</h4><div class="rp-skills">${p.skills.map(s => `<span>${s}</span>`).join('')}</div>` : ''}
    ${p.experience.length ? `<h4>Experience</h4>` + p.experience.map(e => `<div class="rp-item"><b>${e.role}</b> — ${e.company}<ul>${e.bullets.map(b => `<li>${b}</li>`).join('')}</ul></div>`).join('') : ''}
    ${p.projects.length ? `<h4>Projects</h4>` + p.projects.map(pr => `<div class="rp-item"><b>${pr.title}</b> — ${pr.description}</div>`).join('') : ''}
    ${p.education.length ? `<h4>Education</h4>` + p.education.map(ed => `<div class="rp-item">${ed.degree} — ${ed.institution}</div>`).join('') : ''}
  `;
}
['rTitle', 'rName', 'rSummary', 'rEducation', 'rExperience', 'rSkills', 'rProjects'].forEach(id => document.getElementById(id).addEventListener('input', updatePreview));

document.getElementById('resumeForm').addEventListener('submit', async e => {
  e.preventDefault();
  const payload = currentFormPayload();
  const msg = document.getElementById('resumeMsg');
  try {
    // BUG FIX: only PUT if the id we have is actually one we loaded from the server; otherwise POST a new one.
    const idIsValid = CURRENT_RESUME_ID && RESUMES.find(r => r.id === CURRENT_RESUME_ID);
    const saved = idIsValid ? await api('PUT', `/resumes/${CURRENT_RESUME_ID}`, payload) : await api('POST', '/resumes', payload);
    CURRENT_RESUME_ID = saved.id;
    localStorage.setItem('currentResumeId', saved.id);
    msg.style.color = 'var(--teal)'; msg.textContent = 'Saved!';
    await loadResumes();
    document.getElementById('resumeSelect').value = saved.id;
  } catch (err) { msg.style.color = 'var(--red)'; msg.textContent = err.message; }
});

function requireResume() {
  if (!CURRENT_RESUME_ID) { alert('Save a resume first on the Resume Builder page.'); goToPage('resume'); return false; }
  return true;
}

// ---------------- AI SUGGESTIONS ----------------
document.getElementById('runSuggestions').addEventListener('click', async () => {
  if (!requireResume()) return;
  const box = document.getElementById('suggestionsResult');
  show(box); box.textContent = 'Analyzing your resume...';
  try {
    const r = await api('POST', `/resumes/${CURRENT_RESUME_ID}/suggestions`, {});
    box.innerHTML = `
      <div class="score-big">${r.atsScore}/100</div>
      <h4 style="margin-top:0.8rem;">Fix these first</h4>
      <ul>${r.issues.map(i => `<li>${i}</li>`).join('') || '<li>No major issues — nice work.</li>'}</ul>
      ${r.bulletSuggestions.length ? `<h4>Bullet rewrites</h4><ul>${r.bulletSuggestions.map(b => `<li><s style="color:var(--muted)">${b.original}</s><br>→ ${b.enhanced}</li>`).join('')}</ul>` : ''}
      <h4>Trending skills you don't have yet</h4>
      <p class="hint">Frequently requested across sample job postings — add any that genuinely apply to you:</p>
      <div class="skill-tags">${r.trendingSkills.map(s => `<span class="skill-tag matched">${s}</span>`).join('') || '<span class="hint">Nothing notable.</span>'}</div>
    `;
  } catch (err) { box.textContent = err.message; }
});

// ---------------- RESUME UPLOAD / PASTE ----------------
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

document.getElementById('resumeFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  const box = document.getElementById('parseResult');
  const name = file.name.toLowerCase();

  if (name.endsWith('.txt')) {
    const text = await file.text();
    document.getElementById('pasteResumeText').value = text;
    box.textContent = 'Loaded from file — click "Extract into form" to fill fields.';
    return;
  }

  if (name.endsWith('.pdf')) {
    if (!window.pdfjsLib) {
      box.textContent = 'PDF reader could not load (needs internet access in your browser). Please open the PDF, copy the text, and paste it into the box below instead.';
      return;
    }
    box.textContent = 'Reading PDF...';
    try {
      const buf = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
      let fullText = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        fullText += content.items.map(it => it.str).join(' ') + '\n';
      }
      if (!fullText.trim()) throw new Error('empty');
      document.getElementById('pasteResumeText').value = fullText.trim();
      box.textContent = 'PDF read successfully — click "Extract into form" to fill fields.';
    } catch (err) {
      box.textContent = 'Could not read this PDF automatically (it may be a scanned image rather than text). Please open it, copy the text, and paste it into the box below instead.';
    }
    return;
  }

  box.textContent = 'Only .txt and .pdf files are supported for auto-read. Paste text manually for other formats.';
});

document.getElementById('parseResumeBtn').addEventListener('click', async () => {
  const text = document.getElementById('pasteResumeText').value.trim();
  const box = document.getElementById('parseResult');
  if (!text) { box.textContent = 'Paste or upload some resume text first.'; return; }
  box.textContent = 'Extracting...';
  try {
    const r = await api('POST', '/resumes/parse-text', { text });
    const existingSkills = document.getElementById('rSkills').value.split(',').map(s => s.trim()).filter(Boolean);
    const merged = Array.from(new Set([...existingSkills, ...r.suggestedSkills])).slice(0, 25);
    document.getElementById('rSkills').value = merged.join(', ');
    if (!document.getElementById('rSummary').value.trim()) document.getElementById('rSummary').value = text.slice(0, 400);
    updatePreview();
    box.textContent = `Pulled ${r.suggestedSkills.length} likely skills into the Skills field. Review and adjust, then fill in Experience/Education/Projects manually.`;
  } catch (err) { box.textContent = err.message; }
});

// ---------------- ATS ----------------
document.getElementById('runAts').addEventListener('click', async () => {
  if (!requireResume()) return;
  const box = document.getElementById('atsResult'); show(box); box.textContent = 'Analyzing...';
  try {
    const r = await api('POST', '/ats/score', { resumeId: CURRENT_RESUME_ID });
    box.innerHTML = `<div class="score-big">${r.score}/100</div><ul>${r.issues.map(i => `<li>${i}</li>`).join('') || '<li>No major issues found.</li>'}</ul>`;
  } catch (err) { box.textContent = err.message; }
});

// ---------------- JD MATCH ----------------
document.getElementById('runJdMatch').addEventListener('click', async () => {
  if (!requireResume()) return;
  const box = document.getElementById('jdResult'); show(box); box.textContent = 'Matching...';
  try {
    const r = await api('POST', '/jd-match', { resumeId: CURRENT_RESUME_ID, jdText: document.getElementById('jdText').value });
    box.innerHTML = `<div class="score-big">${r.score}% match</div><p><b>Matched:</b> ${r.matchedKeywords.join(', ') || 'none'}</p><p><b>Missing:</b> ${r.missingKeywords.join(', ') || 'none'}</p>`;
  } catch (err) { box.textContent = err.message; }
});

// ---------------- TAILORED VERSIONS ----------------
document.getElementById('runTailor').addEventListener('click', async () => {
  if (!requireResume()) return;
  const box = document.getElementById('tailorResult'); show(box); box.textContent = 'Generating...';
  try {
    const r = await api('POST', `/resumes/${CURRENT_RESUME_ID}/versions`, { jobTitle: document.getElementById('tJobTitle').value, company: document.getElementById('tCompany').value, jdText: document.getElementById('tJdText').value });
    box.innerHTML = `<p><b>Match score:</b> ${r.matchScoreBefore}%</p><p><b>Missing keywords:</b> ${r.missingKeywords.join(', ') || 'none'}</p><b>Tailored bullets:</b><ul>${r.tailoredBullets.map(b => `<li>${b.enhanced}</li>`).join('') || '<li>No experience bullets to enhance yet.</li>'}</ul>`;
    loadVersions();
  } catch (err) { box.textContent = err.message; }
});
async function loadVersions() {
  const list = document.getElementById('versionsList');
  if (!CURRENT_RESUME_ID) { list.innerHTML = '<p class="hint">Save a resume first.</p>'; return; }
  const r = await api('GET', `/resumes/${CURRENT_RESUME_ID}`);
  list.innerHTML = (r.versions || []).slice().reverse().map(v => `<div class="job-card static"><div class="job-top"><b>${v.jobTitle}</b><span class="score">${v.matchScoreBefore}%</span></div><div class="job-meta">${v.company}</div></div>`).join('') || '<p class="hint">No tailored versions yet.</p>';
}

// ---------------- COVER LETTER ----------------
document.getElementById('runCoverLetter').addEventListener('click', async () => {
  if (!requireResume()) return;
  const box = document.getElementById('coverLetterResult'); show(box); box.textContent = 'Writing...';
  try {
    const r = await api('POST', '/cover-letter', { resumeId: CURRENT_RESUME_ID, jobTitle: document.getElementById('clJobTitle').value, company: document.getElementById('clCompany').value, jdText: document.getElementById('clJdText').value });
    box.textContent = r.content;
  } catch (err) { box.textContent = err.message; }
});

// ---------------- INTERVIEW QUESTIONS ----------------
document.getElementById('runInterview').addEventListener('click', async () => {
  if (!requireResume()) return;
  const box = document.getElementById('interviewResult'); show(box); box.textContent = 'Generating...';
  try {
    const r = await api('POST', '/interview-questions', { resumeId: CURRENT_RESUME_ID, jobTitle: document.getElementById('ivJobTitle').value, jdText: document.getElementById('ivJdText').value });
    box.innerHTML = '<ol>' + r.questions.map(q => `<li>${q}</li>`).join('') + '</ol>';
  } catch (err) { box.textContent = err.message; }
});

// ---------------- IMPORT ----------------
document.getElementById('runGithub').addEventListener('click', async () => {
  const box = document.getElementById('githubResult'); show(box); box.textContent = 'Fetching...';
  try {
    const r = await api('POST', '/import/github', { username: document.getElementById('ghUsername').value });
    box.innerHTML = (r.projects || []).map(p => `<div class="job-card static"><b>${p.title}</b><div class="job-meta">${p.language || 'N/A'}</div><div class="job-desc">${p.description || ''}</div></div>`).join('') || 'No repos found.';
  } catch (err) { box.textContent = 'Error: ' + err.message + ' (requires the server to have internet access)'; }
});
document.getElementById('runLinkedin').addEventListener('click', async () => {
  const box = document.getElementById('linkedinResult'); show(box); box.textContent = 'Extracting...';
  try {
    const r = await api('POST', '/import/linkedin', { profileText: document.getElementById('liText').value });
    box.innerHTML = `<p>${r.note}</p><p><b>Suggested skills:</b> ${r.suggestedSkills.join(', ')}</p>`;
  } catch (err) { box.textContent = err.message; }
});

// ---------------- JOB SUGGESTIONS + CLICK-TO-COMPARE MODAL ----------------
function jobCardHtml(j) {
  return `<div class="job-card" data-jobid="${j.id}">
    <div class="job-top"><b>${j.title}</b><span class="score">${j.matchScore}%</span></div>
    <div class="job-meta">${j.company} · ${j.location}</div>
    <div class="job-desc">${j.description}</div>
  </div>`;
}
function attachJobClickHandlers(container) {
  container.querySelectorAll('.job-card[data-jobid]').forEach(card => {
    card.addEventListener('click', () => openJobModal(card.dataset.jobid));
  });
}
async function openJobModal(jobId) {
  const root = document.getElementById('modalRoot');
  root.innerHTML = `<div class="modal-backdrop" id="modalBackdrop"><div class="modal-box"><button class="modal-close" id="modalCloseBtn">✕</button><p class="hint">Loading match details...</p></div></div>`;
  document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
  document.getElementById('modalBackdrop').addEventListener('click', e => { if (e.target.id === 'modalBackdrop') closeModal(); });
  try {
    const r = await api('POST', '/job-match-detail', { resumeId: CURRENT_RESUME_ID, jobId });
    const box = document.querySelector('.modal-box');
    box.innerHTML = `
      <button class="modal-close" id="modalCloseBtn">✕</button>
      <h3>${r.job.title}</h3>
      <div class="hint">${r.job.company} · ${r.job.location}</div>
      <div class="match-bar-track"><div class="match-bar-fill" style="width:${r.score}%"></div></div>
      <div class="score-big" style="font-size:1.4rem;">${r.score}% match</div>
      <p class="hint" style="margin-top:0.9rem;">${r.job.description}</p>
      <h4 style="margin-top:1rem; font-size:0.85rem;">Matching skills</h4>
      <div class="skill-tags">${r.matchedKeywords.length ? r.matchedKeywords.map(k => `<span class="skill-tag matched">${k}</span>`).join('') : '<span class="hint">None yet — add relevant keywords to your resume.</span>'}</div>
      <h4 style="font-size:0.85rem;">Missing skills</h4>
      <div class="skill-tags">${r.missingKeywords.length ? r.missingKeywords.map(k => `<span class="skill-tag missing">${k}</span>`).join('') : '<span class="hint">Nothing missing — great fit!</span>'}</div>
    `;
    document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
  } catch (err) {
    document.querySelector('.modal-box').innerHTML = `<button class="modal-close" id="modalCloseBtn2">✕</button><p class="hint">${err.message}</p>`;
    document.getElementById('modalCloseBtn2').addEventListener('click', closeModal);
  }
}
function closeModal() { document.getElementById('modalRoot').innerHTML = ''; }

document.getElementById('runJobSuggest').addEventListener('click', async () => {
  if (!requireResume()) return;
  const box = document.getElementById('jobsResult');
  box.innerHTML = '<p class="hint">Finding matches...</p>';
  try {
    const r = await api('POST', '/job-suggestions', { resumeId: CURRENT_RESUME_ID });
    box.innerHTML = r.matches.map(jobCardHtml).join('');
    attachJobClickHandlers(box);
  } catch (err) { box.innerHTML = err.message; }
});

// ---------------- APPLICATIONS (Kanban) ----------------
document.getElementById('appForm').addEventListener('submit', async e => {
  e.preventDefault();
  await api('POST', '/applications', { company: document.getElementById('appCompany').value, jobTitle: document.getElementById('appJobTitle').value, status: document.getElementById('appStatus').value });
  e.target.reset();
  loadApplications();
});
const STATUS_COLS = [['applied', 'Applied'], ['interview', 'Interview'], ['offer', 'Offer'], ['rejected', 'Rejected']];
async function loadApplications() {
  const apps = await api('GET', '/applications');
  const board = document.getElementById('kanbanBoard');
  board.innerHTML = STATUS_COLS.map(([key, label]) => {
    const items = apps.filter(a => a.status === key);
    return `<div class="kanban-col">
      <div class="kanban-col-head"><span class="title">${label}</span><span class="count">${items.length}</span></div>
      ${items.map(a => `
        <div class="kanban-card">
          <div class="kc-title">${a.jobTitle}</div>
          <div class="kc-sub">${a.company} · ${new Date(a.appliedDate).toLocaleDateString()}</div>
          <div class="kc-actions">
            <select data-id="${a.id}" class="statusSelect">${STATUS_COLS.map(([k, l]) => `<option value="${k}" ${a.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
            <button data-del="${a.id}" class="kc-del">Del</button>
          </div>
        </div>`).join('') || '<p class="hint" style="font-size:0.78rem;">No applications here.</p>'}
    </div>`;
  }).join('');
  board.querySelectorAll('.statusSelect').forEach(sel => sel.addEventListener('change', async () => { await api('PUT', `/applications/${sel.dataset.id}`, { status: sel.value }); loadApplications(); }));
  board.querySelectorAll('.kc-del').forEach(btn => btn.addEventListener('click', async () => { await api('DELETE', `/applications/${btn.dataset.del}`); loadApplications(); }));
}

// ---------------- ANALYTICS ----------------
function statCard(num, label, iconClass, svgPath) { return `<div class="stat-card"><div class="stat-icon ${iconClass}">${svgPath}</div><div class="num">${num}</div><div class="label">${label}</div></div>`; }
const ICONS = {
  resumes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z"/><path d="M14 3v6h6"/></svg>',
  apps: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>',
  interview: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>',
  offer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l2.5 5 5.5.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9 5.5-.8z"/></svg>'
};
async function loadAnalytics() {
  const a = await api('GET', '/analytics');
  const cards = document.getElementById('analyticsCards');
  const statusIcon = { applied: ['icon-blue', ICONS.apps], interview: ['icon-amber', ICONS.interview], offer: ['icon-teal', ICONS.offer], rejected: ['icon-red', ICONS.apps] };
  const statusHtml = Object.entries(a.byStatus).map(([k, v]) => statCard(v, k[0].toUpperCase() + k.slice(1), statusIcon[k]?.[0] || 'icon-blue', statusIcon[k]?.[1] || ICONS.apps)).join('');
  cards.innerHTML = statCard(a.totalApplications, 'Total Applications', 'icon-blue', ICONS.apps) + statCard(a.averageAtsScore ?? '—', 'Avg ATS Score', 'icon-amber', ICONS.resumes) + statusHtml;
}

// ---------------- DASHBOARD ----------------
async function loadDashboard() {
  const cards = document.getElementById('dashboardCards');
  try {
    const [apps, resumes] = await Promise.all([api('GET', '/applications'), api('GET', '/resumes')]);
    cards.innerHTML = statCard(resumes.length, 'Resumes', 'icon-blue', ICONS.resumes) + statCard(apps.length, 'Applications Tracked', 'icon-amber', ICONS.apps) + statCard(apps.filter(a => a.status === 'interview').length, 'Interviews', 'icon-teal', ICONS.interview) + statCard(apps.filter(a => a.status === 'offer').length, 'Offers', 'icon-red', ICONS.offer);

    const actBox = document.getElementById('recentActivityBox');
    const recent = apps.slice().reverse().slice(0, 5);
    actBox.innerHTML = recent.length ? '<ul class="activity-list">' + recent.map(a => `<li><div><div class="a-title">${a.jobTitle}</div><div class="a-sub">${a.company}</div></div><span class="status-pill status-${a.status}">${a.status}</span></li>`).join('') + '</ul>' : `<div class="empty-state">No applications tracked yet. <a class="cta-link" data-goto="applications">Add your first one →</a></div>`;
    actBox.querySelectorAll('[data-goto]').forEach(el => el.addEventListener('click', () => goToPage(el.dataset.goto)));

    const healthBox = document.getElementById('resumeHealthBox');
    if (!resumes.length) {
      healthBox.innerHTML = `<div class="empty-state">No resume yet. <a class="cta-link" data-goto="resume">Build one →</a></div>`;
    } else {
      try {
        const report = await api('POST', '/ats/score', { resumeId: CURRENT_RESUME_ID || resumes[0].id });
        const circ = 2 * Math.PI * 34;
        const offset = circ - (report.score / 100) * circ;
        healthBox.innerHTML = `<div class="gauge-wrap"><div class="gauge"><svg width="84" height="84" viewBox="0 0 84 84"><circle cx="42" cy="42" r="34" fill="none" stroke="#E2E5EE" stroke-width="8"/><circle cx="42" cy="42" r="34" fill="none" stroke="${report.score >= 70 ? '#1F8A70' : '#E8A33D'}" stroke-width="8" stroke-linecap="round" stroke-dasharray="${circ}" stroke-dashoffset="${offset}"/></svg><div class="gauge-num">${report.score}</div></div><ul class="checklist">${report.issues.slice(0, 4).map(i => `<li class="warn">${i}</li>`).join('') || '<li class="ok">Looking solid</li>'}</ul></div>`;
      } catch (e) { healthBox.innerHTML = `<div class="empty-state">Couldn't load ATS score. <a class="cta-link" data-goto="ats">Run a check →</a></div>`; }
    }
    healthBox.querySelectorAll('[data-goto]').forEach(el => el.addEventListener('click', () => goToPage(el.dataset.goto)));

    const jobsBox = document.getElementById('dashJobsBox');
    if (!resumes.length) { jobsBox.innerHTML = `<div class="empty-state">Build a resume to see job matches.</div>`; }
    else {
      const jr = await api('POST', '/job-suggestions', { resumeId: CURRENT_RESUME_ID || resumes[0].id });
      jobsBox.innerHTML = jr.matches.slice(0, 3).map(jobCardHtml).join('');
      attachJobClickHandlers(jobsBox);
    }
  } catch (e) { cards.innerHTML = ''; }
}

// ---------------- INIT ----------------
if (TOKEN && USER) showApp();
