/**
 * @fileoverview `process` stand-in for the browser bundle.
 *
 * Bundled libraries read `process.env.NODE_ENV` to pick a build, and the
 * decompiler asks for a working directory it never finds a file in.
 */
export const process = {
  env: { NODE_ENV: 'production' } as Record<string, string | undefined>,
  platform: 'browser',
  argv: [] as string[],
  version: '',
  cwd: () => '/',
  nextTick: (callback: () => void) => queueMicrotask(callback),
};

export default process;
