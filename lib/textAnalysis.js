const STOPWORDS = new Set(('a an the and or but if while is are was were be been being to of in on at for with '
  + 'as by from that this these those it its i you he she they we our your their his her not no do does did doing '
  + 'have has had having will would shall should can could may might must about above after again against all am '
  + 'any because before below between both down during each few further here how into more most other over own '
  + 'same so some such than then there through too under until up very what when where which who whom why').split(' '));

const ACTION_VERBS = ['led', 'built', 'designed', 'developed', 'implemented', 'created', 'managed', 'improved',
  'optimized', 'launched', 'automated', 'architected', 'reduced', 'increased', 'delivered', 'collaborated',
  'mentored', 'analyzed', 'engineered', 'deployed', 'streamlined', 'spearheaded', 'coordinated'];

function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9+.\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !STOPWORDS.has(w));
}

function termFreq(tokens) {
  const tf = {};
  for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
  return tf;
}

function cosineSimilarity(tfA, tfB) {
  const vocab = new Set([...Object.keys(tfA), ...Object.keys(tfB)]);
  let dot = 0, magA = 0, magB = 0;
  for (const term of vocab) {
    const a = tfA[term] || 0;
    const b = tfB[term] || 0;
    dot += a * b;
    magA += a * a;
    magB += b * b;
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function extractKeywords(text, topN = 20) {
  const tf = termFreq(tokenize(text));
  return Object.entries(tf)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([word]) => word);
}

// Compare resume text against a job description: score + matched/missing keywords
function jdMatch(resumeText, jdText) {
  const resumeTf = termFreq(tokenize(resumeText));
  const jdKeywords = extractKeywords(jdText, 30);
  const jdTf = termFreq(tokenize(jdText));

  const similarity = cosineSimilarity(resumeTf, jdTf);
  const matched = jdKeywords.filter(k => resumeTf[k]);
  const missing = jdKeywords.filter(k => !resumeTf[k]);

  const score = Math.round(similarity * 100);
  return { score, matchedKeywords: matched, missingKeywords: missing.slice(0, 15) };
}

// Heuristic ATS-friendliness score for a resume's plain text
function atsScore(resumeText) {
  const text = resumeText || '';
  const lower = text.toLowerCase();
  const issues = [];
  let score = 100;

  const wordCount = tokenize(text).length;
  if (wordCount < 80) { issues.push('Resume looks too short — add more detail on experience/projects.'); score -= 15; }
  if (wordCount > 1200) { issues.push('Resume looks very long — consider trimming to 1-2 pages worth of content.'); score -= 10; }

  const hasEmail = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(text);
  if (!hasEmail) { issues.push('No email address detected — add contact info.'); score -= 15; }

  const hasPhone = /(\+?\d[\d\s-]{8,}\d)/.test(text);
  if (!hasPhone) { issues.push('No phone number detected.'); score -= 5; }

  const sections = ['experience', 'education', 'skills', 'project'];
  const missingSections = sections.filter(s => !lower.includes(s));
  if (missingSections.length) {
    issues.push(`Missing common section header(s): ${missingSections.join(', ')}.`);
    score -= missingSections.length * 8;
  }

  const actionVerbCount = ACTION_VERBS.filter(v => lower.includes(v)).length;
  if (actionVerbCount < 3) {
    issues.push('Few strong action verbs found (e.g. built, led, optimized) — start bullets with them.');
    score -= 10;
  }

  const hasNumbers = /\d/.test(text);
  if (!hasNumbers) {
    issues.push('No quantified achievements found (numbers/%) — add measurable impact to bullets.');
    score -= 10;
  }

  const bulletLike = (text.match(/(^|\n)\s*[-•*]/g) || []).length;
  if (bulletLike < 3) {
    issues.push('Few bullet points detected — use bullet points for experience/projects, not paragraphs.');
    score -= 8;
  }

  score = Math.max(0, Math.min(100, score));
  return { score, issues, wordCount, actionVerbCount };
}

// Match a resume against a list of job postings [{id,title,company,description}]
function jobMatch(resumeText, jobs, topN = 5) {
  const resumeTf = termFreq(tokenize(resumeText));
  const scored = jobs.map(job => {
    const jobTf = termFreq(tokenize(job.description + ' ' + job.title));
    const sim = cosineSimilarity(resumeTf, jobTf);
    return { ...job, matchScore: Math.round(sim * 100) };
  });
  return scored.sort((a, b) => b.matchScore - a.matchScore).slice(0, topN);
}

module.exports = { tokenize, termFreq, cosineSimilarity, extractKeywords, jdMatch, atsScore, jobMatch, ACTION_VERBS };
