import { Channel, invoke } from "@tauri-apps/api/core";
import type { Backend } from "./types";

export const backend: Backend = {
  openTerminal: (id, path) => invoke("open_terminal", { id, path }),
  openEditor: (id, path) => invoke("open_editor", { id, path }),
  remoteTarget: remote => invoke("remote_target", { remote }),
  openRemote: url => invoke("open_remote", { url }),
  watch: async (id, onChange) => {
    const token = crypto.randomUUID();
    await invoke("watch_workspace", { id, token, onChange: new Channel(onChange) });
    return () => { void invoke("stop_watch", { token }).catch(() => {}); };
  },
  recoverSettings: () => invoke("recover_settings"),
  cancelScan: id => invoke("cancel_scan", { id }),
  gitFeatures: (id, repository) => invoke("git_features", { id, repository }),
  gitConfig: (id, repository) => invoke("git_config", { id, repository }),
  ignoreRule: (id, repository, path) => invoke("ignore_rule", { id, repository, path }),
  settings: () => invoke("get_settings"),
  addWorkspace: () => invoke("add_workspace"),
  removeWorkspace: (id) => invoke("remove_workspace", { id }),
  saveSettings: (settings) => invoke("save_settings", { settings }),
  scan: (id, onProgress) => invoke("scan_workspace", { id, onProgress: new Channel(onProgress) }),
  preview: (id, path) => invoke("preview_file", { id, path }),
  diff: (id, repository, path, staged) =>
    invoke("file_diff", { id, repository, path, staged }),
  exportReport: (id, format) => invoke("export_report", { id, format }),
};
