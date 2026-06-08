---
name: Backend Code Review Skill
description: Agent skill that performs structured backend code reviews with severity-graded findings and cross-team decision detection.
tags:
  - agent-skill
  - backend
  - code-quality
phases:
  - build_and_release
---

# Backend Code Review Skill

This skill performs thorough code reviews of backend services, producing structured findings with severity grades and actionable recommendations.

## Review Categories

- Security vulnerabilities and input validation
- Performance bottlenecks and N+1 query detection
- Error handling and resilience patterns
- API contract compliance
- Test coverage gaps

## Supported Languages

| Language | Framework | Coverage |
|----------|-----------|----------|
| Java | Spring Boot | Full |
| TypeScript | Node.js / Express | Full |
| Python | Django / FastAPI | Full |
| C# | .NET 6+ | Full |

## Usage

```bash
# Example prompt
Review the pull request for the order-service focusing on security and performance
```

## Severity Levels

Findings are graded on a four-level scale: Critical, Major, Minor, and Info.
