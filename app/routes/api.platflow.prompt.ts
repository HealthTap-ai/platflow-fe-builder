import { json, type ActionFunction } from '@remix-run/cloudflare';

interface PromptRequest {
  prompt: string;
  template?: string;
  apiKey?: string;
}

export const action: ActionFunction = async ({ request }) => {
  // Only allow POST requests
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    // Parse the request body
    const body = (await request.json()) as PromptRequest;

    // Validate the required fields
    if (!body.prompt) {
      return json({ error: 'Prompt is required' }, { status: 400 });
    }

    /*
     * Validate API key if authentication is enabled
     * You would need to set up API_KEY in your environment variables
     */
    const apiKey = request.headers.get('x-api-key') || body.apiKey;
    const expectedApiKey = process.env.API_KEY;

    if (expectedApiKey && expectedApiKey !== apiKey) {
      return json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Generate a unique ID for this prompt session
    const sessionId = crypto.randomUUID();

    /*
     * Store the prompt in a format that can be retrieved later
     * This could be done with cookies, server-side storage, or other methods
     */
    const promptData = {
      id: sessionId,
      prompt: body.prompt,
      template: body.template || null,
      timestamp: new Date().toISOString(),
    };

    console.log('promptData', promptData);

    /*
     * Here you would store this data somewhere it can be retrieved
     * For simplicity, we'll return a URL with a query parameter
     */

    // Return the URL to redirect to, which will include the prompt
    return json({
      success: true,
      sessionId,
      redirectUrl: `/new?prompt=${encodeURIComponent(body.prompt)}&sid=${sessionId}${
        body.template ? `&template=${encodeURIComponent(body.template)}` : ''
      }`,
    });
  } catch (error) {
    console.error('Error processing prompt request:', error);
    return json({ error: 'Invalid request body' }, { status: 400 });
  }
};
