const config = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [
      2,
      "always",
      [
        "feat",
        "fix",
        "docs",
        "style",
        "refactor",
        "perf",
        "test",
        "build",
        "ci",
        "chore",
        "revert",
      ],
    ],
    "scope-empty": [2, "never"],
    "scope-delimiter-style": [2, "always", [","]],
    "scope-enum": [
      2,
      "always",
      {
        delimiters: [","],
        scopes: [
          "web",
          "api",
          "db",
          "auth",
          "billing",
          "agent",
          "computer",
          "docker",
          "ci",
          "docs",
          "deps",
          "config",
        ],
      },
    ],
    "subject-empty": [2, "never"],
    "subject-full-stop": [2, "never", "."],
    "subject-case": [2, "never", ["start-case", "pascal-case", "upper-case"]],
    "header-max-length": [2, "always", 72],
    "body-leading-blank": [2, "always"],
    "body-empty": [2, "never"],
    "body-min-length": [2, "always", 20],
  },
};

export default config;
