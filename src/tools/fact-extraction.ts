/**
 * Oracle Fact Extraction Handler
 *
 * Extract structured facts from retrospectives, diaries, and handoffs.
 * Inspired by mem0's fact extraction with Oracle-specific categories.
 *
 * Categories:
 * - principles: Core patterns discovered
 * - anti_patterns: What NOT to do
 * - fixes: How problems were solved
 * - preferences: User preferences (tools, workflows)
 * - projects: What projects were worked on
 * - decisions: Architectural/design decisions
 * - insights: Unique observations
 */

import type { ToolContext, ToolResponse } from './types.ts';
import { handleLearn } from './learn.ts';
import { createLLMClient, extractJSON } from '../llm/client.ts';

type FactCategory =
  | 'principles'
  | 'anti_patterns'
  | 'fixes'
  | 'preferences'
  | 'projects'
  | 'decisions'
  | 'insights';

interface ExtractedFact {
  category: FactCategory;
  content: string;
  confidence: number;
  tags?: string[];
}

interface FactExtractionResult {
  facts: ExtractedFact[];
  summary: string;
  total_facts: number;
  by_category: Record<FactCategory, number>;
}

export const factExtractionToolDef = {
  name: 'arra_extract_facts',
  description: 'Extract structured facts from Oracle session content (retrospectives, diaries, handoffs). Automatically stores extracted facts as learnings.',
  inputSchema: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'Session content to extract facts from'
      },
      categories: {
        type: 'array',
        items: { type: 'string' },
        description: 'Categories to extract (default: all categories)',
        default: ['principles', 'anti_patterns', 'fixes', 'preferences', 'projects', 'decisions', 'insights']
      },
      auto_learn: {
        type: 'boolean',
        description: 'Automatically store extracted facts as learnings (default: true)',
        default: true
      },
      language: {
        type: 'string',
        enum: ['auto', 'en', 'th'],
        description: 'Language detection (default: auto-detect)',
        default: 'auto'
      },
      session_type: {
        type: 'string',
        enum: ['retrospective', 'diary', 'handoff'],
        description: 'Type of session content',
        default: 'retrospective'
      }
    },
    required: ['content']
  }
};

// ============================================================================
// Oracle Fact Extraction Prompt
// ============================================================================

const ORACLE_FACT_EXTRACTION_PROMPT = `
You are an Oracle Knowledge Extractor, specialized in identifying and organizing patterns, principles, and insights from Oracle sessions.

Extract facts from the {session_type} into these categories:

1. **principles**: Core patterns discovered, universal rules, "truths" about the system
2. **anti_patterns**: What NOT to do, mistakes to avoid, warning signs
3. **fixes**: How specific problems were solved, bug fixes, workarounds
4. **preferences**: User preferences (tools, workflows, communication style)
5. **projects**: What projects, repos, or features were worked on
6. **decisions**: Architectural decisions, design choices, technical decisions
7. **insights**: Unique observations, "aha moments", meta-learnings

Guidelines:
- Extract ONLY the {categories} categories specified
- Each fact should be concise but complete (1-2 sentences)
- Assign confidence score (0.5-1.0) based on how clearly stated the fact is
- Detect language from input and output facts in the same language
- Include relevant tags for cross-referencing

Output JSON format:
{
  "facts": [
    {
      "category": "principles",
      "content": "Nothing is Deleted — history is wealth",
      "confidence": 0.95,
      "tags": ["oracle-framework", "git"]
    },
    {
      "category": "fixes",
      "content": "Fixed ChromaDB embedding by using addDocuments instead of direct insert",
      "confidence": 0.9,
      "tags": ["chroma", "vector-search", "bugfix"]
    }
  ],
  "summary": "Brief 1-2 sentence summary of what was learned",
  "by_category": {
    "principles": 2,
    "fixes": 1,
    ...
  }
}

Session content:
{content}
`;

// ============================================================================
// Handler
// ============================================================================

