/**
 * PSA generation API — structured Project Start Architecture documents.
 * RAG-augmented, quality-validated, with folder scan support.
 */
import { Router, type Request, type Response } from 'express';
import { ragPipeline, COLLECTION_PSAS } from '../rag/index.js';
import { createPSA, listPSAs, getPSA } from '../db/store.js';
import { listTemplates, getTemplate } from '../templates/index.js';
import OpenAI from 'openai';

export const psaRouter = Router();

const AI_MODEL = process.env.AI_MODEL || 'gpt-4o-mini';

function getClient(): OpenAI {
  return new OpenAI({
    apiKey: process.env.AI_API_KEY || '',
    baseURL: process.env.AI_BASE_URL || undefined,
  });
}

const SYSTEM_PROMPT = `You are an expert software architect who creates exceptional Project Start Architecture (PSA) documents.

CRITICAL RULES:
- Never use vague adjectives without metrics. Instead of "scalable system", write "handles 10K concurrent users with <500ms P95 response time (to be validated)".
- If you don't know a specific number, say "estimated" or "to be validated" — never fabricate.
- Every risk must include likelihood (low/medium/high) and a specific mitigation.
- Dependencies must name the specific team, system, or vendor — not "external dependency".
- Timeline milestones must have concrete deliverables, not "Phase 1 complete".

Generate the PSA as a JSON object with these fields:
{
  "executive_summary": "2-3 paragraphs capturing the what, why, and how",
  "project_scope": "### In Scope\\n- ...\\n\\n### Out of Scope\\n- ...\\n\\n### Assumptions\\n- ...",
  "technical_architecture": "System components, data flow, integration points. Use specific technology names.",
  "key_decisions": "| Decision | Rationale | Alternatives Rejected | Impact |\\n|...|...|...|...|",
  "dependencies": "| Dependency | Owner | Risk if Delayed | Mitigation |\\n|...|...|...|...|",
  "risks": "| Risk | Likelihood | Impact | Mitigation |\\n|...|...|...|...|",
  "timeline": "| Milestone | Deliverable | Target Date | Dependencies |\\n|...|...|...|...|",
  "success_criteria": "Specific, measurable criteria. Each must answer: how will we know this succeeded?",
  "team_impact": "| Role | Involvement | Effort Estimate | Key Responsibility |\\n|...|...|...|...|",
  "tags": ["tag1", "tag2"]
}`;

interface PSAGenerationRequest {
  title: string;
  description: string;
  context?: string;
  requirements?: string[];
  constraints?: string[];
  techStack?: string[];
  teamSize?: string;
  timeline?: string;
  scope?: string;
  impactedRoles?: string[];
  profile?: 'detailed' | 'guided';
}

interface GeneratedPSA {
  executive_summary: string;
  project_scope: string;
  technical_architecture: string;
  key_decisions: string;
  dependencies: string;
  risks: string;
  timeline: string;
  success_criteria: string;
  team_impact: string;
  tags: string[];
  [key: string]: unknown;
}

