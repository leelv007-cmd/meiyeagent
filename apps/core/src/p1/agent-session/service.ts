/**
 * Agent Session Harness service façade (V31-06).
 *
 * Thin assembly over store + turn runner + sole checkpoint writer.
 * Intent/retrieval/levels mount in V31-07/08 without rewriting this core.
 */

import type { AgentControlLimits, HarnessMiddlewareBinding } from '@meiye/contracts';

import type { AgentSessionStore } from './agent-session-store.js';
import type { AgentKernel, AgentKernelToolDefinition } from './agent-kernel.js';
import {
  ThreadCheckpointWriter,
  assertSoleCheckpointWriter,
  registerSoleCheckpointWriter,
  type CompactionSections,
  type RetainedTailMessage,
} from './compaction.js';
import type { ModelContextSource } from './context-projection.js';
import type { RegisteredPolicy } from './policy-middleware.js';
import type { AgentToolRegistry } from './tool-registry.js';
import {
  parseAgentTurnInput,
  type AgentTurnInput,
} from './turn-contracts.js';
import {
  AgentTurnRunner,
  type AgentTurnRunnerResult,
  type ReleaseControlLimitsSource,
} from './turn-runner.js';

export type AgentSessionHarnessServiceOptions = {
  store: AgentSessionStore;
  kernel: AgentKernel;
  resolveRelease: (harnessReleaseId: string) => Promise<ReleaseControlLimitsSource>;
  tools?: Record<string, AgentKernelToolDefinition>;
  /** V31-07 server-owned retrieval + governed tool registry (static). */
  toolRegistry?: AgentToolRegistry;
  /**
   * Per-turn registry factory (workspace isolation + creationMode).
   * Preferred in production assembly over a static toolRegistry.
   */
  createToolRegistry?: (input: AgentTurnInput) => AgentToolRegistry;
  /**
   * Factory so each turn can close over fresh knownFields / call counters.
   * When omitted, `policies` static list is used.
   */
  createPolicies?: (input: AgentTurnInput) => readonly RegisteredPolicy[];
  policies?: readonly RegisteredPolicy[];
  contextSource?:
    | ModelContextSource
    | ((input: AgentTurnInput) => ModelContextSource);
  creationMode?: 'customized' | 'free';
  /** Optional resolver when creationMode is turn-dependent. */
  resolveCreationMode?: (
    input: AgentTurnInput,
  ) => 'customized' | 'free' | undefined;
  /** Register this process's sole Thread checkpoint writer (default true). */
  registerCheckpointWriter?: boolean;
};

export class AgentSessionHarnessService {
  readonly checkpointWriter: ThreadCheckpointWriter;
  private readonly options: AgentSessionHarnessServiceOptions;

  constructor(options: AgentSessionHarnessServiceOptions) {
    this.options = options;
    this.checkpointWriter = new ThreadCheckpointWriter(options.store);
    assertSoleCheckpointWriter(this.checkpointWriter);
    if (options.registerCheckpointWriter !== false) {
      registerSoleCheckpointWriter(this.checkpointWriter);
    }
  }

  createTurnRunner(input: {
    resourceId: string;
    readOnly?: boolean;
    turn?: AgentTurnInput;
  }): AgentTurnRunner {
    const policies =
      input.turn && this.options.createPolicies
        ? this.options.createPolicies(input.turn)
        : this.options.policies;
    const toolRegistry =
      input.turn && this.options.createToolRegistry
        ? this.options.createToolRegistry(input.turn)
        : this.options.toolRegistry;
    const creationMode =
      (input.turn && this.options.resolveCreationMode?.(input.turn)) ??
      this.options.creationMode;
    return new AgentTurnRunner({
      kernel: this.options.kernel,
      resolveRelease: this.options.resolveRelease,
      tools: this.options.tools,
      toolRegistry,
      policies,
      contextSource: this.options.contextSource,
      checkpointWriter: this.checkpointWriter,
      resourceId: input.resourceId,
      readOnly: input.readOnly,
      creationMode,
    });
  }

  async runTurn(input: {
    resourceId: string;
    turn: unknown;
    readOnly?: boolean;
  }): Promise<AgentTurnRunnerResult> {
    // Per-turn factories need a parsed turn before constructing the runner.
    if (this.options.createPolicies || this.options.createToolRegistry) {
      const turn = parseAgentTurnInput(input.turn);
      const runner = this.createTurnRunner({
        resourceId: input.resourceId,
        readOnly: input.readOnly,
        turn,
      });
      return runner.run(turn);
    }
    const runner = this.createTurnRunner({
      resourceId: input.resourceId,
      readOnly: input.readOnly,
    });
    return runner.run(input.turn);
  }

  async compact(input: {
    resourceId: string;
    threadId: string;
    sections: CompactionSections;
    retainedTail: RetainedTailMessage[];
    now: string;
    previousSummary?: string | null;
  }) {
    return this.checkpointWriter.write(input);
  }
}

export type { AgentControlLimits, HarnessMiddlewareBinding };
