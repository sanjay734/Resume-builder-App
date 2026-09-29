const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { readDB, writeDB, id } = require('./lib/db');
const { hashPassword, verifyPassword, createSession, getUserFromToken } = require('./lib/auth');
const ta = require('./lib/textAnalysis');
const ai = require('./lib/ai');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const sampleJobs = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'sample-jobs.json'), 'utf-8'));

// ---------- tiny router ----------
const routes = [];
function add(method, pattern, handler) {
  const keys = [];
  const regex = new RegExp('^' + pattern.replace(/:[^/]+/g, m => { keys.push(m.slice(1)); return '([^/]+)'; }) + '$');
  routes.push({ method, regex, keys, handler });
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
  });
  res.end(json);
}

function parseBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { resolve({}); }
    });
  });
}

function getAuthUser(req) {
  const header = req.headers['authorization'] || '';
  const token = header.replace('Bearer ', '');
  return getUserFromToken(token);
}

function resumeToText(resume) {
  if (!resume) return '';
  const parts = [
    resume.personal?.summary || '',
    'Education ' + (resume.education || []).map(e => `${e.degree} ${e.institution}`).join(' '),
    'Experience ' + (resume.experience || []).map(e => `${e.role} ${e.company} ${(e.bullets || []).join(' ')}`).join(' '),
    'Skills ' + (resume.skills || []).join(' '),
    'Projects ' + (resume.projects || []).map(p => `${p.title} ${p.description}`).join(' ')
  ];
  return parts.join('\n');
}

// ---------- AUTH ----------
add('POST', '/api/auth/register', async (req, res, params, body) => {
  const db = readDB();
  if (!body.email || !body.password || !body.name) return send(res, 400, { error: 'name, email, password required' });
  if (db.users.find(u => u.email === body.email)) return send(res, 409, { error: 'Email already registered' });
  const { salt, hash } = hashPassword(body.password);
  const user = { id: id(), name: body.name, email: body.email, salt, hash, createdAt: new Date().toISOString() };
  db.users.push(user);
  writeDB(db);
  const token = createSession(user.id);
  send(res, 201, { token, user: { id: user.id, name: user.name, email: user.email } });
});

add('POST', '/api/auth/login', async (req, res, params, body) => {
  const db = readDB();
  const user = db.users.find(u => u.email === body.email);
  if (!user || !verifyPassword(body.password || '', user.salt, user.hash)) {
    return send(res, 401, { error: 'Invalid credentials' });
  }
  const token = createSession(user.id);
  send(res, 200, { token, user: { id: user.id, name: user.name, email: user.email } });
});

// ---------- RESUMES ----------
add('POST', '/api/resumes', async (req, res, params, body, user) => {
  if (!user) return send(res, 401, { error: 'Login required' });
  const db = readDB();
  const resume = {
    id: id(), userId: user.id, title: body.title || 'My Resume',
    personal: body.personal || {}, education: body.education || [],
    experience: body.experience || [], skills: body.skills || [],
    projects: body.projects || [], versions: [], createdAt: new Date().toISOString()
  };
  db.resumes.push(resume);
  writeDB(db);
  send(res, 201, resume);
});

add('GET', '/api/resumes', async (req, res, params, body, user) => {
  if (!user) return send(res, 401, { error: 'Login required' });
  const db = readDB();
  send(res, 200, db.resumes.filter(r => r.userId === user.id));
});

add('GET', '/api/resumes/:id', async (req, res, params, body, user) => {
  const db = readDB();
  const resume = db.resumes.find(r => r.id === params.id);
  if (!resume) return send(res, 404, { error: 'Not found' });
  send(res, 200, resume);
});

add('PUT', '/api/resumes/:id', async (req, res, params, body, user) => {
  if (!user) return send(res, 401, { error: 'Login required' });
  const db = readDB();
  const idx = db.resumes.findIndex(r => r.id === params.id);
  if (idx === -1) return send(res, 404, { error: 'Not found' });
  db.resumes[idx] = { ...db.resumes[idx], ...body, id: params.id };
  writeDB(db);
  send(res, 200, db.resumes[idx]);
});

