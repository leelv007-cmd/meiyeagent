import { apikey, user } from './auth.schema';
import {
  payment,
  userFiles,
  workspaceMemberships,
  workspaces,
} from './app.schema';

export type User = typeof user.$inferSelect;
export type ApiKey = typeof apikey.$inferSelect;
export type UserFiles = typeof userFiles.$inferSelect;
export type Payment = typeof payment.$inferSelect;
export type Workspace = typeof workspaces.$inferSelect;
export type WorkspaceMembership = typeof workspaceMemberships.$inferSelect;
