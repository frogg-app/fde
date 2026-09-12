export interface NodeEntrypointSpec {
  entryPath: string;
  execArgv: string[];
}

export interface NodeEntrypointInvocation {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

export type NodeEntrypointArgvMode = "bare" | "node-script";
