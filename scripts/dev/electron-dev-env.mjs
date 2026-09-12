import path from "node:path";

export function electronDevEnvironment({ state, port, brand, env = process.env }) {
  const daemonHome = path.join(state, "daemon");
  return {
    ...env,
    FDE_HOME: daemonHome,
    PASEO_HOME: daemonHome,
    [`${brand.envPrefix}_HOME`]: daemonHome,
    [`${brand.envPrefix}_LISTEN`]: "0.0.0.0:0",
    FDE_ELECTRON_USER_DATA_DIR: path.join(state, "profile"),
    PASEO_DESKTOP_DEV_URL: `http://127.0.0.1:${port}`,
    PASEO_LISTEN: "0.0.0.0:0",
  };
}
