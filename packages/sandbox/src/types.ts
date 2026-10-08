export type LifecycleState =
  | "resolving"
  | "pulling"
  | "creating"
  | "starting"
  | "onboarding"
  | "validating"
  | "ready"
  | "stopping"
  | "gone"
  | "failed";

export type SandboxMode = "tied" | "background";

/** What was loaded from a configuration directory (data-model §3). */
export interface ConfigSummary {
  source: string;
  files: number;
  excluded: string[];
  skippedLinks: string[];
  secrets: "placeholders" | "caller-file" | "none-referenced";
  placeholderKeys: string[];
  userVirtualIntegration: boolean;
}