// ---------- ATS SCORE ----------
add('POST', '/api/ats/score', async (req, res, params, body) => {
  const db = readDB();
  let text = body.resumeText;
  let resumeId = body.resumeId || null;
  if (!text && resumeId) {
    const resume = db.resumes.find(r => r.id === resumeId);
    text = resumeToText(resume);
  }
  if (!text) return send(res, 400, { error: 'resumeText or resumeId required' });
  const report = ta.atsScore(text);
  const record = { id: id(), resumeId, ...report, createdAt: new Date().toISOString() };
  db.atsReports.push(record);
  writeDB(db);
  send(res, 200, record);
});

// ---------- JD MATCH ----------
add('POST', '/api/jd-match', async (req, res, params, body) => {
  const db = readDB();
  let resumeText = body.resumeText;
  if (!resumeText && body.resumeId) {
    const resume = db.resumes.find(r => r.id === body.resumeId);
    resumeText = resumeToText(resume);
  }
  if (!resumeText || !body.jdText) return send(res, 400, { error: 'resumeText/resumeId and jdText required' });
  const result = ta.jdMatch(resumeText, body.jdText);
  send(res, 200, result);
});

// ---------- TAILORED RESUME VERSION ----------
add('POST', '/api/resumes/:id/versions', async (req, res, params, body) => {
  const db = readDB();
  const resume = db.resumes.find(r => r.id === params.id);
  if (!resume) return send(res, 404, { error: 'Resume not found' });
  const resumeText = resumeToText(resume);
  const match = ta.jdMatch(resumeText, body.jdText || '');

  const tailoredBullets = [];
  for (const exp of resume.experience || []) {
    for (const bullet of exp.bullets || []) {
      const enhanced = await ai.enhanceBullet(bullet, `${exp.role} at ${exp.company}, targeting: ${body.jobTitle || ''}`);
      tailoredBullets.push({ original: bullet, enhanced });
    }
  }

  const version = {
    id: id(), jobTitle: body.jobTitle || '', company: body.company || '', jdText: body.jdText || '',
    matchScoreBefore: match.score, missingKeywords: match.missingKeywords, tailoredBullets,
    createdAt: new Date().toISOString()
  };
  resume.versions = resume.versions || [];
  resume.versions.push(version);
  writeDB(db);
  send(res, 201, version);
});

// ---------- COVER LETTER ----------
add('POST', '/api/cover-letter', async (req, res, params, body) => {
  const db = readDB();
  const resume = db.resumes.find(r => r.id === body.resumeId);
  if (!resume) return send(res, 404, { error: 'Resume not found' });
  const resumeText = resumeToText(resume);
  const match = ta.jdMatch(resumeText, body.jdText || '');
  const content = await ai.generateCoverLetter({
    name: resume.personal?.name || 'Candidate',
    jobTitle: body.jobTitle || 'the role',
    company: body.company || 'your company',
    skills: resume.skills || [],
    matchedKeywords: match.matchedKeywords
  });
  const record = { id: id(), userId: resume.userId, resumeId: resume.id, jobTitle: body.jobTitle, company: body.company, content, createdAt: new Date().toISOString() };
  db.coverLetters.push(record);
  writeDB(db);
  send(res, 201, record);
});

// ---------- INTERVIEW QUESTIONS ----------
add('POST', '/api/interview-questions', async (req, res, params, body) => {
  const db = readDB();
  const resume = db.resumes.find(r => r.id === body.resumeId);
  const questions = await ai.generateInterviewQuestions({
    jobTitle: body.jobTitle || 'this role',
    skills: resume ? resume.skills : (body.skills || []),
    jdText: body.jdText || ''
  });
  const record = { id: id(), resumeId: body.resumeId, jobTitle: body.jobTitle, questions, createdAt: new Date().toISOString() };
  db.interviewSets.push(record);
  writeDB(db);
  send(res, 201, record);
});

