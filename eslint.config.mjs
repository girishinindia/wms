import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  {
    ignores: [".next/**", "out/**", "build/**", "next-env.d.ts"],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    /**
     * Navigation inside /admin is plain `<a>`, on purpose.
     *
     * The reasoning is written out in full above the sidebar link in
     * `components/admin/AdminShell.tsx`: client routing there has failed
     * SILENTLY three times — chunks 404ing after a deploy, an aborted
     * navigation, a wedged router — each time leaving a page that looked
     * fine and a menu that did nothing. A browser navigation cannot fail
     * that way, and the usual cost does not apply because every admin
     * page is `force-dynamic` and was round-tripping anyway.
     *
     * The rule started firing only when a catch-all route was added
     * under /admin, which put every /admin/* path in the manifest and so
     * made all of these "links to a known page". It is reporting the
     * route table rather than a mistake, and following it would undo a
     * considered decision — so it is off for the admin area, and only
     * there. Marketing pages still get the check.
     */
    files: ["src/app/admin/**/*.tsx", "src/components/admin/**/*.tsx"],
    rules: { "@next/next/no-html-link-for-pages": "off" },
  },
];

export default eslintConfig;
