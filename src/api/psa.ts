/**
 * PSA generation API routes.
 */
import { Router, type Request, type Response } from 'express';
import { ragPipeline, COLLECTION_PSAS } from '../rag/index.js';
import { createPSA, listPSAs, getPSA } from '../db/store.js';
import { listTemplates, getTemplate } from '../templates/index.js';
import OpenAI from 'openai';

export const psaRouter = Router();

const AI_MODEL = process.env.AI_MODEL || 'gpt-4o-mini';

function getOpenAIClient(): OpenAI {
  return new OpenAI({
    apiKey: process.env.AI_API_KEY || '',
    baseURL: process.env.AI_BASE_URL || undefined,
  });
}

// POST /api/psa/generate — RAG-augmented PSA generation
psaRouter.post('/psa/generate', async (req: Request, res: Response) => {
  try {
    const { title, templateId, description, requirements } = req.body;
    if (!title) {
      res.status(400).json({ error: 'title required' });
      return;
    }

    const apiKey = process.env.AI_API_KEY;
    if (!apiKey) {
      res.status(503).json({ error: 'AI_API_KEY not configured' });
      return;
    }

    // 1. Get template
    const template = templateId ? getTemplate(templateId) : null;
    const templateName = template?.name || 'General PSA';

    // 2. Retrieve RAG context
    const ragContext = await ragPipeline.generateContext(
      `${title} ${description || ''}`,
      5
    );

    // 3. Build prompt
    const prompt = buildPrompt(title, description, requirements, templateName, ragContext);

    // 4. Call LLM
    const client = getOpenAIClient();
    const response = await client.chat.completions.create({
      model: AI_MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are an expert project architect who creates detailed Project Start Architecture (PSA) documents. Generate comprehensive, well-structured PSA documents.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 3000,
    });

    const content = response.choices[0]?.message?.content || '';

    // 5. Store in SQLite
    const psa = createPSA(title, templateId || 'general', content, ragContext || undefined, AI_MODEL);

    // 6. Index in ChromaDB
    try {
      await ragPipeline.addDocument(
        { id: psa!.id as string, content: `${title}\n${content}`, metadata: { title, templateId: templateId || 'general' } },
        COLLECTION_PSAS
      );
    } catch { /* non-blocking */ }

    res.status(201).json({
      ok: true,
      psa,
      ragContextUsed: !!ragContext,
      model: AI_MODEL,
    });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// GET /api/psa — list PSAs
psaRouter.get('/psa', (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string || '20', 10);
  const offset = parseInt(req.query.offset as string || '0', 10);
  const { items, total } = listPSAs(limit, offset);
  res.json({ psas: items, total });
});

// GET /api/psa/:id — get single PSA
psaRouter.get('/psa/:id', (req: Request, res: Response) => {
  const psa = getPSA(req.params.id);
  if (!psa) {
    res.status(404).json({ error: 'PSA not found' });
    return;
  }
  res.json(psa);
});

function buildPrompt(
  title: string,
  description?: string,
  requirements?: string[],
  templateName?: string,
  ragContext?: string
): string {
  let prompt = `Generate a Project Start Architecture (PSA) document.\n\n`;
  prompt += `## Project Title\n${title}\n\n`;

  if (description) {
    prompt += `## Description\n${description}\n\n`;
  }

  if (requirements?.length) {
    prompt += `## Requirements\n${requirements.map(r => `- ${r}`).join('\n')}\n\n`;
  }

  if (templateName) {
    prompt += `## Template Type\n${templateName}\n\n`;
  }

  if (ragContext) {
    prompt += `## Relevant Context from Existing Documents\n${ragContext}\n\n`;
    prompt += `Use the above context to inform your PSA. Ensure consistency with existing project decisions.\n\n`;
  }

  prompt += `## Output Format\nGenerate a comprehensive PSA document in Markdown format with sections for:\n`;
  prompt += `1. Executive Summary\n2. Project Scope\n3. Technical Architecture\n4. Key Decisions\n`;
  prompt += `5. Dependencies & Risks\n6. Timeline & Milestones\n7. Success Criteria\n`;

  return prompt;
}
