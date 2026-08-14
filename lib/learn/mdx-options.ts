/**
 * Compile options for lesson MDX. Shared by the lesson route and its test, so
 * the test exercises the same pipeline the page uses.
 *
 * `blockJS: false` is the important one. next-mdx-remote v6 added a hardening
 * pass (`removeJavaScriptExpressions`) aimed at MDX from untrusted authors: it
 * strips every JSX *expression* attribute before compiling. Under it,
 * `<Check options={[…]} answer={0} />` reaches the component as `{}` for those
 * props — string attributes survive, expressions vanish, and nothing warns.
 * That took out every interactive component in the curriculum.
 *
 * Our lessons are first-party files in this repo, reviewed like any other
 * source, so the threat model doesn't apply. Turning `blockJS` off leaves
 * `blockDangerousJS` at its default `true`, which still refuses
 * eval/Function/require/constructor/__proto__ and similar.
 */
// Deliberately untyped against next-mdx-remote's `SerializeOptions`: that type
// only lives at `next-mdx-remote/dist/types`, which the package doesn't export
// in its "exports" map. A plain object is structurally assignable anyway.
export const LESSON_MDX_OPTIONS = {
  blockJS: false,
};
