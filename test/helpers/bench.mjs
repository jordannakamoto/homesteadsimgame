// Wall-clock budget asserts only run with BENCH=1 (BENCH=1 node --test test/<name>.test.mjs); otherwise they are skipped
// so a loaded or shared machine never fails a functional run. Functional asserts always run.
export const BENCH = !!process.env.BENCH;
export const benchOnly = BENCH ? {} : { skip: 'wall-clock budget: run with BENCH=1' };
