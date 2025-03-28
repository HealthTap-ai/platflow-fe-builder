import { json } from '@remix-run/cloudflare';
import { ClientOnly } from 'remix-utils/client-only';
import { BuilderChat } from '~/components/chat/PlatflowChat.client';

/*
 * Add a loader function that returns an empty object
 * This is needed for the useChatHistory hook
 */
export const loader = () => json({});

export default function BuilderChatRoute() {
  return (
    <div className="pb-[120px] h-screen flex">
      <ClientOnly fallback={<div>Loading BuilderChat...</div>}>{() => <BuilderChat />}</ClientOnly>
    </div>
  );
}