export async function handleFactExtraction(
  ctx: ToolContext,
  input: {
    content: string;
    categories?: string[];
    auto_learn?: boolean;
    language?: string;
    session_type?: string;
  }
): Promise<ToolResponse> {
  const {
    content,
    categories = ['principles', 'anti_patterns', 'fixes', 'preferences', 'projects', 'decisions', 'insights'],
    auto_learn = true,
    language = 'auto',
    session_type = 'retrospective'
  } = input;

  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];

  // Build the prompt with actual categories
  const categoryList = categories.join(', ');
  const prompt = ORACLE_FACT_EXTRACTION_PROMPT
    .replace(/{session_type}/g, session_type)
    .replace(/{categories}/g, categoryList)
    .replace(/{content}/g, content);

  // Call LLM for fact extraction
  let llmResponse: string;
  try {
    // Use available LLM (Claude via MCP or direct API)
    // For now, we'll use a simple approach — can be enhanced with proper LLM integration
    const result = await extractFactsWithLLM(ctx, prompt);
    llmResponse = result;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[FactExtraction] LLM call failed:', errorMsg);
    throw new Error(`Failed to extract facts: ${errorMsg}`);
  }

  // Parse JSON response
  let extractionResult: FactExtractionResult;
  try {
    // Extract JSON from markdown code block if present
    const jsonMatch = llmResponse.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/) ||
                     llmResponse.match(/(\{[\s\S]*\})/);
    if (!jsonMatch) {
      throw new Error('No JSON found in LLM response');
    }
    extractionResult = JSON.parse(jsonMatch[1]);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[FactExtraction] Failed to parse JSON:', errorMsg);
    console.error('[FactExtraction] LLM Response:', llmResponse);
    throw new Error(`Failed to parse extraction result: ${errorMsg}`);
  }

  // Validate result structure
  if (!extractionResult.facts || !Array.isArray(extractionResult.facts)) {
    throw new Error('Invalid extraction result: missing facts array');
  }

  // Auto-store facts as learnings
  const storedFacts: Array<{ id: string; category: string; content: string }> = [];
  if (auto_learn) {
    for (const fact of extractionResult.facts) {
      try {
        // Build concepts from category + tags
        const concepts = [
          fact.category,
          ...(fact.tags || []),
          session_type,
          'fact-extraction'
        ];

        const learnResult = await handleLearn(ctx, {
          pattern: fact.content,
          source: `arra_extract_facts (${session_type})`,
          concepts,
        });

        const parsedResult = JSON.parse(learnResult.content[0].text);
        if (parsedResult.success) {
          storedFacts.push({
            id: parsedResult.id,
            category: fact.category,
            content: fact.content
          });
        }
      } catch (error) {
        // Non-fatal: log but continue with other facts
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`[FactExtraction] Failed to store fact: ${errorMsg}`);
      }
    }
  }

  const response = {
    success: true,
    session_type,
    extraction: {
      summary: extractionResult.summary,
      total_facts: extractionResult.total_facts || extractionResult.facts.length,
      by_category: extractionResult.by_category || {},
      facts: extractionResult.facts.map((f: ExtractedFact) => ({
        category: f.category,
        content: f.content,
        confidence: f.confidence,
        tags: f.tags || []
      }))
    },
    auto_learn,
    stored_facts: storedFacts.length,
    fact_ids: storedFacts.map(f => f.id),
    timestamp: now.toISOString()
  };

  console.error(`[FactExtraction] Extracted ${extractionResult.facts.length} facts, stored ${storedFacts.length} as learnings`);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(response, null, 2)
    }]
  };
}

// ============================================================================
// LLM Integration
// ============================================================================

/**
 * Call LLM for fact extraction.
 * Uses Anthropic Claude or Ollama based on environment.
 */
async function extractFactsWithLLM(ctx: ToolContext, prompt: string): Promise<string> {
  const llm = createLLMClient();

  try {
    const response = await llm.complete(prompt, {
      maxTokens: 4096,
      temperature: 0.3,
    });
    return response;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[LLM] Failed to complete:', errorMsg);
    throw error;
  }
}

// ============================================================================
// Export tool definition
// ============================================================================

export const factExtractionTool = {
  definition: factExtractionToolDef,
  handler: handleFactExtraction
};