// POST /api/psa/generate
psaRouter.post('/psa/generate', async (req: Request, res: Response) => {
  try {
    const r: PSAGenerationRequest = req.body;
    if (!r.title) { res.status(400).json({ error: 'title required' }); return; }
    if (!process.env.AI_API_KEY) { res.status(503).json({ error: 'AI_API_KEY not configured' }); return; }

    // 1. RAG context
    const ragContext = await ragPipeline.generateContext(`${r.title} ${r.description || ''}`, 5);

    // 2. Build prompt
    const prompt = buildPrompt(r, ragContext);

    // 3. Generate
    const client = getClient();
    const response = await client.chat.completions.create({
      model: AI_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 4000,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content || '{}';
    let generated: GeneratedPSA;
    try {
      const jsonStart = content.indexOf('{');
      const jsonEnd = content.lastIndexOf('}') + 1;
      generated = JSON.parse(content.slice(jsonStart, jsonEnd));
    } catch {
      generated = { executive_summary: content, project_scope: '', technical_architecture: '', key_decisions: '', dependencies: '', risks: '', timeline: '', success_criteria: '', team_impact: '', tags: [] };
    }

    // 4. Validate (free heuristics)
    const validation = validatePSA(generated, r.constraints);

    // 5. Auto-retry if score < 7
    let retried = false;
    if (validation.score < 7) {
      const feedback = `Issues: ${validation.issues.join('; ')}. Suggestions: ${validation.suggestions.join('; ')}`;
      const retry = await client.chat.completions.create({
        model: AI_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt + `\n\n## Validator Feedback (improve these):\n${feedback}` },
        ],
        temperature: 0.7,
        max_tokens: 4000,
        response_format: { type: 'json_object' },
      });
      try {
        const rc = retry.choices[0]?.message?.content || '{}';
        const js = rc.indexOf('{');
        const je = rc.lastIndexOf('}') + 1;
        generated = JSON.parse(rc.slice(js, je));
        retried = true;
        const v2 = validatePSA(generated, r.constraints);
        validation.score = v2.score;
        validation.issues = v2.issues;
        validation.suggestions = v2.suggestions;
        validation.passed = v2.passed;
      } catch { /* keep original */ }
    }
    validation.retried = retried;

    // 6. Store
    const fullContent = JSON.stringify(generated);
    const psa = createPSA(r.title, 'general', fullContent, ragContext || undefined, AI_MODEL);

    // 7. Index
    try {
      await ragPipeline.addDocument(
        { id: psa!.id as string, content: `${r.title}\n${generated.executive_summary}`, metadata: { title: r.title } },
        COLLECTION_PSAS
      );
    } catch { /* non-blocking */ }

    res.status(201).json({
      ok: true,
      psa: { ...psa, sections: generated },
      validation,
      ragContextUsed: !!ragContext,
      model: AI_MODEL,
      review_required: true,
    });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// GET /api/psa
psaRouter.get('/psa', (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string || '20', 10);
  const offset = parseInt(req.query.offset as string || '0', 10);
  const { items, total } = listPSAs(limit, offset);
  // Parse stored JSON content back into sections
  const enriched = items.map(item => {
    const i = item as Record<string, unknown>;
    try {
      if (typeof i.content === 'string' && i.content.startsWith('{')) {
        i.sections = JSON.parse(i.content as string);
      }
    } catch { /* keep as-is */ }
    return i;
  });
  res.json({ psas: enriched, total });
});

// GET /api/psa/:id
psaRouter.get('/psa/:id', (req: Request, res: Response) => {
  const psa = getPSA(req.params.id) as Record<string, unknown> | undefined;
  if (!psa) { res.status(404).json({ error: 'PSA not found' }); return; }
  try {
    if (typeof psa.content === 'string' && (psa.content as string).startsWith('{')) {
      psa.sections = JSON.parse(psa.content as string);
    }
  } catch { /* keep as-is */ }
  res.json(psa);
});

// ================================================================
// Prompt builder
// ================================================================

function buildPrompt(r: PSAGenerationRequest, ragContext: string): string {
  let p = `Generate a Project Start Architecture (PSA) document.\n\n`;
  p += `## Project: ${r.title}\n${r.description || ''}\n\n`;

  if (r.context) p += `## Additional Context\n${r.context}\n\n`;
  if (r.requirements?.length) p += `## Requirements\n${r.requirements.map(x => `- ${x}`).join('\n')}\n\n`;
  if (r.constraints?.length) p += `## Constraints\n${r.constraints.map(x => `- ${x}`).join('\n')}\n\n`;
  if (r.techStack?.length) p += `## Tech Stack\n${r.techStack.map(x => `- ${x}`).join('\n')}\n\n`;
  if (r.teamSize) p += `## Team Size\n${r.teamSize}\n\n`;
  if (r.timeline) p += `## Timeline\n${r.timeline}\n\n`;
  if (r.scope) p += `## Scope\n${r.scope}\n\n`;
  if (r.impactedRoles?.length) p += `## Impacted Roles\n${r.impactedRoles.map(x => `- ${x}`).join('\n')}\n\n`;

  if (ragContext) {
    p += `## Related Context from Knowledge Base\n${ragContext}\n\nEnsure consistency with existing project documents.\n\n`;
  }

  if (r.profile === 'guided') {
    p += `## Note: Include brief explanatory comments in each section to help less experienced architects understand what makes each section good.\n\n`;
  }

  return p;
}

// ================================================================
// Validation (free heuristics — same pattern as ADR-Tool)
// ================================================================

const VAGUE_TERMS = [/\bbetter\b/i, /\bimproved\b/i, /\beasier\b/i, /\bmore scalable\b/i, /\bmore secure\b/i, /\bmore efficient\b/i, /\bfaster\b/i, /\bsimpler\b/i];
const METRIC_NEAR = [/\d+%/, /\d+x/, /\d+ms/, /\$\d+/, /\d+\s*user/, /estimated/, /to be validated/, /benchmark/, /SLA/, /P\d+/];

interface ValidationResult {
  score: number;
  passed: boolean;
  issues: string[];
  suggestions: string[];
  retried: boolean;
}

function validatePSA(psa: GeneratedPSA, constraints?: string[]): ValidationResult {
  const issues: string[] = [];
  const suggestions: string[] = [];
  let score = 10;

  const required = ['executive_summary', 'project_scope', 'technical_architecture', 'key_decisions', 'risks', 'success_criteria'];
  for (const key of required) {
    const val = psa[key];
    if (!val || (typeof val === 'string' && val.trim().length < 20)) {
      issues.push(`Section '${key}' is missing or too short`);
      score -= 1.5;
    }
  }

  // Tables expected in certain sections
  for (const key of ['key_decisions', 'dependencies', 'risks', 'timeline', 'team_impact']) {
    const val = psa[key];
    if (typeof val === 'string' && val.length > 20 && !val.includes('|')) {
      suggestions.push(`'${key}' should use a table format for clarity`);
    }
  }

  // Vague terms in actionable sections
  const actionable = [psa.technical_architecture, psa.key_decisions, psa.success_criteria, psa.risks].filter(Boolean).join(' ');
  const vague: string[] = [];
  for (const pat of VAGUE_TERMS) {
    const matches = actionable.match(new RegExp(pat, 'gi')) || [];
    for (const m of matches) {
      const idx = actionable.indexOf(m);
      const window = actionable.slice(Math.max(0, idx - 50), idx + m.length + 50);
      if (!METRIC_NEAR.some(mp => mp.test(window)) && !vague.includes(m.toLowerCase())) {
        vague.push(m.toLowerCase());
      }
    }
  }
  if (vague.length) {
    issues.push(`Vague terms without metrics: ${vague.slice(0, 4).join(', ')}`);
    score -= Math.min(vague.length, 3);
  }

  // Constraint compliance
  if (constraints?.length) {
    const allText = Object.values(psa).filter(v => typeof v === 'string').join(' ').toLowerCase();
    for (const c of constraints) {
      const words = c.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      if (!words.some(w => allText.includes(w))) {
        issues.push(`Constraint may not be addressed: '${c}'`);
        score -= 1;
      }
    }
  }

  score = Math.max(1, Math.min(10, Math.round(score)));

  return { score, passed: score >= 7, issues, suggestions, retried: false };
}
