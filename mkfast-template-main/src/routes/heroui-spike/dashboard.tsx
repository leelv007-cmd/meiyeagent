/**
 * template-dashboard scaffold — the starting point D-130 assigns to 运营后台.
 *
 * An empty shell on purpose: no product data, no backend seam. 运营后台 is
 * internal-facing, so it is visually separated from the merchant-facing 前台
 * (dev spec §56) while still drawing every colour from DESIGN.md.
 */
import { createFileRoute } from '@tanstack/react-router';
import {
  ItemCard,
  ItemCardGroup,
  ListView,
  Segment,
  Sidebar,
  Widget,
} from '@/components/heroui-pro';

export const Route = createFileRoute('/heroui-spike/dashboard')({
  component: DashboardScaffold,
});

const NAV = ['概览', '用量', '任务', '租户'];

const RANGES = ['近 7 天', '近 30 天', '本季度'];

const SUMMARY = [
  { title: '任务吞吐', description: '排队与完成的编排任务' },
  { title: '模型用量', description: '按供给档位聚合的调用量' },
  { title: '租户活跃', description: '有内容产出的门店数' },
];

const QUEUE = [
  { title: '内容生成', description: '排队中' },
  { title: '素材归档', description: '运行中' },
  { title: '发布回执', description: '已完成' },
];

function DashboardScaffold() {
  return (
    <Sidebar.Provider className="min-h-[calc(100svh-3.25rem)]">
      <Sidebar>
        <Sidebar.Header>
          <span className="text-foreground px-1 py-1 text-sm font-medium">
            运营后台
          </span>
        </Sidebar.Header>
        <Sidebar.Content>
          <Sidebar.Group>
            <Sidebar.GroupLabel>监控</Sidebar.GroupLabel>
            <Sidebar.Menu>
              {NAV.map((item, index) => (
                <Sidebar.MenuItem key={item} isCurrent={index === 0}>
                  <Sidebar.MenuLabel>{item}</Sidebar.MenuLabel>
                </Sidebar.MenuItem>
              ))}
            </Sidebar.Menu>
          </Sidebar.Group>
        </Sidebar.Content>
        <Sidebar.Rail />
      </Sidebar>

      <Sidebar.Main className="flex flex-col gap-6 px-6 py-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-foreground text-2xl font-semibold">概览</h1>
          <Segment aria-label="时间范围" defaultSelectedKey={RANGES[0]}>
            {RANGES.map((range) => (
              <Segment.Item key={range} id={range}>
                {range}
              </Segment.Item>
            ))}
          </Segment>
        </div>

        <ItemCardGroup>
          {SUMMARY.map((item) => (
            <ItemCard key={item.title}>
              <ItemCard.Content>
                <ItemCard.Title>{item.title}</ItemCard.Title>
                <ItemCard.Description>{item.description}</ItemCard.Description>
              </ItemCard.Content>
            </ItemCard>
          ))}
        </ItemCardGroup>

        <Widget>
          <Widget.Header>
            <Widget.Title>任务队列</Widget.Title>
            {/*
              A TrendChip stood here until U04 retired the unit: the product has
              no 「和上一次比」projection to point its arrow at. The scaffold does
              not get to keep a component the product does not ship.
            */}
          </Widget.Header>
          <Widget.Content>
            <ListView aria-label="任务队列">
              {QUEUE.map((task) => (
                <ListView.Item key={task.title} id={task.title}>
                  <ListView.ItemContent>
                    <ListView.Title>{task.title}</ListView.Title>
                    <ListView.Description>
                      {task.description}
                    </ListView.Description>
                  </ListView.ItemContent>
                </ListView.Item>
              ))}
            </ListView>
          </Widget.Content>
        </Widget>
      </Sidebar.Main>
    </Sidebar.Provider>
  );
}
