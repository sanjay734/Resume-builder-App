const https = require('https');
const { ACTION_VERBS } = require('./textAnalysis');

function hasKey() {
  return !!process.env.OPENAI_API_KEY;
}

function callOpenAI(prompt) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 600
    });
    const req = https.request({
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Length': Buffer.byteLength(data)
      }
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          resolve(json.choices?.[0]?.message?.content || '');
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ---- Cover letter ----
async function generateCoverLetter({ name, jobTitle, company, skills, matchedKeywords }) {
  if (hasKey()) {
    const prompt = `Write a concise, professional cover letter for ${name} applying to the ${jobTitle} role at ${company}. ` +
      `Highlight these skills: ${skills.join(', ')}. Mention these relevant keywords naturally: ${matchedKeywords.join(', ')}. Keep it under 300 words.`;
    return callOpenAI(prompt);
  }
  // offline template fallback
  return `Dear Hiring Manager,

I am excited to apply for the ${jobTitle} position at ${company}. With hands-on experience in ${skills.slice(0, 4).join(', ')}, `
    + `I have developed a strong foundation that aligns closely with what your team is looking for, particularly around ${matchedKeywords.slice(0, 4).join(', ') || 'the core responsibilities of this role'}.

`
    + `In my recent projects, I have applied these skills to build real, working solutions, and I am eager to bring the same energy and problem-solving `
    + `approach to ${company}. I would welcome the opportunity to discuss how my background can contribute to your team's goals.

`
    + `Thank you for your time and consideration.

Sincerely,
${name}`;
}

// ---- Interview questions ----
async function generateInterviewQuestions({ jobTitle, skills, jdText }) {
  if (hasKey()) {
    const prompt = `Generate 8 likely interview questions (mix of technical and behavioral) for a candidate applying to a ${jobTitle} role, ` +
      `given these skills: ${skills.join(', ')} and this job description: ${jdText}. Return as a numbered list only.`;
    const text = await callOpenAI(prompt);
    return text.split('\n').map(l => l.replace(/^\d+[.)]\s*/, '').trim()).filter(Boolean);
  }
  // offline template fallback
  const generic = [
    `Tell me about a project where you used ${skills[0] || 'your core skills'}.`,
    `How would you approach debugging a production issue under time pressure?`,
    `Describe a time you had to learn a new technology quickly for a project.`,
    `Why are you interested in the ${jobTitle} role at this company?`,
    `Walk me through how you'd design a system related to this job's responsibilities.`,
    `Tell me about a time you disagreed with a teammate — how did you resolve it?`,
    `What's a challenging bug or problem you solved recently, and how?`,
    `Where do you see yourself growing in this ${jobTitle} role over the next year?`
  ];
  return generic;
}

// ---- Bullet point enhancer ----
async function enhanceBullet(bulletText, roleContext = '') {
  if (hasKey()) {
    const prompt = `Rewrite this resume bullet point to be more impactful, using a strong action verb and, if plausible, a quantified result. ` +
      `Context/role: ${roleContext}. Bullet: "${bulletText}". Return only the rewritten bullet.`;
    return (await callOpenAI(prompt)).trim();
  }
  // offline heuristic fallback: prepend an action verb if missing, nudge toward quantification
  const lower = bulletText.toLowerCase();
  const hasVerbStart = ACTION_VERBS.some(v => lower.trim().startsWith(v));
  const hasNumber = /\d/.test(bulletText);
  let out = bulletText.trim();
  if (!hasVerbStart) {
    const verb = ACTION_VERBS[Math.floor(Math.random() * ACTION_VERBS.length)];
    out = `${verb.charAt(0).toUpperCase() + verb.slice(1)} ${out.charAt(0).toLowerCase() + out.slice(1)}`;
  }
  if (!hasNumber) {
    out += ' (add a metric here, e.g. "reducing load time by 30%" or "for 500+ users")';
  }
  return out;
}

module.exports = { hasKey, generateCoverLetter, generateInterviewQuestions, enhanceBullet };