// ---------- GITHUB IMPORT ----------
add('POST', '/api/import/github', async (req, res, params, body) => {
  if (!body.username) return send(res, 400, { error: 'username required' });
  https.get({
    hostname: 'api.github.com', path: `/users/${encodeURIComponent(body.username)}/repos?sort=updated&per_page=10`,
    headers: { 'User-Agent': 'resume-builder-app' }
  }, apiRes => {
    let data = '';
    apiRes.on('data', c => data += c);
    apiRes.on('end', () => {
      try {
        const repos = JSON.parse(data);
        if (!Array.isArray(repos)) return send(res, 502, { error: 'GitHub API error (no network in this sandbox, or user not found)', detail: repos });
        const projects = repos.map(r => ({
          title: r.name, description: r.description || '', url: r.html_url, language: r.language
        }));
        send(res, 200, { projects });
      } catch (e) { send(res, 502, { error: 'Failed to parse GitHub response' }); }
    });
  }).on('error', e => send(res, 502, { error: 'GitHub request failed (no network available)', detail: e.message }));
});

// LinkedIn has no public scraping-friendly API, so we accept manually exported/pasted profile data instead
add('POST', '/api/import/linkedin', async (req, res, params, body) => {
  const profileText = body.profileText || '';
  if (!profileText) return send(res, 400, { error: 'Paste exported LinkedIn profile text in profileText' });
  const skills = ta.extractKeywords(profileText, 15);
  send(res, 200, { note: 'Parsed from pasted profile text (LinkedIn API access is restricted for scraping).', suggestedSkills: skills });
});

// ---------- APPLICATIONS TRACKER ----------
add('POST', '/api/applications', async (req, res, params, body, user) => {
  const db = readDB();
  const record = {
    id: id(), userId: user ? user.id : (body.userId || 'guest'), company: body.company, jobTitle: body.jobTitle,
    status: body.status || 'applied', resumeVersionId: body.resumeVersionId || null,
    appliedDate: body.appliedDate || new Date().toISOString(), notes: body.notes || ''
  };
  db.applications.push(record);
  writeDB(db);
  send(res, 201, record);
});

add('GET', '/api/applications', async (req, res, params, body, user) => {
  const db = readDB();
  const uid = user ? user.id : null;
  send(res, 200, uid ? db.applications.filter(a => a.userId === uid) : db.applications);
});

add('PUT', '/api/applications/:id', async (req, res, params, body) => {
  const db = readDB();
  const idx = db.applications.findIndex(a => a.id === params.id);
  if (idx === -1) return send(res, 404, { error: 'Not found' });
  db.applications[idx] = { ...db.applications[idx], ...body, id: params.id };
  writeDB(db);
  send(res, 200, db.applications[idx]);
});

add('DELETE', '/api/applications/:id', async (req, res, params) => {
  const db = readDB();
  db.applications = db.applications.filter(a => a.id !== params.id);
  writeDB(db);
  send(res, 200, { deleted: true });
});

// ---------- ANALYTICS ----------
add('GET', '/api/analytics', async (req, res, params, body, user) => {
  const db = readDB();
  const apps = user ? db.applications.filter(a => a.userId === user.id) : db.applications;
  const byStatus = {};
  for (const a of apps) byStatus[a.status] = (byStatus[a.status] || 0) + 1;
  const atsReports = user ? db.atsReports : db.atsReports;
  const avgAts = atsReports.length ? Math.round(atsReports.reduce((s, r) => s + r.score, 0) / atsReports.length) : null;
  send(res, 200, {
    totalApplications: apps.length,
    byStatus,
    averageAtsScore: avgAts,
    atsScoreHistory: atsReports.map(r => ({ score: r.score, date: r.createdAt }))
  });
});

