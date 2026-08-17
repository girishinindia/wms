import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

/**
 * Zod, with `.openapi()` attached.
 *
 * `extendZodWithOpenApi` patches the Zod prototype, so it has to run
 * BEFORE any module that calls `.openapi()` is evaluated. Calling it at
 * the top of document.ts is not early enough: the schema modules
 * document.ts imports are evaluated first, and `.openapi` is not a
 * function yet when their bodies run.
 *
 * Importing `z` from here instead makes the ordering a dependency rather
 * than a convention nobody can see. The extension is idempotent.
 */
extendZodWithOpenApi(z);

export { z };
