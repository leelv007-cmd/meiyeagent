import type {
  ComposerConversationDeletedFact,
  ComposerConversationDeletionNotificationPort,
} from './types.js';
import type { ReuseMemoryService } from './reuse-memory-service.js';

export class ReuseMemoryComposerConversationDeletionNotifier
  implements ComposerConversationDeletionNotificationPort
{
  constructor(private readonly memory: ReuseMemoryService) {}

  async notify(fact: ComposerConversationDeletedFact) {
    await this.memory.deleteMemorySourceConversation(
      { workspaceId: fact.workspaceId },
      fact.conversationId
    );
  }
}
