import { hashDaemonPassword } from "./auth.js";
import { loadPersistedConfig, savePersistedConfig } from "./persisted-config.js";

const MAX_PASSWORD_LENGTH = 1024;

export function saveDaemonPassword(paseoHome: string, password: string): void {
  if (process.env.PASEO_PASSWORD?.trim()) {
    throw new Error("Daemon password is controlled by PASEO_PASSWORD.");
  }
  if (password.length === 0) {
    throw new Error("Password cannot be empty");
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new Error("Password is too long");
  }

  const persisted = loadPersistedConfig(paseoHome);
  savePersistedConfig(paseoHome, {
    ...persisted,
    daemon: {
      ...persisted.daemon,
      auth: {
        ...persisted.daemon?.auth,
        password: hashDaemonPassword(password),
      },
    },
  });
}