// ---------- JOB SUGGESTIONS ----------
add('POST', '/api/job-suggestions', async (req, res, params, body) => {
  const db = readDB();
  let text = body.resumeText;
  if (!text && body.resumeId) {
    const resume = db.resumes.find(r => r.id === body.resumeId);
    text = resumeToText(resume);
  }
  if (!text) return send(res, 400, { error: 'resumeText or resumeId required' });
  const matches = ta.jobMatch(text, sampleJobs, 10);
  send(res, 200, { matches, note: 'Matched against a sample job dataset. Swap in a real job-board API (Adzuna, Indeed, LinkedIn Jobs) for live listings.' });
});

// ---------- JOB MATCH DETAIL (matched/missing skills for one specific job) ----------
add('POST', '/api/job-match-detail', async (req, res, params, body) => {
  const db = readDB();
  let text = body.resumeText;
  if (!text && body.resumeId) {
    const resume = db.resumes.find(r => r.id === body.resumeId);
    text = resumeToText(resume);
  }
  const job = sampleJobs.find(j => j.id === body.jobId);
  if (!job) return send(res, 404, { error: 'Job not found' });
  if (!text) return send(res, 400, { error: 'resumeText or resumeId required' });
  const result = ta.jdMatch(text, job.description + ' ' + job.title);
  send(res, 200, { job, ...result });
});

// ---------- RESUME TEXT PARSE (for uploaded resume text -> suggested skills) ----------
add('POST', '/api/resumes/parse-text', async (req, res, params, body) => {
  const text = body.text || '';
  if (!text) return send(res, 400, { error: 'text required' });
  const skills = ta.extractKeywords(text, 20);
  send(res, 200, { suggestedSkills: skills, rawTextPreview: text.slice(0, 4000) });
});

// ---------- AI SUGGESTIONS (combines ATS issues + bullet rewrites + trending skills) ----------
add('POST', '/api/resumes/:id/suggestions', async (req, res, params) => {
  const db = readDB();
  const resume = db.resumes.find(r => r.id === params.id);
  if (!resume) return send(res, 404, { error: 'Resume not found' });
  const text = resumeToText(resume);
  const atsReport = ta.atsScore(text);

  const bulletSuggestions = [];
  for (const exp of resume.experience || []) {
    for (const b of exp.bullets || []) {
      const enhanced = await ai.enhanceBullet(b, `${exp.role} at ${exp.company}`);
      if (enhanced && enhanced.trim() !== b.trim()) bulletSuggestions.push({ original: b, enhanced });
    }
  }

  const allJobText = sampleJobs.map(j => j.description).join(' ');
  const mySkills = (resume.skills || []).map(s => s.toLowerCase());
  const trending = ta.extractKeywords(allJobText, 40).filter(k => !mySkills.includes(k));

  send(res, 200, {
    atsScore: atsReport.score,
    issues: atsReport.issues,
    bulletSuggestions,
    trendingSkills: trending.slice(0, 10)
  });
});

// ---------- static file server ----------
function serveStatic(req, res) {
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(PUBLIC_DIR, filePath);
  if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'forbidden' });
  fs.readFile(filePath, (err, data) => {
    if (err) return send(res, 404, { error: 'Not found' });
    const ext = path.extname(filePath);
    const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'text/plain' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  const url = req.url.split('?')[0];

  for (const route of routes) {
    if (route.method !== req.method) continue;
    const match = url.match(route.regex);
    if (!match) continue;
    const params = {};
    route.keys.forEach((k, i) => params[k] = decodeURIComponent(match[i + 1]));
    const body = ['POST', 'PUT'].includes(req.method) ? await parseBody(req) : {};
    const user = getAuthUser(req);
    try {
      return await route.handler(req, res, params, body, user);
    } catch (e) {
      console.error(e);
      return send(res, 500, { error: 'Internal server error', detail: e.message });
    }
  }

  if (url.startsWith('/api/')) return send(res, 404, { error: 'No such API route' });
  serveStatic(req, res);
});

server.listen(PORT, () => console.log(`Resume Builder server running on http://localhost:${PORT}`));

module.exports = server;
