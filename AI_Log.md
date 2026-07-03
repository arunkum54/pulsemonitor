# AI Collaboration Log

## AI Assistant Used

-   **Assistant:** Claude Sonnet (Claude.ai web interface)
-   **Usage:** Conversational design, implementation assistance,
    architecture review, debugging, documentation, and code refinement.
-   **Development Environment:** Claude's built-in code generation and
    file creation capabilities. No IDE-integrated AI tools (such as
    GitHub Copilot or Cursor) were used.

# Collaboration Workflow

The project was completed through multiple review and implementation
stages rather than generating the entire solution in a single prompt.

## 1. Architecture and Planning

Before writing any code, the AI was asked to produce a complete
implementation plan based on the assignment requirements.

**The prompts that shipped it**

> "First create a complete system design covering every requirement
> before writing any code."

The generated plan included:

-   Backend architecture
-   Frontend architecture
-   Database design
-   API structure
-   Monitoring scheduler
-   Deployment approach
-   Docker Compose topology
-   Mapping every assignment requirement to an implementation task

This planning stage was reviewed before implementation began.

## 2. Deployment Review

The initial architecture assumed an AWS-style deployment.

During discussion, the deployment target was changed to free hosting
platforms such as Render or Railway.


> "I plan to deploy using free services such as Railway or Render. Will
> this architecture still work?"

After this discussion the deployment documentation was adjusted to:

-   Use Render/Railway as the practical deployment target
-   Keep Terraform only as a lightweight infrastructure illustration
    because the assignment requested a deployment sketch rather than
    production infrastructure

## 3. Backend Implementation

The backend was generated incrementally rather than in a single
response.

AI assisted with:

-   Express server structure
-   SQLite integration
-   REST API endpoints
-   Monitoring scheduler
-   Database schema
-   Incident recording
-   Uptime calculation
-   Docker configuration

Each generated section was executed and tested before continuing.

## 4. Frontend Implementation

After the backend was functional, the frontend was generated.

The AI first proposed a design system including:

-   Typography
-   Spacing
-   Colour palette
-   Layout structure
-   Component hierarchy

React components were then implemented using that design.

## 5. Feature Expansion

Once the required assignment functionality was complete, additional
monitoring capabilities were added.

> "Continue by adding SSL expiry checks, multi-region monitoring, a
> public status page, and monitoring improvements."

The resulting additions included:

-   SSL certificate expiry monitoring
-   Multi-region monitoring logic
-   Server-Sent Events (SSE) live activity feed
-   Public status page
-   Improved incident state management

These features were added after the core assignment requirements had
already been satisfied.

# Human Review and Decision Making

AI-generated code was not accepted without review.

Implementation decisions were manually evaluated before being
incorporated into the project.

Examples include:

-   Selecting technologies
-   Adjusting deployment strategy
-   Simplifying Docker configuration
-   Reviewing database design
-   Testing generated API endpoints
-   Verifying monitoring behaviour

Whenever generated code did not match the intended architecture or
failed during testing, it was revised before being accepted.

# Corrections Made During Development

## SQLite Driver Change

The initial implementation used **better-sqlite3**.

During installation, dependency compilation failed because the package
required native compilation through **node-gyp**.

Rather than increasing Docker complexity by adding build tools, the
implementation was changed to Node.js's built-in **node:sqlite** module.

This required:

-   Removing `better-sqlite3`
-   Rewriting SQL parameter bindings
-   Updating error handling
-   Simplifying the Docker image

The revised implementation was tested by creating, retrieving and
deleting monitored URLs through the running API.

## Incident Resolution Bug

During review, the incident resolution logic referenced a database field
that did not exist.

The issue would only appear when an incident transitioned from **open**
to **resolved**.

The implementation was corrected by retrieving the incident start time
before calculating duration.

Unit tests were added to verify:

-   Incident creation
-   Incident resolution
-   Consecutive failure reset

## Multi-Region Quorum Logic

The first implementation required reports from at least two monitoring
regions before declaring a confirmed outage.

Review showed that this prevented incidents from opening in
single-instance deployments.

The minimum-region restriction was removed.

The quorum calculation now correctly supports both single-region and
multi-region deployments.

Additional tests were added to verify this behaviour.

# Validation Performed

The generated implementation was validated through execution rather than
relying solely on generated code.

Validation included:

-   Dependency installation
-   Docker builds
-   API endpoint testing
-   Database operations
-   Incident creation
-   Monitoring scheduler behaviour
-   Unreachable URL testing
-   Frontend build verification
-   Unit tests for monitoring logic

# Reflection on AI Usage

AI significantly accelerated development by assisting with architecture
design, boilerplate generation, debugging, documentation, and
implementation.

However, several generated solutions required revision before they were
suitable for the final submission. Native dependency issues, database
access changes, and incident-state logic all required manual review and
correction.

This project represents a collaborative workflow where AI accelerated
implementation, while final architectural decisions, validation,
testing, and acceptance of generated code remained under human
supervision.
