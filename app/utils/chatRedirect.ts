import { redirect } from '@remix-run/cloudflare';

/**
 * Utility to redirect to a chat with an initial prompt
 */
export function redirectToChatWithPrompt(prompt: string, sessionId: string, template?: string) {
  const searchParams = new URLSearchParams();
  searchParams.set('prompt', prompt);
  searchParams.set('sid', sessionId);

  if (template) {
    searchParams.set('template', template);
  }

  return redirect(`/new?${searchParams.toString()}`);
}
