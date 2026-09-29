# AI Resume Builder

A full-stack resume builder with AI-assisted features: ATS scoring, JD matching, tailored resume versions,
cover letter generation, interview question prep, LinkedIn/GitHub import, a job-application tracker,
an analytics dashboard, and resume-based job suggestions.

**Zero external dependencies.** Built entirely on Node.js's built-in `http` module and vanilla HTML/CSS/JS
— no `npm install`, no database server, no build step. Runs anywhere Node is installed.

## Run it

```bash
node server.js
```

Then open **http://localhost:3000** in your browser. That's it.

Data is stored in `data/db.json` (auto-created on first run) — a simple JSON file acting as the database.
Good enough for a portfolio/demo project; swap in MongoDB/Postgres later if you want to scale it.

## Features

| Feature | How it works |
|---|---|
| Resume Builder | Structured form → saved to `db.json`, multiple resumes per user |
| ATS Score Checker | Heuristic analysis (contact info, section headers, action verbs, quantified bullets, length) — no AI needed, pure JS |
| JD Matching | TF-IDF + cosine similarity between resume text and pasted job description, returns matched/missing keywords |
| Tailored Resume Versions | Generates a version scoped to a specific job, rewrites each experience bullet |
| Cover Letter Generator | Templated or AI-generated (see "Enabling real AI" below) |
| Interview Question Generator | Per-job question sets, templated or AI-generated |
| LinkedIn Import | LinkedIn blocks scraping/unauthorized API access, so this accepts **pasted profile text** and extracts likely skills from it |
| GitHub Import | Pulls your public repos via the GitHub REST API (needs internet access on the machine running the server) |
| Application Tracker | Add/update/delete applications with status: applied → interview → offer/rejected |
| Analytics Dashboard | Aggregates applications by status + average ATS score over time |
| Job Suggestions | Matches your resume against a sample job dataset (`data/sample-jobs.json`) using the same TF-IDF engine |

## Enabling real AI (optional)

Cover letters, interview questions, and bullet-point rewriting work **offline out of the box** using
template/heuristic fallbacks, so the whole app is testable with zero setup. To use real GPT output instead:

```bash
export OPENAI_API_KEY=sk-...
node server.js
```

When the key is set, `lib/ai.js` automatically calls the OpenAI API instead of using the fallback templates.

## Swapping in a real job board (optional)

`api/job-suggestions` currently matches against `data/sample-jobs.json` (10 sample listings) — there's no
public, free, scrape-friendly job listings API. For live listings, sign up for a job-board API
(e.g. Adzuna, JSearch on RapidAPI) and replace the `sampleJobs` array in `server.js` with a live fetch call.
The matching algorithm (`lib/textAnalysis.js`'s `jobMatch`) will work unchanged on real data.

## Project structure

```
resume-builder-app/
├── server.js              # HTTP server + all API routes
├── lib/
│   ├── db.js               # JSON file "database" read/write
│   ├── auth.js              # password hashing + session tokens
│   ├── textAnalysis.js      # ATS scoring, JD matching, job matching (TF-IDF/cosine similarity)
│   └── ai.js                 # cover letter / interview Qs / bullet rewriting (OpenAI or offline fallback)
├── data/
│   ├── sample-jobs.json    # sample job postings for the job-suggestion feature
│   └── db.json               # auto-created on first run — your actual data
└── public/                 # frontend (vanilla HTML/CSS/JS, no build step)
    ├── index.html
    ├── css/style.css
    └── js/app.js
```

## Known limitations (be upfront about these in interviews — it shows maturity, not weakness)

- **JSON file DB, not a real database.** Fine for a portfolio demo; would need to migrate to MongoDB/Postgres
  for concurrent users or production use.
- **GitHub import** needs the server to have internet access (this dev sandbox didn't, so it wasn't live-tested
  end-to-end here, but the code path is correct and standard GitHub REST API usage).
- **Job suggestions** run against a small sample dataset, not live job postings — clearly documented in the
  API response itself (`note` field) so it's not misleading.
- **AI features fall back to templates without an API key.** This was a deliberate choice so the whole app is
  testable without any paid API — but mention this trade-off explicitly if asked.
