/**
 * 作品面 (T32 / #226) — single import surface for the reshelled works pages.
 * Routes import from here; nothing else reaches into the module's files.
 */
export { WorksDetailPage } from './works-detail-page';
export { WorksLightEditPage } from './works-light-edit-page';
export { WorksListPage } from './works-list-page';
export {
  workDetail,
  worksListItems,
  worksShapeCounts,
  WORK_OUTPUT_SHAPE_LABELS,
  type WorkListItem,
  type WorkOutputShape,
} from './works-projection';
