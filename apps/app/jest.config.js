/**
 * Jest setup for the chat app's first unit tests (issue #23). Scoped to pure
 * `src/**` logic modules (e.g. the outgoing-message lifecycle) compiled with
 * ts-jest — React components and pages are covered by other test types, so this
 * config intentionally stays a lightweight, node-environment TypeScript runner
 * rather than pulling in the Next.js/JSDOM stack.
 *
 * @type {import('jest').Config}
 */
module.exports = {
  testEnvironment: "node",
  rootDir: ".",
  roots: ["<rootDir>/src"],
  moduleFileExtensions: ["ts", "js", "json"],
  testRegex: ".*\\.spec\\.ts$",
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: {
          module: "commonjs",
          moduleResolution: "node",
          esModuleInterop: true
        }
      }
    ]
  }
};
