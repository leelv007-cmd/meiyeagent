import type { AgentPrimitiveInputById } from '@meiye/contracts';

import type { AgentPrimitiveServerContext } from './runtime.js';

export interface MerchantQuestionRequestPort {
  request(input: {
    question: string;
    options?: AgentPrimitiveInputById['ask_merchant']['options'];
    serverContext: AgentPrimitiveServerContext;
  }): Promise<{ requestRef: string }>;
}

export interface AskMerchantRequestedResult {
  requestRef: string;
  status: 'requested';
}

export class AskMerchantPrimitiveHandler {
  constructor(private readonly requestPort: MerchantQuestionRequestPort) {}

  async execute(args: {
    input: AgentPrimitiveInputById['ask_merchant'];
    serverContext: AgentPrimitiveServerContext;
  }): Promise<AskMerchantRequestedResult> {
    const request = await this.requestPort.request({
      question: args.input.question,
      ...(args.input.options
        ? {
            options: args.input.options.map((option) => ({ ...option })),
          }
        : {}),
      serverContext: args.serverContext,
    });
    if (request.requestRef.trim().length === 0) {
      throw new Error('Merchant question request returned no request reference.');
    }
    return {
      requestRef: request.requestRef.trim(),
      status: 'requested',
    };
  }
}
