// Single-process test entry.
// `node --test` spawns one child process per file, which some sandboxes block;
// importing the suites keeps everything in one process and still reports TAP.

import './parsers.test.mjs';
import './extract.test.mjs';
import './server.test.mjs';