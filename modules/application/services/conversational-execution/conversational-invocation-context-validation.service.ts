import type { ProtectedConversationalInvocationContext } from '../../ports/conversational-execution';

<<<<<<< ours
=======
const BLOCKED_PATTERNS = [/api[_-]?key/i, /private[_-]?key/i, /bearer\s+[a-z0-9\-_\.]+/i, /-----begin/i, /signed url/i, /base64/i, /stack trace/i, /providerpayload/i, /workflow\s*\{/i, /\/home\//i, /[A-Za-z]:\\/i, /\bcurl\b/i];

>>>>>>> theirs
export class ConversationalInvocationContextValidationService {
  public validate(context: ProtectedConversationalInvocationContext) {
    if (!context.conversationSessionId || !context.userTurnContent?.trim()) return { valid: false as const, reason: 'missing-required-context' };
    if (context.userTurnContent.length > 8000) return { valid: false as const, reason: 'user-content-too-long' };
<<<<<<< ours
    if (context.history && context.history.length > 50) return { valid: false as const, reason: 'history-too-large' };
    for (const item of context.history ?? []) {
      if (!item.content?.trim()) return { valid: false as const, reason: 'history-content-invalid' };
      if (item.content.length > 8000) return { valid: false as const, reason: 'history-content-too-long' };
    }
    if (context.systemInstruction && context.systemInstruction.length > 8000) return { valid: false as const, reason: 'system-instruction-too-long' };
    if (context.generation?.temperature !== undefined && (context.generation.temperature < 0 || context.generation.temperature > 2)) return { valid: false as const, reason: 'generation-temperature-out-of-range' };
    if (context.generation?.maxOutputTokens !== undefined && (context.generation.maxOutputTokens < 1 || context.generation.maxOutputTokens > 8000)) return { valid: false as const, reason: 'generation-max-output-tokens-out-of-range' };
=======
    const corpus = [context.userTurnContent, context.systemInstruction ?? '', ...(context.history?.map((h) => h.content) ?? [])].join('\n');
    if (BLOCKED_PATTERNS.some((p) => p.test(corpus))) return { valid: false as const, reason: 'unsafe-protected-context' };
    if (context.history && context.history.length > 50) return { valid: false as const, reason: 'history-too-large' };
>>>>>>> theirs
    return { valid: true as const };
  }
}
