# Agent Code Guidelines & Standards

This document establishes the mandatory rules and guidelines for AI agents and developers working on this codebase. All code modifications, refactors, and additions must adhere to these standards.

---

## Core Goals

1. **Structured & Organized**: Maintain high cohesion, low coupling, and a clean, predictable project structure.
2. **Well-Formatted & Clean**: Ensure consistent code style, zero dead code, strict linting, and full type safety.
3. **No Code Comments**: Keep source files completely free of inline comments, annotations, and JSDoc. Code logic must be entirely self-documenting.
4. **Test-Driven Development (TDD)**: Follow the Red-Green-Refactor workflow by writing failing tests prior to implementation.

---

## Code Rules & Best Practices

### 1. Minimalist Dependencies
- **Prioritize Built-in APIs**: Use native browser, Node.js, standard web APIs, or core language features whenever possible.
- **Avoid Third-Party Packages**: Do not introduce new external libraries or dependencies unless explicitly requested or strictly necessary.
- **Reuse Existing Stack**: Rely strictly on the dependencies already declared in `package.json` or `Cargo.toml`.

### 2. No Code Annotations & No Comments
- **Zero Comments**: Do not include any comments (`//`, `/* */`, `///`), JSDoc (`/** */`), or code annotations in any source file (`.ts`, `.tsx`, `.rs`, `.css`, etc.).
- **Self-Documenting Code**: Express intent cleanly using descriptive variable names, meaningful function names, explicit types, and intuitive code structure.
- **No Commented-Out Code**: Never keep dead or commented-out code blocks in source files. Delete obsolete code immediately and rely on Git history.
- **Cleanup Existing Comments**: When editing an existing file, remove any legacy comments or annotations encountered within that file.

### 3. Structured & Organized Codebase
- **Consistent File Layout**: Order file contents consistently:
  1. Imports (grouped: standard/framework modules, third-party libraries, local modules, types)
  2. Type & Interface definitions
  3. Constants
  4. Helper / Utility functions (non-component)
  5. Main Component / Module definition
  6. Exports
- **Grouped Imports**: Separate import groups with a single blank line.
- **Single Responsibility Principle (SRP)**: Each function, component, and module must perform a single clear task. Keep functions short (under 30–40 lines).
- **One Component per File**: Place each React component in its own file unless a sub-component is small, tightly coupled, and exclusively used within that single file.
- **Modular Directory Structure**: Place reusable components in `src/components/`, state logic in `src/stores/` or `src/hooks/`, utilities in `src/lib/` or `src/utils/`, and TypeScript types in `src/types/`.

### 4. Readability & Expressive Naming
- **Descriptive Identifiers**: Use unambiguous, self-explaining names. Avoid single-letter names, generic placeholders (`data`, `temp`, `val`, `res`, `obj`), or obscure abbreviations.
- **Boolean Prefixes**: Name boolean variables and properties with `is`, `has`, `should`, or `can` (e.g., `isLoading`, `hasAudioSession`, `shouldRefresh`).
- **Handler Prefixes**: Name event handler functions with `handle` (e.g., `handleVolumeChange`, `handleToggleMute`, `handleSubmit`).
- **Constant Naming**: Use `UPPER_SNAKE_CASE` for compile-time constants and `camelCase` for runtime computed values.
- **Guard Clauses & Early Returns**: Prevent deep nesting (limit to maximum 2–3 levels). Handle edge cases and invalid states early with return statements.
- **Immutability & Pure Logic**: Prefer `const` over `let`. Use pure, non-mutating array/object methods (`map`, `filter`, `reduce`, spread syntax) instead of in-place mutations.

### 5. Type Safety & Error Handling
- **Strict TypeScript**: Define explicit types and interfaces for all props, states, parameters, and return values.
- **No `any` Type**: Avoid `any`. Use precise types or `unknown` narrowed with type guards when dealing with dynamic values.
- **Explicit Error Handling**: Never catch and silently swallow errors with empty `catch` blocks. Validate inputs early, handle errors explicitly, and provide clear diagnostic context.

### 6. Test-Driven Development (TDD)
- **Test-First Approach**: Always write or update failing unit/integration tests before writing implementation or bug fix code.
- **Red-Green-Refactor Cycle**:
  1. **Red**: Write a failing test that defines the expected behavior, edge case, or bug fix.
  2. **Green**: Write the minimum required code to pass the failing test.
  3. **Refactor**: Clean up implementation and structure while ensuring all tests continue to pass.
- **Automated Verification**: Ensure all new logic and edge cases are verified with tests (`vitest` or `cargo test`).

### 7. Clean Execution & Maintenance
- **No Dead Code or Unused Imports**: Ensure every imported symbol, variable, function, parameter, and type is actively used. Delete unused declarations immediately.
- **Verification Workflow**: Always run build, linting, typecheck, and test commands (e.g., `npm run verify` or `npm run typecheck && npm run lint`) to confirm code correctness before finishing tasks.
