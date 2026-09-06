import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { hostname } from 'node:os';
import { parseProcessSamples, parseProcessTerminalDevices } from './model';

export function executeProcess(file: string, args: string[], signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, {
      maxBuffer: 4 * 1024 * 1024, timeout: 4_000, signal,
      env: { ...process.env, LC_ALL: 'C' },
    }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

export async function readProcessIdentity(processId: number, signal: AbortSignal): Promise<string> {
  if (!Number.isSafeInteger(processId) || processId <= 0) throw new Error('Invalid process ID');
  const started = process.platform === 'win32'
    ? await executeProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${processId}').CreationDate.ToUniversalTime().ToString('o')`], signal)
    : await executeProcess('ps', ['-p', String(processId), '-o', 'lstart='], signal);
  if (!started.trim()) throw new Error('Process no longer exists');
  return `${hostname()}:${processId}:${started.trim()}`;
}

export async function readProcessSamples(signal: AbortSignal) {
  const windows = process.platform === 'win32';
  const output = windows
    ? await executeProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) $($_.KernelModeTime + $_.UserModeTime)" }'], signal)
    : await executeProcess('ps', ['-axo', 'pid=,ppid=,time='], signal);
  return parseProcessSamples(output, windows);
}

export async function readTerminalDeviceMtimes(rootProcessIds: number[], signal: AbortSignal): Promise<Map<number, number>> {
  if (process.platform === 'win32' || rootProcessIds.length === 0) return new Map();
  const output = await executeProcess('ps', ['-p', rootProcessIds.join(','), '-o', 'pid=,tty='], signal);
  const devices = parseProcessTerminalDevices(output);
  const mtimes = new Map<number, number>();
  await Promise.all([...devices].map(async ([processId, device]) => {
    try {
      const details = await stat(`/dev/${device}`);
      if (!signal.aborted) mtimes.set(processId, details.mtimeMs);
    } catch { /* A terminal may close between listing and stat. */ }
  }));
  return mtimes;
}
