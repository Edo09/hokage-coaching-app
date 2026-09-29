// Loaded with `node --import` by `npm test`: installs the resolver in
// ./test-resolve.mjs before any test file is imported.
import { registerHooks } from "node:module";

import { resolve } from "./test-resolve.mjs";

registerHooks({ resolve });
