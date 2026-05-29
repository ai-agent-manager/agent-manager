User wants to understand epic dependencies.

1. List All Dependencies:
For each epic, show:
  Depends on: [list or "None (foundational)"]
  Blocks: [list of downstream epics]

2. Visualize Dependencies:
Show phase-based dependency flow:
  Phase 1 (Foundation): Epic 1 (no dependencies)
  Phase 2 (Core): Epic 1 → Epic 2 → Epic 4
  Phase 3 (Enhancement): Epic 4 → Epic 6

3. Identify Critical Path:
"The critical path (longest dependency chain) is:
Epic 1 → Epic 2 → Epic 4 → Epic 6
This determines the minimum timeline. If any epic on this path is delayed,
the entire project is delayed."

4. Identify Parallelizable Work:
"These epics can run in parallel (no dependencies between them):
  Epic 2 and Epic 3 (both depend on Epic 1, but not on each other)
If you have 2 teams, you can work on these in parallel to reduce timeline."

5. Flag External Dependencies:
"These epics have external dependencies (blocking risks):
  Epic 8: Depends on Partner Team API – Risk: Delay if API is late
Recommendation: Track external dependencies closely and have fallback plans."
