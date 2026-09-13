import { spawn } from 'node:child_process';

export function openCommand(url, platform = process.platform) {
  // On Windows, explorer.exe and PowerShell's Start-Process didn't reach the browser when tested;
  // url.dll's handler did, with the whole query string (& included).
  if (platform === 'win32') return { command: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] };
  if (platform === 'darwin') return { command: 'open', args: [url] };
  return { command: 'xdg-open', args: [url] };
}

/** Opens a link in the default browser. Best effort: callers should also print the link. */
export function openUrl(url) {
  const { command, args } = openCommand(url);
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  } catch {
    // No browser available (SSH, containers). The printed link still works.
  }
}
