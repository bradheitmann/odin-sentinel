/**
 * Symlink refusal for files ODIN writes or reads under a workspace-relative state directory
 * (.odin/registry/, .odin/monitor/wake/). A cloned repository can plant a symbolic link there;
 * following it would let a write or read land outside the workspace. Both helpers refuse
 * instead of following.
 */
import { closeSync, constants, lstatSync, openSync, writeSync } from "node:fs";

/** Return the first path in `paths` that is a symbolic link, or null. A missing path is not a link. */
export function findSymlink(paths: readonly string[]): string | null {
  for (const path of paths) {
    try {
      if (lstatSync(path).isSymbolicLink()) return path;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
  }
  return null;
}

/**
 * Write (create or truncate) a file without following a symbolic link at `path`. Uses
 * O_NOFOLLOW where the platform has it, and an lstat refusal in all cases. Throws on a link.
 */
export function writeFileNoFollow(path: string, data: string): void {
  if (findSymlink([path]) !== null) {
    throw new Error(`refusing to write through a symbolic link: ${path}`);
  }
  const noFollow = constants.O_NOFOLLOW ?? 0;
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | noFollow, 0o644);
  try {
    writeSync(fd, data, null, "utf8");
  } finally {
    closeSync(fd);
  }
}
