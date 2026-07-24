/**
 * template-chat scaffold — the starting point D-130 assigns to 工作区交互页.
 *
 * An empty shell on purpose: no product data, no backend seam. It exists so the
 * DESIGN.md → HeroUI token bridge can be read in a browser under both themes,
 * and so T30–T36 inherit a working layout rather than a blank file.
 */
import { createFileRoute } from '@tanstack/react-router';
import { Avatar, Button } from '@heroui/react';
import {
  EmptyState,
  PromptInput,
  PromptSuggestion,
  Sidebar,
} from '@/components/heroui-pro';

export const Route = createFileRoute('/heroui-spike/chat')({
  component: ChatScaffold,
});

const RECENT_THREADS = ['本周探店视频脚本', '618 拓客海报', '新客到店话术'];

const SCENARIOS = [
  { title: '拉新', description: '让新客愿意进门的第一条内容' },
  { title: '复购', description: '提醒老客回店的贴心一句' },
  { title: '上新', description: '把新项目讲清楚、讲好看' },
];

function ChatScaffold() {
  return (
    <Sidebar.Provider className="min-h-[calc(100svh-3.25rem)]">
      <Sidebar>
        <Sidebar.Header>
          <div className="flex items-center gap-3 px-1 py-1">
            <Avatar className="size-9">
              <Avatar.Fallback>美</Avatar.Fallback>
            </Avatar>
            <span className="text-foreground text-sm font-medium">门店工作区</span>
          </div>
        </Sidebar.Header>
        <Sidebar.Content>
          <Sidebar.Group>
            <Sidebar.GroupLabel>最近</Sidebar.GroupLabel>
            <Sidebar.Menu>
              {RECENT_THREADS.map((thread, index) => (
                <Sidebar.MenuItem key={thread} isCurrent={index === 0}>
                  <Sidebar.MenuLabel>{thread}</Sidebar.MenuLabel>
                </Sidebar.MenuItem>
              ))}
            </Sidebar.Menu>
          </Sidebar.Group>
        </Sidebar.Content>
        <Sidebar.Rail />
      </Sidebar>

      <Sidebar.Main className="flex flex-col items-center gap-8 px-6 py-12">
        {/* DESIGN.md §3「问候语法则」: Display 层只承载拟人化问候, 一屏最多一处 */}
        <p className="meiye-greeting text-foreground text-center">
          嗨，店主，今天想发点什么？
        </p>

        <div className="w-full max-w-[780px]">
          <PromptInput value="" onValueChange={() => {}}>
            <PromptInput.Shell className="meiye-porcelain">
              <PromptInput.Content>
                <PromptInput.TextArea placeholder="说说想发什么，可以 @ 引用门店素材" />
              </PromptInput.Content>
              <PromptInput.Toolbar>
                <PromptInput.ToolbarStart>
                  {/* 参数 chips 落位在这里 (DESIGN.md §5 Chips) */}
                  <span className="text-muted text-xs">参数</span>
                </PromptInput.ToolbarStart>
                <PromptInput.ToolbarEnd>
                  <PromptInput.Send />
                </PromptInput.ToolbarEnd>
              </PromptInput.Toolbar>
            </PromptInput.Shell>
          </PromptInput>
        </div>

        {/* DESIGN.md §5 Chips: 场景 chips 走玻璃丸, 点击切换 Composer 上下文 */}
        <PromptSuggestion className="w-full max-w-[780px]">
          <PromptSuggestion.Items>
            {SCENARIOS.map((scenario) => (
              <PromptSuggestion.Item key={scenario.title}>
                <PromptSuggestion.ItemTitle>
                  {scenario.title}
                </PromptSuggestion.ItemTitle>
                <PromptSuggestion.ItemDescription>
                  {scenario.description}
                </PromptSuggestion.ItemDescription>
              </PromptSuggestion.Item>
            ))}
          </PromptSuggestion.Items>
        </PromptSuggestion>

        <EmptyState className="w-full max-w-[780px]">
          <EmptyState.Header>
            <EmptyState.Title>还没有成品</EmptyState.Title>
            <EmptyState.Description>
              发一条任务，生成的图文会落在这里。
            </EmptyState.Description>
          </EmptyState.Header>
          <EmptyState.Content>
            <Button variant="secondary">看看能做什么</Button>
          </EmptyState.Content>
        </EmptyState>
      </Sidebar.Main>
    </Sidebar.Provider>
  );
}
