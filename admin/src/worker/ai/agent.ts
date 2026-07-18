// Streaming agentic loop for the admin AI, on the padborginn router.
//
// Each round the model either requests tools (executed in parallel, results
// fed back) or produces the answer. Content deltas are forwarded to the
// client live as SSE events, along with tool activity, so the UI can show
// a real activity timeline. Rounds are capped to keep runaway loops
// impossible.

import { AI_TOOLS, executeTool, type AgentEnv } from './tools';

export type LlmEnv = AgentEnv & {
  SCRIBE_LLM_URL?: string;
  SCRIBE_LLM_KEY?: string;
  AI_AGENT_MODEL?: string;
};

const MODEL_CHAIN = ['ag/claude-sonnet-4-6', 'cx/gpt-5.5', 'ag/gemini-3.5-flash-low'];
const MAX_ROUNDS = 8;

export const SYSTEM_PROMPT = `You are the DeenSubs admin agent: a capable operator for an Islamic content platform (Arabic lectures → English subtitles) running on Cloudflare Workers.

You have ${AI_TOOLS.length} tools covering the database, analytics (D1 + Analytics Engine), R2 storage, cache, moderation, and the Scribe transcription pipeline (you can START transcriptions of YouTube/media URLs and PUBLISH finished jobs as videos).

Ground every claim in tool results — never guess numbers. Chain tools when a question needs it (e.g. content strategy → get_content_gaps + get_zero_result_searches; "transcribe this" → start_transcription then report the job id). Format multi-row data as markdown tables. Be concise, concrete, and proactive with suggestions. Keep Islamic honorifics: Allah ﷻ, the Prophet Muhammad ﷺ.`;

type StreamEvent =
  | { type: 'round'; round: number; model: string }
  | { type: 'tool_start'; round: number; name: string; args: string }
  | { type: 'tool_done'; round: number; name: string; ms: number; ok: boolean }
  | { type: 'token'; text: string }
  | { type: 'done'; model: string; rounds: number; tools_used: string[] }
  | { type: 'error'; message: string };

type ParsedResponse = {
  content: string;
  toolCalls: { id: string; name: string; arguments: string }[];
};

/** Read a chat-completions response (SSE stream or plain JSON), forwarding
 * content deltas via onToken, and assembling any tool calls. */
async function readResponse(res: Response, onToken: (t: string) => void): Promise<ParsedResponse> {
  const ct = res.headers.get('content-type') || '';
  const isSse = ct.includes('event-stream');

  if (!isSse) {
    const text = await res.text();
    if (text.trimStart().startsWith('data:')) return parseSseText(text, onToken);
    const data: any = JSON.parse(text);
    const msg = data.choices?.[0]?.message || {};
    if (msg.content) onToken(msg.content);
    return {
      content: msg.content || '',
      toolCalls: (msg.tool_calls || []).map((tc: any) => ({
        id: tc.id, name: tc.function?.name || '', arguments: tc.function?.arguments || '{}',
      })),
    };
  }

  // Incremental SSE
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  const tools: Record<number, { id: string; name: string; arguments: string }> = {};

  const handleLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const payload = trimmed.slice(5).trim();
    if (payload === '[DONE]') return;
    try {
      const obj = JSON.parse(payload);
      const delta = obj.choices?.[0]?.delta || obj.choices?.[0]?.message || {};
      if (delta.content) {
        content += delta.content;
        onToken(delta.content);
      }
      for (const tc of delta.tool_calls || []) {
        const idx = tc.index ?? 0;
        if (!tools[idx]) tools[idx] = { id: tc.id || `call_${idx}`, name: '', arguments: '' };
        if (tc.id) tools[idx].id = tc.id;
        if (tc.function?.name) tools[idx].name += tc.function.name;
        if (tc.function?.arguments) tools[idx].arguments += tc.function.arguments;
      }
    } catch {}
  };

  while (true) {
    const { done, value } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) handleLine(line);
    }
    if (done) break;
  }
  handleLine(buffer);

  return { content, toolCalls: Object.values(tools).filter((t) => t.name) };
}

function parseSseText(text: string, onToken: (t: string) => void): ParsedResponse {
  let content = '';
  const tools: Record<number, { id: string; name: string; arguments: string }> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (payload === '[DONE]') break;
    try {
      const obj = JSON.parse(payload);
      const delta = obj.choices?.[0]?.delta || obj.choices?.[0]?.message || {};
      if (delta.content) content += delta.content;
      for (const tc of delta.tool_calls || []) {
        const idx = tc.index ?? 0;
        if (!tools[idx]) tools[idx] = { id: tc.id || `call_${idx}`, name: '', arguments: '' };
        if (tc.id) tools[idx].id = tc.id;
        if (tc.function?.name) tools[idx].name += tc.function.name;
        if (tc.function?.arguments) tools[idx].arguments += tc.function.arguments;
      }
    } catch {}
  }
  if (content) onToken(content);
  return { content, toolCalls: Object.values(tools).filter((t) => t.name) };
}

async function callModel(
  env: LlmEnv,
  model: string,
  messages: any[],
  onToken: (t: string) => void
): Promise<ParsedResponse> {
  const base = (env.SCRIBE_LLM_URL || '').replace(/\/$/, '');
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.SCRIBE_LLM_KEY },
    body: JSON.stringify({ model, messages, tools: AI_TOOLS, max_tokens: 2500, stream: true }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${model}: HTTP ${res.status} ${body.slice(0, 160)}`);
  }
  return readResponse(res, onToken);
}

/** Run the agent, emitting SSE events through `emit`. */
export async function runAgent(
  env: LlmEnv,
  prompt: string,
  history: any[],
  emit: (e: StreamEvent) => void
): Promise<void> {
  const chain = env.AI_AGENT_MODEL ? [env.AI_AGENT_MODEL, ...MODEL_CHAIN] : MODEL_CHAIN;
  const messages: any[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...(history || []).slice(-12),
    { role: 'user', content: prompt },
  ];
  const toolsUsed: string[] = [];
  let model = chain[0];

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    emit({ type: 'round', round, model });

    // Try the chain until a model answers this round
    let parsed: ParsedResponse | null = null;
    let lastErr = '';
    for (const m of chain) {
      try {
        parsed = await callModel(env, m, messages, (t) => emit({ type: 'token', text: t }));
        model = m;
        break;
      } catch (err: any) {
        lastErr = err.message;
      }
    }
    if (!parsed) {
      emit({ type: 'error', message: 'All models failed: ' + lastErr });
      return;
    }

    if (!parsed.toolCalls.length) {
      emit({ type: 'done', model, rounds: round, tools_used: toolsUsed });
      return;
    }

    // Execute this round's tools in parallel
    messages.push({
      role: 'assistant',
      content: parsed.content || null,
      tool_calls: parsed.toolCalls.map((tc) => ({
        id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.arguments },
      })),
    });
    await Promise.all(
      parsed.toolCalls.map(async (tc) => {
        emit({ type: 'tool_start', round, name: tc.name, args: tc.arguments.slice(0, 200) });
        const t0 = Date.now();
        let result: any;
        try {
          result = await executeTool(env, tc.name, JSON.parse(tc.arguments || '{}'));
        } catch (err: any) {
          result = { error: err.message };
        }
        toolsUsed.push(tc.name);
        emit({ type: 'tool_done', round, name: tc.name, ms: Date.now() - t0, ok: !result?.error });
        messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result).slice(0, 12000) });
      })
    );
  }
  emit({ type: 'error', message: `Stopped after ${MAX_ROUNDS} tool rounds without a final answer.` });
}
