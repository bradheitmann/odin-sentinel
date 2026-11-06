import { CommandCaptureBackend } from "./command-backend.js";

export class CmuxBackend extends CommandCaptureBackend {
  constructor(archiveDir: string) {
    super(archiveDir, {
      command: "cmux",
      args: (pane_id) => ["read-screen", "--surface", pane_id],
      substrate: "cmux",
    });
  }
}
