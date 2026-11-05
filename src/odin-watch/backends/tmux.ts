import { CommandCaptureBackend } from "./command-backend.js";

export class TmuxBackend extends CommandCaptureBackend {
  constructor(archiveDir: string) {
    super(archiveDir, {
      command: "tmux",
      args: (pane_id) => ["capture-pane", "-p", "-t", pane_id],
      substrate: "tmux",
    });
  }
}
